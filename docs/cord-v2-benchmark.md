# CORD v2 OCR evaluation — 2026-10-05

## Dataset and scope

Source: [NAVER CORD v2](https://huggingface.co/datasets/naver-clova-ix/cord-v2),
revision `7f0115a`. Attribution: NAVER Corp. and the CORD authors (Park et al.,
2019), [official repository](https://github.com/clovaai/cord), CC BY 4.0.

This run uses every image in the official 100-image test split. Original image
bytes are preserved. No synthetic blur, resizing, or layout-specific tuning was
applied. The dataset is mostly Indonesian receipts, not a representative sample
of US university reimbursements. Public CORD annotations omit some fields,
including store/payment information; purchase-date accuracy is not evaluated.

Official file: `data/test-00000-of-00001-9c204eb3f4e11791.parquet` (234,202,795 bytes).
SHA256: `51c65f1788faff392abe2a0b55b023eb23e9be551c509138eaa3a832514224e7`.
Raw images, labels, and cached OCR text remain in ignored `tmp/ocr-benchmark/`;
only metrics, source hashes, and small total-field comparisons are committed.

## Results

All 100 local images completed. Google completed 99; the sole rejection was the
original over-limit image described below. No provider/network failures occurred.
The following comparison uses the same 99 successfully processed images for both
engines (94 have labeled totals):

| Engine | Annotated-token recall | Total text present | Correct total extraction | Wrong / all total suggestions |
| --- | --- | --- | --- | --- |
| Local English Tesseract AUTO | 38.14% | 27/94 | 2/94 | 1/3 |
| Google Document AI | 97.54% | 90/94 | 1/94 | 2/3 |

Across all 100 local images, annotated-token recall was 37.50%, total-text presence
27/95, and correct total extraction 2/95. Google on 99 images achieved 97.54%
annotated-token recall and 90/94 total-text presence, but only 1/94 correct total
extraction. Neither token recall nor text presence is financial-field accuracy.

Google median/p95 request latency was 4,295/12,247 ms; local baseline was
207/1,152 ms. These are observed on this machine, not service guarantees.

**Finding:** stronger OCR alone does not make the reimbursement pipeline ready
for Indonesian receipts. The current parser expects two-decimal monetary values
and English total labels; it often abstains even when OCR reads the amount.
It can also mistake quantity for money: Google output for `cord-test-000` included
`TOTAL (Qty 2.00 60.000`, and the parser suggested `2.00` instead of 60,000 IDR.
Both engines produced an incorrect `4.00` suggestion for `cord-test-092`, whose
labeled total is 240,000 IDR. No suggestion was automatically verified or approved.

Next work should explicitly identify currency/locale, exclude quantity fields,
associate labels with monetary values using layout, and preserve abstention when
ambiguous. Develop those changes against train/validation data and new hand-labeled
regressions. Do not tune against these test labels and then claim a held-out score.
Real US reimbursement photos and a separate distortion evaluation are still needed.

Metrics: `cord-v2-local-results.json` and `cord-v2-google-results.json`.
Validation: 60 JavaScript tests and 30 Python policy tests passed. The new metric
tests check grouping/decimal distinctions and repeated-token accounting.

## Method

- Local baseline: bundled English Tesseract, one AUTO pass with automatic
  rotation. This does not reproduce the browser's resizing, multiple passes,
  alternative orientation recovery, or low-confidence gating.
- Google: direct Document AI calls through the production `processImage`
  adapter, pinned to `pretrained-ocr-v2.1-2024-08-07`. This evaluates the processor
  and adapter, not the deployed Cloud Run/IAP HTTP route or browser workflow.
- Production `suggestReceipt` is unchanged. It is oriented toward English labels
  and dollar-style decimals; this test deliberately exposes the locale mismatch.
- OCR metric: corpus-weighted multiset recall of alphanumeric tokens in annotated
  regions. It ignores case, punctuation, and reading order, accounts for repeated
  tokens, and does not penalize extra recognized text. This is neither full-page
  character accuracy nor an official CORD benchmark score.
- Total-text presence: whether the annotated total's numeric/text tokens occur
  somewhere in the output. Another amount can contain the same tokens. This
  measures supporting text availability, not correct field selection.
- Total extraction: compare the unchanged parser's suggestion with the labeled
  total, using conservative Indonesian amount normalization in the evaluator
  only. Of 100 receipts, 95 have a parseable total label. Missing labels are
  excluded, not counted as successes. No currency conversion occurs.
- Wrong suggestions remain unverified in the product; they are not automatic
  approvals. The benchmark does not measure a production auto-acceptance rate.
- Latency includes local processing/network overhead and is informational, not
  a controlled service latency comparison. Caches permit report regeneration
  without paying for repeated OCR calls.

One original image (`cord-test-059`, 17,240,894 bytes) exceeds the production
adapter's 12 MiB limit. Record this as an input rejection rather than an OCR
recognition failure. The browser normally renders/resizes images before upload,
so this raw-image limit does not prove the same image fails through the UI.

## Reproduction

Install `pyarrow` in an isolated Python environment, obtain the official file
above, and place it at `tmp/ocr-benchmark/cord-v2/test.parquet`. The preparation
script verifies its checksum and the 100-row count before extraction.

```sh
python3 scripts/prepare_cord_benchmark.py tmp/ocr-benchmark/cord-v2/test.parquet
node scripts/benchmark_cord.mjs tmp/ocr-benchmark/cord-v2/manifest.json local docs/cord-v2-local-results.json
node scripts/benchmark_cord.mjs tmp/ocr-benchmark/cord-v2/manifest.json google docs/cord-v2-google-results.json
```

Google evaluation requires an authorized gcloud session. Optional `GCLOUD_BIN`
and `CLOUDSDK_CONFIG` select an isolated CLI. The Google command exits nonzero
if any image fails, including the documented size rejection; inspect all results.

## Deployment boundary

| Component | Execution location |
| --- | --- |
| Public site and local-OCR entry point | Cloudflare |
| Google sign-in and private staff UI hosting | IAP / Cloud Run |
| Image OCR, text locations, image-quality signals | Google Document AI via Cloud Run |
| Receipt field suggestions and policy checks | User's browser |
| Concur worksheet and combined PDF creation | User's browser (`pdf-lib`) |

No server-side PDF agent, case storage, durable queue, or multimodal fallback is
implemented in this pilot. PDF assembly is deterministic code, not an LLM agent.
