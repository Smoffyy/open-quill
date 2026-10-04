const SCALE = { __proto__: null, '': 1, M: 0.001, B: 1, T: 1000 };
const round2 = (x) => Math.round(x * 100) / 100;

export function parseParamCount(v) {
  let n = v;
  if (typeof v !== 'number') {
    const m = /^A?(\d*\.?\d+)([MBT]?)$/.exec(String(v ?? '').toUpperCase().replace(/\s+/g, ''));
    n = m ? Number(m[1]) * SCALE[m[2]] : NaN;
  }
  const billions = Math.round(n * 1000) / 1000;
  return Number.isFinite(billions) && billions > 0 ? billions : null;
}

export function formatParamCount(billions) {
  if (!(billions > 0)) return '';
  if (round2(billions) >= 1000) return round2(billions / 1000) + 'T';
  if (round2(billions * 1000) < 1000) return round2(billions * 1000) + 'M';
  return round2(billions) + 'B';
}

export function modelSize(total, moe, active) {
  const t = parseParamCount(total);
  const a = t && moe ? parseParamCount(active) : null;
  return { total: t, moe: !!(t && moe), active: a && a < t ? a : null };
}

export function sizeLabel({ total, moe, active }) {
  if (!total) return '';
  return formatParamCount(total) + (active ? ' A' + formatParamCount(active) : moe ? ' MoE' : '');
}

export function sizePhrase({ total, moe, active }) {
  if (!total) return '';
  const base = formatParamCount(total) + ' parameters';
  if (!moe) return base;
  return base + (active ? ` (mixture-of-experts, ${formatParamCount(active)} active per token)` : ' (mixture-of-experts)');
}