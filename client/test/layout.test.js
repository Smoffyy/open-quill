import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LAYOUTS, layoutOf } from '../src/lib/layout.js';
import { PRESETS, DEFAULT_PRESET, presetById } from '../src/lib/presets.js';
import { PALETTES, paletteChain } from '../src/lib/palettes.js';

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const styles = path.join(src, 'styles');

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
const css = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '');

function rules(text) {
  const out = [];
  const flat = text.replace(/@media[^{]+\{/g, '').replace(/@import[^;]+;/g, '');
  for (const chunk of flat.split('}')) {
    const at = chunk.indexOf('{');
    if (at === -1) continue;
    out.push({ selector: chunk.slice(0, at).trim(), body: chunk.slice(at + 1).trim() });
  }
  return out;
}

function importOrder(file, out = []) {
  for (const m of read(file).matchAll(/@import\s+'([^']+)'/g)) {
    const next = path.join(path.dirname(file), m[1]);
    out.push(next);
    importOrder(next, out);
  }
  return out;
}

const layoutDirs = fs.readdirSync(path.join(styles, 'layouts'));
const declared = (body) => body.split(';').map(s => s.trim()).filter(Boolean).map(s => s.split(':')[0].trim());

test('every layout defines the same flags, with the same kind of value', () => {
  const keys = Object.keys(LAYOUTS.card).sort();
  for (const layout of Object.values(LAYOUTS)) {
    assert.deepEqual(Object.keys(layout).sort(), keys, layout.id + ' declares every flag');
    for (const k of keys) assert.equal(typeof layout[k], typeof LAYOUTS.card[k], layout.id + '.' + k);
  }
});

test('every preset names a layout that exists, and has a stylesheet folder for it', () => {
  for (const p of PRESETS) {
    assert.ok(LAYOUTS[p.layout], p.id + ' names layout ' + p.layout);
    assert.equal(layoutOf(p.id), LAYOUTS[p.layout]);
  }
  assert.equal(layoutOf(undefined), LAYOUTS[presetById(DEFAULT_PRESET).layout]);
  assert.deepEqual([...layoutDirs].sort(), Object.keys(LAYOUTS).sort(), 'one folder under styles/layouts per layout');
});

test('app.css pulls in every palette and layout stylesheet', () => {
  const order = importOrder(path.join(styles, 'app.css')).map(rel);
  for (const f of walk(path.join(styles, 'palettes'), ['.css']).concat(walk(path.join(styles, 'layouts'), ['.css']))) {
    assert.ok(order.includes(rel(f)), rel(f) + ' is imported');
  }
});

test('stylesheets are keyed by role: no preset selectors, and each layout stays in its own folder', () => {
  for (const f of walk(styles, ['.css'])) {
    const name = rel(f);
    const text = css(f);
    assert.ok(!/data-preset/.test(text), name + ' must not select on data-preset');
    assert.ok(!/data-theme="(?!light"|dark")/.test(text), name + ' may only use data-theme for light or dark');
    for (const m of text.matchAll(/data-layout="([^"]+)"/g)) {
      assert.ok(name.startsWith('styles/layouts/' + m[1] + '/'), name + ' mentions the ' + m[1] + ' layout outside styles/layouts/' + m[1]);
    }
  }
});

test('layout files only select under their own layout and never need !important', () => {
  for (const id of layoutDirs) {
    for (const f of walk(path.join(styles, 'layouts', id), ['.css'])) {
      const text = css(f);
      assert.ok(!/!important/.test(text), rel(f) + ' uses !important');
      for (const { selector } of rules(text)) {
        for (const part of selector.split(',').map(s => s.trim()).filter(Boolean)) {
          assert.ok(part.includes('data-layout="' + id + '"'), rel(f) + ' has a selector outside its layout: ' + part);
        }
      }
    }
  }
});

test('every layout declares the same layout tokens', () => {
  const sets = layoutDirs.map(id => {
    const blocks = rules(css(path.join(styles, 'layouts', id, 'tokens.css')));
    assert.equal(blocks.length, 1, id + '/tokens.css is a single block');
    assert.equal(blocks[0].selector, ':root[data-layout="' + id + '"]');
    const names = declared(blocks[0].body);
    assert.ok(names.every(n => n.startsWith('--')), id + '/tokens.css only declares custom properties');
    return [id, names.sort()];
  });
  for (const [id, names] of sets) assert.deepEqual(names, sets[0][1], id + ' declares the same tokens as ' + sets[0][0]);
});

test('palette files only declare tokens for registered palettes, base before variant', () => {
  const known = new Set(PALETTES.map(p => p.id));
  const seen = [];
  for (const f of importOrder(path.join(styles, 'app.css')).filter(f => rel(f).startsWith('styles/palettes/'))) {
    for (const { selector, body } of rules(css(f))) {
      const m = /^:root\[data-palette~="([^"]+)"\]( ::selection)?$/.exec(selector);
      assert.ok(m, rel(f) + ' selects something other than a palette: ' + selector);
      assert.ok(known.has(m[1]), rel(f) + ' styles unknown palette ' + m[1]);
      if (m[2]) continue;
      assert.ok(declared(body).every(n => n.startsWith('--')), rel(f) + ' sets a property other than a token for ' + m[1]);
      seen.push(m[1]);
    }
  }
  for (const p of PALETTES) {
    assert.ok(seen.includes(p.id), p.id + ' has a token block');
    const chain = paletteChain(p.id);
    for (let i = 1; i < chain.length; i++) {
      assert.ok(seen.indexOf(chain[i - 1]) < seen.indexOf(chain[i]), chain[i] + ' comes after the palette it builds on');
    }
  }
});

test('components branch on layout flags, not on which preset is active', () => {
  const ids = PRESETS.map(p => p.id).join('|');
  const compare = new RegExp("(===|!==)\\s*'(" + ids + ")'|'(" + ids + ")'\\s*(===|!==)");
  for (const f of walk(src, ['.js', '.jsx'])) {
    const name = rel(f);
    if (name.startsWith('locales/') || name === 'lib/presets.js') continue;
    read(f).split('\n').forEach((line, i) => {
      if (compare.test(line)) assert.fail(name + ':' + (i + 1) + ' compares a preset by name; read lib/presets.js or a flag from lib/layout.js instead');
    });
  }
});

test('every layout flag a component reads exists', () => {
  const known = new Set(Object.keys(LAYOUTS.card));
  for (const f of walk(src, ['.js', '.jsx'])) {
    if (rel(f) === 'lib/layout.js') continue;
    for (const m of read(f).matchAll(/(?<![\w/.])layout\.([A-Za-z]+)\b/g)) {
      assert.ok(known.has(m[1]), rel(f) + ' reads layout.' + m[1] + ' which no layout defines');
    }
  }
});