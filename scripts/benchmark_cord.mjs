// CORD v2 evaluation: original held-out images; no parser tuning on test labels.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWorker } from 'tesseract.js';
import { processImage } from '../services/document-ocr/processor.mjs';
import { suggestReceipt } from '../public/reimbursement/core.js';
const [manifestPath, engine, reportPath] = process.argv.slice(2);
if (!manifestPath || !['local','google'].includes(engine) || !reportPath) throw Error('Usage: node scripts/benchmark_cord.mjs MANIFEST local|google REPORT');
const manifest = JSON.parse(await readFile(manifestPath));
const processor = 'projects/220386098482/locations/us/processors/a705a771f39dc95f/processorVersions/pretrained-ocr-v2.1-2024-08-07';
import { tokens, counts, idrAmount } from './cord_metrics.mjs';
const cacheDir = resolve(dirname(manifestPath), `cache-${engine}`);
await mkdir(cacheDir,{recursive:true});
let worker, accessToken;
if(engine==='local') {
  worker=await createWorker('eng',1,{langPath:resolve('public/reimbursement/vendor'),cacheMethod:'none'});
  await worker.setParameters({user_defined_dpi:'300',preserve_interword_spaces:'1',tessedit_pageseg_mode:'3'});
} else accessToken=execFileSync(process.env.GCLOUD_BIN||'gcloud',['auth','print-access-token'],{encoding:'utf8',stdio:['ignore','pipe','inherit']}).trim();
const results=[];
try {
 for(const item of manifest) {
  const bytes=await readFile(resolve(dirname(manifestPath),item.file));
  if(createHash('sha256').update(bytes).digest('hex')!==item.sha256) throw Error('Source changed');
  const cachePath=resolve(cacheDir,`${item.id}.json`);
  try {
   let output;
   try { output=JSON.parse(await readFile(cachePath)); if(output.sourceSha256!==item.sha256) throw Error('Cache hash mismatch'); }
   catch { const start=performance.now();
    output=engine==='google'?await processImage(bytes,item.mimeType,{processor,accessToken}):(await worker.recognize(bytes,{rotateAuto:true})).data;
    output={text:output.text,confidence:output.confidence,sourceSha256:item.sha256,milliseconds:Math.round(performance.now()-start)};
    await writeFile(cachePath,JSON.stringify(output));
   }
   const truth=tokens(item.words.join(' ')), found=counts(tokens(output.text)), expected=counts(truth);
   const matched=[...expected].reduce((n,[t,c])=>n+Math.min(c,found.get(t)||0),0);
   const totalRaw=item.gtParse.total?.total_price;
   const totalExpected=typeof totalRaw==='string'?idrAmount(totalRaw):null;
   const predicted=suggestReceipt(output.text).total;
   const predictedNumber=predicted?Number(predicted.replaceAll(',','')):null;
   const totalTokens=tokens(item.totalLabels.join(' '));
   const targetCounts=counts(totalTokens);
   const totalTextPresent=totalTokens.length? [...targetCounts].every(([t,n])=>(found.get(t)||0)>=n):null;
   results.push({id:item.id,milliseconds:output.milliseconds,confidence:output.confidence,sourceSha256:item.sha256,
    annotatedTokens:truth.length,matchedTokens:matched,annotatedTokenRecall:truth.length?matched/truth.length:null,
    totalTextPresent,totalRaw:totalRaw??null,totalExpected,predictedTotal:predicted,
    totalMatch:totalExpected===null?null:predictedNumber===totalExpected});
  } catch(error) {results.push({id:item.id,error:error.message});}
  if(results.length%10===0) console.log(`${engine}: ${results.length}/${manifest.length}`);
 }
} finally {await worker?.terminate();}
const completed=results.filter(x=>!x.error), eligible=completed.filter(x=>x.totalMatch!==null), suggested=eligible.filter(x=>x.predictedTotal);
const times=completed.map(x=>x.milliseconds).sort((a,b)=>a-b);
const report={generatedAt:new Date().toISOString(),dataset:'NAVER CORD v2, official test split, all 100 original images',
 source:'https://huggingface.co/datasets/naver-clova-ix/cord-v2',license:'CC BY 4.0; NAVER Corp.',engine,processor:engine==='google'?processor:null,
 method:'Google direct processor using production adapter; local English Tesseract AUTO single pass, not browser multipass. Token multiset recall uses annotated regions only, ignores order/case/punctuation; not full-page CER or official CORD score. Total text presence is not field extraction. IDR normalization is evaluator-only; production parser unchanged.',
 summary:{total:manifest.length,completed:completed.length,annotatedTokenRecall:completed.reduce((n,x)=>n+x.matchedTokens,0)/completed.reduce((n,x)=>n+x.annotatedTokens,0),
 totalTextEligible:completed.filter(x=>x.totalTextPresent!==null).length,totalTextPresent:completed.filter(x=>x.totalTextPresent).length,
 totalEligible:eligible.length,totalExact:eligible.filter(x=>x.totalMatch).length,totalSuggested:suggested.length,wrongSuggestions:suggested.filter(x=>!x.totalMatch).length,
 medianMs:times[Math.floor(times.length/2)]??null,p95Ms:times[Math.ceil(times.length*.95)-1]??null},results};
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n'); console.log(JSON.stringify(report.summary));
if(completed.length!==manifest.length) process.exitCode=1;
