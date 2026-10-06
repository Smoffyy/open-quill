import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUTS, layoutOf } from '../src/lib/layout.js';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

function walk(dir, ext, out = []) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) walk(full, ext, out);
    else if (ext.some(e => name.name.endsWith(e))) out.push(full);
  }
  return out;
}

const rel = (f) => path.relative(src, f).split(path.sep).join('/');
const read = (f) => fs.readFileSync(f, 'utf8');

test('both layouts define exactly the same flags', () => {
  assert.deepEqual(Object.keys(LAYOUTS.card).sort(), Object.keys(LAYOUTS.pill).sort());
  assert.equal(layoutOf('openai'), LAYOUTS.pill);
  assert.equal(layoutOf('anthropic'), LAYOUTS.card);
  assert.equal(layoutOf(undefined), LAYOUTS.card);
});

test('stylesheets are keyed by role: no preset selectors, layouts and palettes stay in their own files', () => {
  const sheets = walk(path.join(src, 'styles'), ['.css']);
  for (const f of sheets) {
    const name = path.basename(f);
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/data-preset/.test(css), name + ' must not select on data-preset');
    const usesCard = /data-layout="card"/.test(css);
    const usesPill = /data-layout="pill"/.test(css);
    assert.ok(!usesCard || name === 'layout-card.css', name + ' mentions the card layout outside layout-card.css');
    assert.ok(!usesPill || name === 'layout-pill.css', name + ' mentions the pill layout outside layout-pill.css');
    if (name.startsWith('palette-')) assert.ok(!/data-layout/.test(css), name + ' is colours only and must not select on a layout');
  }
});

test('layout files only select under their own layout', () => {
  for (const [file, id] of [['layout-card.css', 'card'], ['layout-pill.css', 'pill']]) {
    const css = read(path.join(src, 'styles', file)).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = css.replace(/@media[^{]+\{/g, '').split('}').map(s => s.trim()).filter(Boolean);
    for (const rule of rules) {
      const sel = rule.split('{')[0];
      for (const part of sel.split(',').map(s => s.trim()).filter(Boolean)) {
        assert.ok(part.includes('data-layout="' + id + '"'), file + ' has a selector outside its layout: ' + part);
      }
    }
  }
});

const PRESET_NAMES = new Set([
  'lib/layout.js', 'lib/palettes.js', 'lib/prefs.js', 'lib/theme/schema.js',
  'components/admin/sections/InterfaceSection.jsx', 'components/admin/state/useWorkspace.js', 'components/builder/ThemesPanel.jsx'
]);

test('components branch on layout flags, not on which preset is active', () => {
  for (const f of walk(src, ['.js', '.jsx'])) {
    const name = rel(f);
    if (name.startsWith('locales/') || PRESET_NAMES.has(name)) continue;
    const lines = read(f).split('\n');
    lines.forEach((line, i) => {
      if (/preset/i.test(line) && /(===|!==)\s*'(openai|anthropic)'/.test(line)) {
        assert.fail(name + ':' + (i + 1) + ' compares a preset by name; read a flag from lib/layout.js instead');
      }
    });
  }
});

test('every layout flag a component reads exists', () => {
  const known = new Set(Object.keys(LAYOUTS.card));
  for (const f of walk(src, ['.js', '.jsx'])) {
    const code = read(f);
    for (const m of code.matchAll(/(?<![\w/.])layout\.([A-Za-z]+)\b/g)) {
      if (rel(f) === 'lib/layout.js') continue;
      assert.ok(known.has(m[1]), rel(f) + ' reads layout.' + m[1] + ' which no layout defines');
    }
  }
});