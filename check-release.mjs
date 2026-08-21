import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { releaseCandidates, parseManifest } from './server/lib/release.js';
import { APP_VERSION } from './server/lib/appversion.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.join(__dirname, 'release');
const CHANGELOG = path.join(__dirname, 'CHANGELOG.md');
const ICON_MAX = 500 * 1024;

const errors = [];
const warnings = [];
const notes = [];

const version = APP_VERSION;
const base = version.split('-')[0];
const prerelease = version.includes('-');

notes.push(`version ${version}${prerelease ? ' (pre-release)' : ''}`);

const WORKSPACES = ['server', 'client'];
for (const ws of WORKSPACES) {
  for (const file of ['package.json', 'package-lock.json']) {
    const full = path.join(__dirname, ws, file);
    let json;
    try { json = JSON.parse(fs.readFileSync(full, 'utf8')); }
    catch { errors.push(`${ws}/${file} could not be read.`); continue; }
    const seen = file === 'package.json'
      ? [json.version]
      : [json.version, json.packages?.['']?.version];
    for (const v of seen) {
      if (v !== undefined && v !== version) {
        errors.push(`${ws}/${file} says ${v}, the root says ${version}. Run: cd ${ws} && npm version ${version} --no-git-tag-version --allow-same-version`);
      }
    }
  }
}

const candidates = releaseCandidates(version);
if (!candidates.length) {
  errors.push(`package.json version "${version}" is not a dotted number, so no release folder can be resolved.`);
}

let found = null;
for (const name of candidates) {
  const dir = path.join(RELEASE_DIR, name);
  try { if (fs.statSync(path.join(dir, 'release.json')).isFile()) { found = { dir, name }; break; } } catch { }
}

if (candidates.length && !found) {
  errors.push(`no release folder for ${version}. Tried: ${candidates.map(c => `release/${c}/`).join(', ')}`);
  errors.push('Create one with release.json, notes.md and an icon, or Settings > Version renders blank.');
}

if (found) {
  notes.push(`release/${found.name}/`);

  let raw = '';
  try { raw = fs.readFileSync(path.join(found.dir, 'release.json'), 'utf8'); }
  catch { errors.push(`release/${found.name}/release.json could not be read.`); }

  const manifest = parseManifest(raw, (w) => errors.push(`release/${found.name}/${w.replace(/^release\.json: ?/, 'release.json: ')}`));

  if (manifest) {
    if (manifest.codename) notes.push(`codename ${manifest.codename}`);
    else warnings.push(`release/${found.name}/release.json has no codename.`);

    if (!manifest.released) {
      if (prerelease) notes.push('no release date yet');
      else errors.push(`release/${found.name}/release.json needs a "released" date before tagging ${base}.`);
    }

    if (!manifest.icon) {
      warnings.push(`release/${found.name}/release.json sets no icon, so the panel falls back to the app icon.`);
    } else {
      const icon = path.join(found.dir, manifest.icon);
      let st = null;
      try { st = fs.statSync(icon); } catch { }
      if (!st || !st.isFile()) errors.push(`release/${found.name}/${manifest.icon} is named in release.json but missing on disk.`);
      else if (st.size > ICON_MAX) errors.push(`release/${found.name}/${manifest.icon} is ${(st.size / 1024 / 1024).toFixed(1)} MB. It renders at 84px — resize it to 256px (max ${ICON_MAX / 1024} KB).`);
      else notes.push(`icon ${(st.size / 1024).toFixed(0)} KB`);
    }
  }

  let body = '';
  try { body = fs.readFileSync(path.join(found.dir, 'notes.md'), 'utf8'); } catch { }
  if (!body.trim()) errors.push(`release/${found.name}/notes.md is missing or empty, so the panel shows "No release notes for this build."`);
  else if (/^\s*#\s/.test(body)) warnings.push(`release/${found.name}/notes.md starts with a heading, which repeats the name and version already shown above it.`);
}

let changelog = '';
try { changelog = fs.readFileSync(CHANGELOG, 'utf8'); } catch { errors.push('CHANGELOG.md could not be read.'); }

if (changelog) {
  const heading = new RegExp(`^## \\[${base.replace(/\./g, '\\.')}\\].*$`, 'm');
  const hit = changelog.match(heading);
  if (!hit) errors.push(`CHANGELOG.md has no "## [${base}]" section, and the version panel points users at it.`);
  else if (!prerelease && /TBD/i.test(hit[0])) errors.push(`CHANGELOG.md still says "${hit[0].trim()}". Set a date before tagging ${base}.`);
  else notes.push(`changelog ${hit[0].trim().replace(/^##\s*/, '')}`);
}

for (const w of warnings) console.log(`check-release: warning, ${w}`);

if (errors.length) {
  console.error('check-release: FAILED');
  for (const e of errors) console.error('  ' + e);
  process.exit(1);
}

console.log(`check-release: OK — ${notes.join(', ')}.`);
