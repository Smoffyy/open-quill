import React from 'react';
import { renderToString } from 'react-dom/server';
import ModelEditor, { ME_SECTIONS } from '../src/components/admin/ModelEditor.jsx';
import PromptLedger from '../src/components/PromptLedger.jsx';
import ShortcutsModal from '../src/components/ShortcutsModal.jsx';
import KeybindsPanel from '../src/components/KeybindsPanel.jsx';
import BranchTree from '../src/components/BranchTree.jsx';
import Login from '../src/components/Login.jsx';

const router = { id: 'm1', display_name: 'Hub', internal_name: 'hub', kind: 'router', router_default: 'm2',
  router_rules: [{ match: 'keyword', value: 'code', modelId: 'm2', label: 'coding' }] };
const plain = { ...router, id: 'm2', display_name: 'Coder', kind: 'model', router_rules: [], router_default: '' };
const models = [router, plain];
const noop = () => {};

const cases = [];
for (const [section] of ME_SECTIONS) {
  cases.push(['ModelEditor:' + section, () => React.createElement(ModelEditor, {
    m: router, onChange: noop, onDelete: noop, onDuplicate: noop, autosaveState: 'idle',
    providers: [{ id: 'p1', name: 'Local', type: 'openai' }], providerTypes: { openai: { label: 'OpenAI' } },
    models, section, onSection: noop,
  })]);
}
cases.push(['PromptLedger', () => React.createElement(PromptLedger, { chatId: 'c1', modelId: 'm1', onClose: noop })]);
cases.push(['ShortcutsModal', () => React.createElement(ShortcutsModal, { prefs: {}, onClose: noop, onCustomize: noop })]);
cases.push(['KeybindsPanel', () => React.createElement(KeybindsPanel, { prefs: {}, setPref: noop })]);
cases.push(['BranchTree', () => React.createElement(BranchTree, { chatId: 'c1', onSelect: noop, onJump: noop, onClose: noop, onChanged: noop })]);
cases.push(['Login:signin', () => React.createElement(Login, { onLogin: noop, cfg: { allowSignups: true, firstRun: false } })]);
cases.push(['Login:firstrun', () => React.createElement(Login, { onLogin: noop, cfg: { allowSignups: true, firstRun: true } })]);

let failed = 0;
for (const [name, make] of cases) {
  try {
    renderToString(make());
    console.log('  ok    ' + name);
  } catch (e) {
    failed++;
    console.error('  CRASH ' + name + ' -> ' + e.message);
  }
}
if (failed) {
  console.error(`\nsmoke: ${failed} component(s) crashed while rendering.`);
  process.exit(1);
}
console.log('\nsmoke: all ' + cases.length + ' components render.');
