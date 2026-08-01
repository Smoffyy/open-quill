import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const ALLOWED_HOSTS = new Set([
  'www.w3.org',
  'localhost',
  '127.0.0.1',
  'react.dev',
  'github.com',
  'reactjs.org',
]);

const URL_RE = /https?:\/\/([a-zA-Z0-9._-]+)(?::\d+)?/g;
const FETCHING_ATTR_RE = /(?:src|href)\s*=\s*["']((?:https?:)?\/\/[^"']+)["']/gi;
const CSS_URL_RE = /url\(\s*['"]?((?:https?:)?\/\/[^'")]+)/gi;
const IMPORT_RE = /\bimport\s*\(\s*["']((?:https?:)?\/\/[^"']+)["']\s*\)/gi;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

if (!fs.existsSync(DIST)) {
  console.error('check-local: dist/ not found, run the build first.');
  process.exit(1);
}

const problems = [];
const seenHosts = new Map();

for (const file of walk(DIST)) {
  if (!/\.(js|css|html|webmanifest|json|svg)$/i.test(file)) continue;
  const rel = path.relative(DIST, file);
  const text = fs.readFileSync(file, 'utf8');

  for (const re of [FETCHING_ATTR_RE, CSS_URL_RE, IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const raw = m[1];
      const host = raw.replace(/^https?:/, '').replace(/^\/\//, '').split(/[/?#]/)[0];
      if (!ALLOWED_HOSTS.has(host)) problems.push(`${rel}: loads ${raw}`);
    }
  }

  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(text))) {
    const host = m[1];
    if (ALLOWED_HOSTS.has(host)) continue;
    if (!seenHosts.has(host)) seenHosts.set(host, new Set());
    seenHosts.get(host).add(rel);
  }
}

if (seenHosts.size) {
  console.log('check-local: external hosts mentioned in the bundle (strings, not necessarily fetched):');
  for (const [host, files] of [...seenHosts].sort()) {
    console.log(`  ${host}  (${[...files].slice(0, 3).join(', ')})`);
  }
  console.log('');
}

if (problems.length) {
  console.error('check-local: FAILED, the bundle would load remote resources:');
  for (const p of problems) console.error('  ' + p);
  console.error('\nEverything must be served from this origin. Add the dependency to package.json');
  console.error('and import it so Vite bundles it locally, instead of referencing a CDN.');
  process.exit(1);
}

console.log('check-local: OK, no remote resources are loaded by the bundle.');
