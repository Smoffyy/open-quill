const ROW = /^\s*\|.*\|\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

function isSeparator(line) {
  return /^[\s|:-]+$/.test(line) && line.includes('-');
}

function cellCount(line) {
  return line.replace(/`[^`]*`/g, 'x').replace(/\\\|/g, 'x').trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
}

export function repairTables(text) {
  if (typeof text !== 'string' || text.indexOf('|') === -1) return text;
  const lines = text.split('\n');
  const out = [];
  let fence = '';
  let inMath = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = '';
      out.push(line);
      i++;
      continue;
    }
    if (!fence && ((line.match(/\$\$/g) || []).length % 2)) inMath = !inMath;
    if (fence || inMath || !ROW.test(line)) {
      out.push(line);
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < lines.length && ROW.test(lines[end + 1])) end++;
    const run = lines.slice(i, end + 1);
    const cols = cellCount(run[0]);
    const broken = run.length >= 2 && cols >= 2 && !run.some(isSeparator) && run.every(r => cellCount(r) === cols);
    if (broken) {
      if (out.length && out[out.length - 1].trim() !== '') out.push('');
      out.push(run[0], '|' + ' --- |'.repeat(cols), ...run.slice(1));
    } else {
      out.push(...run);
    }
    i = end + 1;
  }
  return out.join('\n');
}