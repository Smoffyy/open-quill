// Components that read localStorage or window geometry while rendering would
// otherwise crash on the environment rather than on anything this test is meant to
// catch. Node has neither by default.
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
    setItem: (k, v) => { store.set(String(k), String(v)); },
    removeItem: (k) => { store.delete(String(k)); },
    clear: () => store.clear()
  };
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = { innerWidth: 1440, innerHeight: 900, localStorage: globalThis.localStorage };
}

import React from 'react';
import { renderToString } from 'react-dom/server';
import ModelEditor from '../src/components/admin/ModelEditor.jsx';
import PromptLedger from '../src/components/PromptLedger.jsx';
import ShortcutsModal from '../src/components/ShortcutsModal.jsx';
import KeybindsPanel from '../src/components/KeybindsPanel.jsx';
import BranchTree from '../src/components/BranchTree.jsx';
import Login from '../src/components/Login.jsx';
import ArtifactsPanel from '../src/components/ArtifactsPanel.jsx';
import Viewer from '../src/components/artifacts/Viewer.jsx';
import Composer from '../src/components/Composer.jsx';
import ModelDropdown from '../src/components/ModelDropdown.jsx';
import { AdminProvider } from '../src/components/admin/store.jsx';
import BrandingSection from '../src/components/admin/sections/BrandingSection.jsx';
import EventsSection from '../src/components/admin/sections/EventsSection.jsx';
import FilesSection from '../src/components/admin/sections/FilesSection.jsx';
import GuardrailsSection from '../src/components/admin/sections/GuardrailsSection.jsx';
import LauncherSection from '../src/components/admin/sections/LauncherSection.jsx';
import McpSection from '../src/components/admin/sections/McpSection.jsx';
import MembersSection from '../src/components/admin/sections/MembersSection.jsx';
import MemorySection from '../src/components/admin/sections/MemorySection.jsx';
import ModelsSection from '../src/components/admin/sections/ModelsSection.jsx';
import NetworkSection from '../src/components/admin/sections/NetworkSection.jsx';
import OverviewSection from '../src/components/admin/sections/OverviewSection.jsx';
import ProvidersSection from '../src/components/admin/sections/ProvidersSection.jsx';
import QuotasSection from '../src/components/admin/sections/QuotasSection.jsx';
import RatingsSection from '../src/components/admin/sections/RatingsSection.jsx';
import SearchSection from '../src/components/admin/sections/SearchSection.jsx';
import SkillsSection from '../src/components/admin/sections/SkillsSection.jsx';
import StorageSection from '../src/components/admin/sections/StorageSection.jsx';
import UsageSection from '../src/components/admin/sections/UsageSection.jsx';
import VoiceSection from '../src/components/admin/sections/VoiceSection.jsx';

const router = { id: 'm1', display_name: 'Hub', internal_name: 'hub', kind: 'router', router_default: 'm2',
  router_rules: [{ match: 'keyword', value: 'code', modelId: 'm2', label: 'coding' }] };
const plain = { ...router, id: 'm2', display_name: 'Coder', kind: 'model', router_rules: [], router_default: '' };
const models = [router, plain];
const noop = () => {};

const cases = [];
cases.push(['ModelEditor:router', () => React.createElement(ModelEditor, {
  model: router, models, onChange: noop, onBack: noop, onDelete: noop, onDuplicate: noop,
  saveState: 'idle',
  providers: [{ id: 'p1', name: 'Local', type: 'openai' }], providerTypes: { openai: { label: 'OpenAI' } }
})]);
cases.push(['PromptLedger', () => React.createElement(PromptLedger, { chatId: 'c1', modelId: 'm1', onClose: noop })]);
cases.push(['ShortcutsModal', () => React.createElement(ShortcutsModal, { prefs: {}, onClose: noop, onCustomize: noop })]);
cases.push(['KeybindsPanel', () => React.createElement(KeybindsPanel, { prefs: {}, setPref: noop })]);
cases.push(['BranchTree', () => React.createElement(BranchTree, { chatId: 'c1', onSelect: noop, onJump: noop, onClose: noop, onChanged: noop })]);
cases.push(['Login:signin', () => React.createElement(Login, { onLogin: noop, cfg: { allowSignups: true, firstRun: false } })]);
cases.push(['Login:firstrun', () => React.createElement(Login, { onLogin: noop, cfg: { allowSignups: true, firstRun: true } })]);

// A model carrying every kwarg control shape, so the editor's range branch and the
// user-facing slider are both actually rendered rather than only compiled.
const kwargModel = {
  ...plain, id: 'm3', display_name: 'Tuned', kwargs: [
    { id: 'b', name: 'thinking_budget_tokens', label: 'Thinking budget', target: 'body', type: 'number', min: 1024, max: 8192, step: 1024, default: '1024', values: [], showIf: { id: 'think', value: 'true' } },
    { id: 'think', name: 'enable_thinking', label: 'Extended thinking', values: ['false', 'true'], default: 'false' },
    { id: 'eff', name: 'reasoning_effort', values: ['low', 'medium', 'high'], default: 'medium' },
    { id: 'keep', name: 'preserve_thinking', values: ['false', 'true'], parentId: 'think', rules: [{ when: 'true', value: 'true', send: true }] }
  ]
};
cases.push(['ModelEditor:kwargs', () => React.createElement(ModelEditor, {
  model: kwargModel, models: [...models, kwargModel], onChange: noop, onBack: noop,
  onDelete: noop, onDuplicate: noop, saveState: 'idle',
  providers: [{ id: 'p1', name: 'Local', type: 'openai' }], providerTypes: { openai: { label: 'OpenAI' } }
})]);
cases.push(['ModelDropdown:kwargs:gateShut', () => React.createElement(ModelDropdown, {
  models: [kwargModel], currentId: 'm3', onSelect: noop, open: true, onClose: noop,
  isAdmin: true, kwargValues: {}, onSetKwarg: noop
})]);
cases.push(['ModelDropdown:kwargs:gateOpen', () => React.createElement(ModelDropdown, {
  models: [kwargModel], currentId: 'm3', onSelect: noop, open: true, onClose: noop,
  isAdmin: true, kwargValues: { think: 'true', b: '4096' }, onSetKwarg: noop
})]);

const composerProps = {
  value: '', onChange: noop, onSend: noop, onStop: noop, streaming: false,
  models, currentId: 'm2', onSelect: noop, placeholder: 'Ask anything',
  visionSupported: true, sandbox: false, onToggleSandbox: noop,
  webSearch: false, webSearchAvailable: true, onToggleWebSearch: noop,
  styles: [], styleId: 'normal', onSelectStyle: noop, onSaveStyles: noop,
  savedPrompts: [], onUsePrompt: noop, onSavePrompt: noop, onDeletePrompt: noop
};
cases.push(['Composer:idle', () => React.createElement(Composer, composerProps)]);
cases.push(['Composer:streaming', () => React.createElement(Composer, { ...composerProps, streaming: true, canSteer: true, onSteer: noop, onQueue: noop })]);
cases.push(['Composer:slash', () => React.createElement(Composer, { ...composerProps, value: '/', savedPrompts: [{ id: 'p1', title: 'Review', text: 'Review this' }] })]);

const artFiles = [
  { path: 'src/main.js', ext: 'js', v: 2, size: 900 },
  { path: 'README.md', ext: 'md', v: 1, size: 120 },
  { path: 'logo.png', ext: 'png', v: 1, size: 4096 }
];
cases.push(['ArtifactsPanel:empty', () => React.createElement(ArtifactsPanel, { chatId: 'c1', files: [], live: null, onClose: noop })]);
cases.push(['ArtifactsPanel:tree', () => React.createElement(ArtifactsPanel, { chatId: 'c1', files: artFiles, live: null, onClose: noop })]);
cases.push(['ArtifactsPanel:writing', () => React.createElement(ArtifactsPanel, {
  chatId: 'c1', files: artFiles, live: { path: 'src/new.js', content: 'let a = 1;\n', tool: 'create_file' },
  pending: { 'src/queued.js': 'pending text' }, onClose: noop
})]);
cases.push(['ArtifactsViewer:live', () => React.createElement(Viewer, {
  chatId: 'c1', path: 'src/main.js', onBack: noop, canBack: true,
  liveText: 'const x = 1;\nconst y = 2;\n', liveInfo: { path: 'src/main.js', tool: 'create_file' },
  writingElsewhere: null, onJumpToLive: noop, committed: false, fileV: 0
})]);
cases.push(['ArtifactsViewer:pending', () => React.createElement(Viewer, {
  chatId: 'c1', path: 'notes.txt', onBack: noop, canBack: false,
  liveText: null, writingElsewhere: 'other.js', onJumpToLive: noop,
  committed: false, pendingText: 'half a file', fileV: 0
})]);

// admin sections read everything from AdminProvider, so they need the context to render at all.
// renderToString does not run effects, so the provider's API calls never fire here.
const ADMIN_SECTIONS = [
  ['Branding', BrandingSection], ['Events', EventsSection], ['Files', FilesSection],
  ['Guardrails', GuardrailsSection], ['Launcher', LauncherSection], ['Mcp', McpSection],
  ['Members', MembersSection], ['Memory', MemorySection], ['Models', ModelsSection],
  ['Network', NetworkSection], ['Overview', OverviewSection], ['Providers', ProvidersSection],
  ['Quotas', QuotasSection], ['Ratings', RatingsSection], ['Search', SearchSection],
  ['Skills', SkillsSection], ['Storage', StorageSection], ['Usage', UsageSection],
  ['Voice', VoiceSection],
];
const adminUser = { id: 'u1', displayName: 'Admin', email: 'a@b.c', isAdmin: true, isOwner: true, prefs: {} };
for (const [name, Section] of ADMIN_SECTIONS) {
  cases.push(['AdminSection:' + name, () => React.createElement(
    AdminProvider, { user: adminUser, onClose: noop }, React.createElement(Section)
  )]);
}

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
