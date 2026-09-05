import { collectKeys, packFiles, readPack, auditPack, SOURCE_LANG } from './i18n-keys.mjs';

const asJson = process.argv.includes('--json');
const keys = collectKeys();

const report = [];
let fail = false;

for (const { code, file, path: p } of packFiles()) {
  const dict = readPack(p);
  const { missing, orphaned } = auditPack(dict, keys);
  const untranslated = code === SOURCE_LANG ? [] : missing;
  const partial = !!(dict._meta && dict._meta.partial);
  if (untranslated.length && !partial) fail = true;
  report.push({ code, file, partial, missing: untranslated, orphaned, total: keys.size });
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(fail ? 1 : 0);
}

for (const r of report) {
  if (r.missing.length) {
    console.log(`${r.file}: ${r.missing.length} ${r.partial ? 'untranslated (partial pack)' : 'missing'}`);
    r.missing.forEach(k => console.log('  - ' + k));
  }
  if (r.orphaned.length) {
    console.log(`${r.file}: ${r.orphaned.length} orphaned`);
    r.orphaned.forEach(k => console.log('  ~ ' + k));
  }
  if (!r.missing.length && !r.orphaned.length) console.log(`${r.file}: complete (${r.total} keys)`);
}

process.exit(fail ? 1 : 0);
