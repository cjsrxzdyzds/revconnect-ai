// Pure layout helpers shared by the browser and regression tests.
export function textFromItems(items) {
  const rows = [];
  for (const item of items) {
    if (!item.str?.trim() || !item.transform) continue;
    const x = item.transform[4], y = item.transform[5];
    const height = Math.max(1, Math.abs(item.height || item.transform[3] || 8));
    const row = rows.find((candidate) => Math.abs(candidate.y - y) <= Math.min(candidate.height, height) * 0.35);
    const part = { x, width: item.width || 0, value: item.str, height };
    if (row) row.parts.push(part);
    else rows.push({ y, height, parts: [part] });
  }
  return rows.sort((a, b) => b.y - a.y).map(({ parts }) => {
    parts.sort((a, b) => a.x - b.x);
    return parts.map((part, index) => {
      const previous = parts[index - 1];
      const gap = previous ? part.x - previous.x - previous.width : 0;
      return `${index ? gap > part.height * 3 ? '\t' : ' ' : ''}${part.value}`;
    }).join('');
  }).join('\n');
}

function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}

// Image draw operations use a unit square transformed into PDF page coordinates.
// Track transforms rather than image pixel dimensions: logos are usually tiny.
export function imageCoverage(operatorList, ops, pageArea) {
  let matrix = [1, 0, 0, 1, 0, 0], area = 0;
  const stack = [];
  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const fn = operatorList.fnArray[i], args = operatorList.argsArray[i];
    if (fn === ops.save) stack.push([...matrix]);
    else if (fn === ops.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === ops.transform) matrix = multiply(matrix, args);
    else if ([ops.paintImageXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject].includes(fn)) area += Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]);
  }
  return Math.min(1, area / Math.max(1, pageArea));
}
