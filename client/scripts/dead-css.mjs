import fs from 'fs';
import path from 'path';

const root = path.join(process.cwd(), 'src');
const styles = path.join(root, 'styles');

// Classes emitted by libraries or by the pre-paint boot script never appear in our
// source, so they would otherwise be reported forever.
const EXTERNAL = new Set([
  'katex-display', 'katex', 'hljs', 'sr-only'
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(root);
const source = files
  .filter(f => /\.(jsx?|html)$/.test(f))
  .map(f => fs.readFileSync(f, 'utf8'))
  .join('\n');

const classes = new Map();
for (const f of files.filter(f => f.endsWith('.css') && f.startsWith(styles))) {
  const css = fs.readFileSync(f, 'utf8');
  for (const m of css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]{2,})/g)) {
    if (!classes.has(m[1])) classes.set(m[1], new Set());
    classes.get(m[1]).add(path.basename(f));
  }
}

function referenced(name) {
  if (EXTERNAL.has(name)) return true;
  if (new RegExp(`\\b${name.replace(/[-]/g, '\\-')}\\b`).test(source)) return true;
  const parts = name.split('-');
  for (let i = parts.length - 1; i > 0; i--) {
    if (source.includes(parts.slice(0, i).join('-') + '-')) return true;
  }
  return false;
}

const dead = [...classes.keys()].filter(c => !referenced(c)).sort();
if (!dead.length) {
  console.log('dead-css: no unreferenced class names.');
  process.exit(0);
}
console.log(`dead-css: ${dead.length} class name(s) with no reference in src/:\n`);
for (const c of dead) console.log(`  .${c.padEnd(24)} ${[...classes.get(c)].sort().join(', ')}`);
console.log('\nThese may still be composed dynamically or emitted by a library.');
console.log('Verify before deleting; this check is advisory and does not fail the build.');
