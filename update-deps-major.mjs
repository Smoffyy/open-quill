// node update-deps-major.mjs
// node update-deps-major.mjs --check
// node update-deps-major.mjs --safe

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const folders = ['.', 'server', 'client'];
const check = process.argv.includes('--check');
const safe = process.argv.includes('--safe');

const run = (cmd, cwd) => {
  try {
    return { ok: true, out: execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
};

let failed = false;
const forced = [];

for (const f of folders) {
  const dir = path.join(root, f);
  if (!existsSync(path.join(dir, 'package.json'))) continue;

  const label = f === '.' ? 'root' : f;
  console.log(`\n=== ${label} ===`);

  const peers = run('npx npm-check-updates --peer', dir);
  const held = [...peers.out.matchAll(/^\s*(\S+)\s+\S+\s+→\s+(\S+)\s+reason: (.+)$/gm)];

  const report = run(`npx npm-check-updates${safe ? ' --peer' : ''}${check ? '' : ' -u'}`, dir);
  const out = report.out.trim();

  if (!report.ok) {
    console.error(out || 'npm-check-updates failed');
    failed = true;
    continue;
  }

  console.log(out || 'already up to date');

  if (!safe && held.length) {
    for (const [, pkg, to, reason] of held) forced.push(`${label}: ${pkg} → ${to} (${reason})`);
  }

  if (check) continue;

  const legacy = !safe && held.length;
  const install = run(`npm install${legacy ? ' --legacy-peer-deps' : ''}`, dir);
  console.log(install.out.trim() || 'done');

  if (!install.ok) {
    console.error(`\n${label}: npm install failed. Revert with "git checkout ${f === '.' ? 'package.json' : f + '/package.json'}".`);
    failed = true;
  }
}

if (forced.length) {
  console.log(`\n${check ? 'Would force' : 'Forced'} past peer ranges:`);
  for (const l of forced) console.log('  ' + l);
  if (!check) console.log('\nInstalled with --legacy-peer-deps. Run the test suite before trusting this tree.');
  console.log('Use --safe to skip these instead.');
}

if (failed) {
  console.error('\nFAILED, see above.');
  process.exit(1);
}

console.log(check
  ? '\n(check only, nothing was changed)'
  : `\nAll folders updated to the latest ${safe ? 'versions their peers allow' : 'majors'}.`);
