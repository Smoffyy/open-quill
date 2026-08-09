import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const keys = new Set();
const re = /\bt[k]?\(\s*("((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)')/g;

function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (f !== 'locales') walk(p); }
    else if (f.endsWith('.jsx') || f.endsWith('.js')) {
      const src = fs.readFileSync(p, 'utf8');
      let m;
      while ((m = re.exec(src))) keys.add((m[2] ?? m[3]).replace(/\\'/g, "'").replace(/\\"/g, '"'));
    }
  }
}
walk(SRC);
const scSrc = fs.readFileSync(path.join(SRC, 'components/ShortcutsModal.jsx'), 'utf8');
for (const m of scSrc.matchAll(/title:\s*'((?:[^'\\]|\\.)*)'/g)) if (m[1]) keys.add(m[1].replace(/\\'/g, "'"));
for (const m of scSrc.matchAll(/\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*\[/g)) if (m[1]) keys.add(m[1].replace(/\\'/g, "'"));
const kbSrc = fs.readFileSync(path.join(SRC, 'lib/keybinds.js'), 'utf8');
for (const m of kbSrc.matchAll(/\b(?:label|group):\s*'((?:[^'\\]|\\.)*)'/g)) if (m[1]) keys.add(m[1].replace(/\\'/g, "'"));
for (const extra of ['Custom']) keys.add(extra);
for (const extra of ['Ideas','Write','Code','Learn','Life stuff','Give me ideas on what I should do today.','Write a one paragraph summary about how Large Language Models (LLMs) work.','Write a Python function that checks whether a string is a palindrome.','How far away is the sun from Earth?','Give me practical advice for a life problem.','Greetings, whoever you are','No names, no traces','This one stays between us','Off the record','How can I help you?','Assistants can make mistakes, double-check responses.','Advanced','Tools','Saved ✓','Effort','Context','Icons','Sandbox','Grouped','Vision','Reasoning','Appearance','Low','Fair','Medium','High','Highest','Slow','Steady','Fast','Fastest','Text','Image','Audio','Video','Docs','toggle','slider','dropdown','Top level of the request','Boolean','Number','String','On/off toggle','Slider','Dropdown','Users get an on/off switch.','Users get a segmented slider through every value.','Users get a dropdown of every value.','Blank kwarg','An empty kwarg you fill in yourself.','On/off thinking toggle with false and true.','A slider through low, medium, and high.','Hidden kwarg meant to follow a thinking toggle.','change','changes','user','assistant','system','Temperature','Top P','Top K','Min P','Repetition penalty','Presence penalty','Frequency penalty','Max tokens','Context window','Seed','System prompt','Extended-mode trigger','Standard-mode trigger']) keys.add(extra);

const localesDir = path.join(SRC, 'locales');
let fail = false;
for (const f of fs.readdirSync(localesDir)) {
  if (!f.endsWith('.json') || f === 'en.json') continue;
  const dict = JSON.parse(fs.readFileSync(path.join(localesDir, f), 'utf8'));
  const missing = [...keys].filter(k => !(k in dict));
  const orphaned = Object.keys(dict).filter(k => k !== '_meta' && !keys.has(k));
  if (missing.length) { fail = true; console.log(`${f}: ${missing.length} missing`); missing.forEach(k => console.log('  - ' + k)); }
  if (orphaned.length) { console.log(`${f}: ${orphaned.length} orphaned`); orphaned.forEach(k => console.log('  ~ ' + k)); }
  if (!missing.length && !orphaned.length) console.log(`${f}: complete (${keys.size} keys)`);
}
process.exit(fail ? 1 : 0);
