export const tokens = text => text.normalize('NFKC').toUpperCase().match(/[\p{L}\p{N}]+/gu) || [];
export const counts = list => list.reduce((m,t) => m.set(t,(m.get(t)||0)+1),new Map());
// Conservatively parse Indonesian grouping; ambiguous/non-numeric labels are excluded.
export function idrAmount(value) {
  const v = String(value).replace(/^\s*Rp\.?\s*/i,'').replace(/\s/g,'');
  if (/^\d+$/.test(v)) return Number(v);
  if (/^\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*$/.test(v)) return Number(v.replace(/[.,]/g,''));
  if (/^\d+[.,]\d{2}$/.test(v)) return Number(v.replace(',','.'));
  if (/^\d{1,3}(?:\.\d{3})+,\d{2}$/.test(v)) return Number(v.replaceAll('.','').replace(',','.'));
  if (/^\d{1,3}(?:,\d{3})+\.\d{2}$/.test(v)) return Number(v.replaceAll(',',''));
  return null;
}
