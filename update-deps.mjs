//   node update-deps.mjs < update root, server and client
//   node update-deps.mjs --check < just list what's outdated, change nothing
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const folders = ['.', 'server', 'client'];
const check = process.argv.includes('--check');

let failed = false;

const run = (cmd, cwd, fatal = false) => {
  try { return execSync(cmd, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { if (fatal) failed = true; return (e.stdout || '') + (e.stderr || ''); }
};

for (const f of folders) {
  const dir = path.join(root, f);
  if (!existsSync(path.join(dir, 'package.json'))) continue;
  const label = f === '.' ? 'root' : f;
  console.log(`\n=== ${label} ===`);

  const outdated = run('npm outdated', dir).trim();
  if (!outdated) { console.log('already up to date'); continue; }
  console.log(outdated);

  if (check) continue;
  console.log(`updating ${label}...`);
  console.log(run('npm update', dir, true).trim() || 'done');
}

if (failed) { console.error('\nFAILED, see above.'); process.exit(1); }

if (check) console.log('\n(check only, nothing was changed)');
else console.log('\nAll folders updated within their safe version ranges.');
