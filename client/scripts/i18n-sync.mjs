import fs from 'fs';
import path from 'path';
import { collectKeys, packFiles, readPack, writePack, LOCALES, SOURCE_LANG } from './i18n-keys.mjs';

const USAGE = `i18n-sync — prune stale keys and merge translations without opening a pack by hand.

  npm run i18n:sync                       prune orphaned keys from every pack
  npm run i18n:sync -- --from patch.json  also merge the translations in patch.json
  cat patch.json | npm run i18n:sync --   same, from stdin
  npm run i18n:sync -- --new de --name Deutsch
                                          start a new, partial language pack
  npm run i18n:sync -- --dry              report what would change, write nothing

patch.json is { "<lang>": { "<English key>": "<translation>", ... }, ... }.
Run \`npm run i18n:check\` first: it prints exactly the keys a pack is missing.`;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

if (flag('--help') || flag('-h')) { console.log(USAGE); process.exit(0); }

const dry = flag('--dry');
const keys = collectKeys();

function die(msg) { console.error('i18n-sync: ' + msg); process.exit(1); }

if (flag('--new')) {
  const code = value('--new');
  const name = value('--name');
  if (!code || !/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(code)) die('--new needs a language code like "de" or "pt-BR"');
  if (!name) die('--new needs --name, the language\'s own name for itself (e.g. Deutsch)');
  const p = path.join(LOCALES, code + '.json');
  if (fs.existsSync(p)) die(code + '.json already exists');
  // partial lets the pack ship incomplete: every key it lacks renders in English,
  // so a new language never has to land all at once.
  // dir stays ltr on purpose: the stylesheets have no RTL pass, so an RTL
  // language is a deliberate _meta edit plus that CSS work, not a flag.
  const pack = { _meta: { code, name, dir: 'ltr', partial: true } };
  if (dry) console.log('would create ' + code + '.json');
  else { writePack(p, pack); console.log('created locales/' + code + '.json (partial)'); }
  console.log('The app picks it up from the filename alone — no code change needed.');
  process.exit(0);
}

function readPatch() {
  const from = value('--from');
  if (from) return JSON.parse(fs.readFileSync(from, 'utf8'));
  if (process.stdin.isTTY) return {};
  const raw = fs.readFileSync(0, 'utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

const patch = readPatch();
const packs = packFiles();
const byCode = new Map(packs.map(p => [p.code, p]));

for (const code of Object.keys(patch)) {
  if (!byCode.has(code)) die(`no pack for "${code}" — create it with --new ${code} --name <Name>`);
  if (code === SOURCE_LANG) die('en.json is the source language and takes no translations');
  for (const k of Object.keys(patch[code])) {
    if (!keys.has(k)) die(`"${k}" is not a key in the source — check the spelling against npm run i18n:check`);
  }
}

let changed = 0;
for (const { code, file, path: p } of packs) {
  const dict = readPack(p);
  const add = patch[code] || {};
  const next = {};
  let pruned = 0, updated = 0, added = 0;

  // Existing keys keep their position, so the packs stay lined up with each
  // other and a sync shows up as the handful of lines that actually changed.
  for (const [k, v] of Object.entries(dict)) {
    if (k === '_meta') { next[k] = v; continue; }
    if (!keys.has(k)) { pruned++; continue; }
    if (k in add && add[k] !== v) { next[k] = add[k]; updated++; continue; }
    next[k] = v;
  }
  for (const [k, v] of Object.entries(add)) {
    if (k in next) continue;
    next[k] = v;
    added++;
  }

  if (!pruned && !updated && !added) continue;
  changed++;
  const bits = [added && `+${added}`, updated && `~${updated}`, pruned && `-${pruned}`].filter(Boolean).join(' ');
  console.log(`${dry ? 'would update' : 'updated'} ${file}  ${bits}`);
  if (!dry) writePack(p, next);
}

if (!changed) console.log('nothing to do — every pack is already in sync');
