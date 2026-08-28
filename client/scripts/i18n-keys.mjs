import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const SRC = fileURLToPath(new URL('../src', import.meta.url));
export const LOCALES = path.join(SRC, 'locales');

export const SOURCE_LANG = 'en';

const CALL_RE = /\bt[k]?\(\s*("((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;

const unescape = (s) => s.replace(/\\'/g, "'").replace(/\\"/g, '"');

const EXTRA_KEYS = [
  'Custom',
  'Ideas', 'Write', 'Code', 'Learn', 'Life stuff',
  'Give me ideas on what I should do today.',
  'Write a one paragraph summary about how Large Language Models (LLMs) work.',
  'Write a Python function that checks whether a string is a palindrome.',
  'How far away is the sun from Earth?',
  'Give me practical advice for a life problem.',
  'Greetings, whoever you are', 'No names, no traces', 'This one stays between us', 'Off the record',
  'How can I help you?', 'Assistants can make mistakes, double-check responses.',
  'Advanced', 'Tools', 'Effort', 'Context', 'Icons', 'Sandbox', 'Grouped', 'Vision', 'Reasoning', 'Appearance',
  'Low', 'Fair', 'Medium', 'High', 'Highest', 'Slow', 'Steady', 'Fast', 'Fastest',
  'Text', 'Image', 'Audio', 'Video', 'Docs',
  'toggle', 'slider', 'dropdown', 'Top level of the request',
  'Boolean', 'Number', 'String', 'On/off toggle', 'Slider', 'Dropdown',
  'Users get an on/off switch.', 'Users get a segmented slider through every value.',
  'Users get a dropdown of every value.',
  'Blank kwarg', 'An empty kwarg you fill in yourself.',
  'On/off thinking toggle with false and true.', 'A slider through low, medium, and high.',
  'Hidden kwarg meant to follow a thinking toggle.',
  'change', 'changes', 'user', 'assistant', 'system',
  'Temperature', 'Top P', 'Top K', 'Min P', 'Repetition penalty', 'Presence penalty',
  'Frequency penalty', 'Max tokens', 'Context window', 'Seed', 'System prompt',
  'Extended-mode trigger', 'Standard-mode trigger',
];

const TABLE_SCANS = [
  { file: 'components/ShortcutsModal.jsx', re: /title:\s*'((?:[^'\\]|\\.)*)'/g },
  { file: 'components/ShortcutsModal.jsx', re: /\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*\[/g },
  { file: 'lib/keybinds.js', re: /\b(?:label|group):\s*'((?:[^'\\]|\\.)*)'/g },
];

function walk(dir, keys) {
  for (const f of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (f !== 'locales') walk(p, keys);
    } else if (f.endsWith('.jsx') || f.endsWith('.js')) {
      const src = fs.readFileSync(p, 'utf8');
      let m;
      while ((m = CALL_RE.exec(src))) keys.add(unescape(m[2] ?? m[3]));
    }
  }
}

export function collectKeys() {
  const keys = new Set();
  walk(SRC, keys);
  for (const { file, re } of TABLE_SCANS) {
    const src = fs.readFileSync(path.join(SRC, file), 'utf8');
    for (const m of src.matchAll(re)) if (m[1]) keys.add(unescape(m[1]));
  }
  for (const k of EXTRA_KEYS) keys.add(k);
  return keys;
}

export function packFiles() {
  return fs.readdirSync(LOCALES)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => ({ code: path.basename(f, '.json'), file: f, path: path.join(LOCALES, f) }));
}

export function readPack(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writePack(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

export function auditPack(dict, keys) {
  const missing = [...keys].filter(k => !(k in dict));
  const orphaned = Object.keys(dict).filter(k => k !== '_meta' && !keys.has(k));
  return { missing, orphaned };
}
