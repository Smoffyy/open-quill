import fs from 'fs';

function parse(v) {
  const [core, pre] = String(v ?? '').trim().split('-');
  return {
    nums: core.split('.').map(n => Number(n) || 0),
    pre: pre ? pre.split('.') : null
  };
}

export function compareVersions(a, b) {
  const A = parse(a), B = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (A.nums[i] || 0) - (B.nums[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  if (!A.pre && !B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  const n = Math.max(A.pre.length, B.pre.length);
  for (let i = 0; i < n; i++) {
    const x = A.pre[i], y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) { const d = Number(x) - Number(y); if (d) return d < 0 ? -1 : 1; }
    else if (xn !== yn) return xn ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('check-version-bump.mjs')) {
  const base = process.argv[2];
  const target = process.argv[3] || 'the base branch';
  const head = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;

  if (!base) {
    console.error('check-version-bump: FAILED, no base version was passed.');
    process.exit(1);
  }

  console.log(`base=${base} head=${head}`);
  const c = compareVersions(head, base);

  if (c === 0) {
    console.error(`::error::package.json version (${head}) must be bumped before merging into ${target}.`);
    process.exit(1);
  }
  if (c < 0) {
    console.error(`::error::package.json version ${head} is older than ${base} on ${target}.`);
    process.exit(1);
  }
  console.log(`check-version-bump: OK, ${head} is newer than ${base}.`);
}
