// node update-deps-major.mjs
// node update-deps-major.mjs --check

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const folders = ['.', 'server', 'client'];
const check = process.argv.includes('--check');

const run = (cmd, cwd) => {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
};

let failed = false;

for (const f of folders) {
  const dir = path.join(root, f);
  if (!existsSync(path.join(dir, 'package.json'))) continue;

  const label = f === '.' ? 'root' : f;
  console.log(`\n=== ${label} ===`);

  const report = run(`npx npm-check-updates --peer${check ? '' : ' -u'}`, dir);
  const out = report.out.trim();

  if (!report.ok) {
    console.error(out || 'npm-check-updates failed');
    console.error(`\n${label}: could not check for updates.`);
    failed = true;
    continue;
  }

  console.log(out || 'already up to date');

  if (check) continue;
  if (!/[─→]/.test(out)) continue;

  const install = run('npm install', dir);
  console.log(install.out.trim() || 'done');

  if (!install.ok) {
    console.error(`\n${label}: npm install rejected these versions. package.json was changed — revert it with "git checkout ${f === '.' ? 'package.json' : f + '/package.json'}".`);
    failed = true;
  }
}

if (failed) {
  console.error('\nFAILED, see above. Nothing below this point was verified.');
  process.exit(1);
}

console.log(check
  ? '\n(check only, nothing was changed)'
  : '\nAll folders updated to the latest versions their peers allow.');
