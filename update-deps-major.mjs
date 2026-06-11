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
    return execSync(cmd, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
};

for (const f of folders) {
  const dir = path.join(root, f);
  if (!existsSync(path.join(dir, 'package.json'))) continue;

  const label = f === '.' ? 'root' : f;
  console.log(`\n=== ${label} ===`);

  // show outdated packages first
  const outdated = run('npm outdated', dir).trim();
  if (!outdated) {
    console.log('already up to date');
    continue;
  }

  console.log(outdated);

  if (check) continue;

  console.log(`updating ${label} to latest majors...`);

  // update package.json dependency ranges to latest
  console.log(
    run('npx npm-check-updates -u', dir).trim() ||
      'package.json updated'
  );

  // install the new versions
  console.log(
    run('npm install', dir).trim() ||
      'done'
  );
}

if (check) {
  console.log('\n(check only — nothing was changed)');
} else {
  console.log('\nAll folders updated to latest versions (including majors).');
}