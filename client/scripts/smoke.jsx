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
import PromptLedger from '../src/components/dialogs/PromptLedger.jsx';
import ShortcutsModal from '../src/components/dialogs/ShortcutsModal.jsx';
import KeybindsPanel from '../src/components/settings/KeybindsPanel.jsx';
import BranchTree from '../src/components/chat/BranchTree.jsx';
import Login from '../src/components/pages/Login.jsx';
import ArtifactsPanel from '../src/components/artifacts/ArtifactsPanel.jsx';
import Viewer from '../src/components/artifacts/Viewer.jsx';
import Composer from '../src/components/composer/Composer.jsx';
import ModelDropdown from '../src/components/composer/ModelDropdown.jsx';
import ModelDocs from '../src/components/pages/ModelDocs.jsx';
import Playground from '../src/components/pages/Playground.jsx';
import DocsNav from '../src/components/sidebar/DocsNav.jsx';
import { docsConfig, docsTree, docsModels } from '../src/lib/modeldocs.js';
import { AdminProvider } from '../src/components/admin/store.jsx';
import InterfaceSection from '../src/components/admin/sections/InterfaceSection.jsx';
import EventsSection from '../src/components/admin/sections/EventsSection.jsx';
import FilesSection from '../src/components/admin/sections/FilesSection.jsx';
import GuardrailsSection from '../src/components/admin/sections/GuardrailsSection.jsx';
import LauncherSection from '../src/components/admin/sections/LauncherSection.jsx';
import McpSection from '../src/components/admin/sections/McpSection.jsx';
import MembersSection from '../src/components/admin/sections/MembersSection.jsx';
import MemorySection from '../src/components/admin/sections/MemorySection.jsx';
import ModelsSection from '../src/components/admin/sections/ModelsSection.jsx';
import Catalog from '../src/components/admin/models/Catalog.jsx';
import Inspector from '../src/components/admin/models/Inspector.jsx';
import { EditorProvider } from '../src/components/admin/models/bind.jsx';
import GeneralTab from '../src/components/admin/models/tabs/General.jsx';
import PromptsTab from '../src/components/admin/models/tabs/Prompts.jsx';
import ToolsTab from '../src/components/admin/models/tabs/Tools.jsx';
import ReasoningTab from '../src/components/admin/models/tabs/Reasoning.jsx';
import ContextTab from '../src/components/admin/models/tabs/Context.jsx';
import SamplingTab from '../src/components/admin/models/tabs/Sampling.jsx';
import ControlsTab from '../src/components/admin/models/tabs/Controls.jsx';
import AppearanceTab from '../src/components/admin/models/tabs/Appearance.jsx';
import RoutingTab from '../src/components/admin/models/tabs/Routing.jsx';
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
cases.push(['PromptLedger', () => React.createElement(PromptLedger, { chatId: 'c1', modelId: 'm1', onClose: noop })]);
cases.push(['ShortcutsModal', () => React.createElement(ShortcutsModal, { prefs: {}, onClose: noop, onCustomize: noop })]);
cases.push(['KeybindsPanel', () => React.createElement(KeybindsPanel, { prefs: {}, setPref: noop })]);
cases.push(['BranchTree', () => React.createElement(BranchTree, { chatId: 'c1', onSelect: noop, onJump: noop, onClose: noop, onChanged: noop })]);
cases.push(['Login:signin', () => React.createElement(Login, { onLogin: noop, cfg: { allowSignups: true, firstRun: false } })]);
cases.push(['Login:firstrun', () => React.createElement(Login, { onLogin: noop, cfg: { allowSignups: true, firstRun: true } })]);

// A model carrying every kwarg control shape, so the editor's range branch and the
// user-facing slider are both actually rendered rather than only compiled.
const kwargModel = {
  ...plain, id: 'm3', display_name: 'Tuned', badges: ['text', 'reasoning'], kwargs: [
    { id: 'b', name: 'thinking_budget_tokens', label: 'Thinking budget', target: 'body', type: 'number', min: 1024, max: 8192, step: 1024, default: '1024', values: [], showIf: { id: 'think', value: 'true' } },
    { id: 'think', name: 'enable_thinking', label: 'Extended thinking', values: ['false', 'true'], default: 'false' },
    { id: 'eff', name: 'reasoning_effort', values: ['low', 'medium', 'high'], default: 'medium' },
    { id: 'keep', name: 'preserve_thinking', values: ['false', 'true'], parentId: 'think', rules: [{ when: 'true', value: 'true', send: true }] }
  ]
};
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

cases.push(['Playground:cold', () => React.createElement(Playground, { onClose: noop })]);

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

const docsModelList = [
  {
    id: 'm1', displayName: 'Sonata', description: 'Everyday model', numCtx: 200000,
    docsBadge: 'latest', docsMaxOutput: 64000, docsCutoff: 'Jan 2026', docsLatency: 'Fast',
    docsThinking: 'Adaptive', docsEffort: 'high', docsBody: 'A paragraph.', docsNotes: 'One\nTwo',
    docsIds: [{ label: 'Chat API', value: 'sonata-1' }], docsPlatforms: ['Local'],
    docsLinks: [{ label: 'Announcement', url: 'https://example.invalid', ext: true }],
    docsResources: [{ title: 'Prompting', desc: 'Guidance', url: '' }],
    docsReference: [{ title: 'Pricing', desc: 'Rates', url: '' }],
    docsIn: { text: true, image: true }, docsOut: { text: true },
    docsIntelligence: 4, docsSpeed: 4, priceIn: 2, priceOut: 10, docsFeatured: true
  },
  {
    id: 'm2', displayName: 'Aria', description: 'Fast model', numCtx: 32000, docsGroup: 'Legacy models',
    docsBadge: 'legacy', docsIds: [], docsPlatforms: [], docsLinks: [], docsResources: [], docsReference: [],
    docsIn: { text: true }, docsOut: { text: true },
    docsNotice: 'Retiring soon.', docsNoticeAction: 'See Sonata', docsNoticeUrl: 'm1'
  }
];
const docsCfg = docsConfig({ sections: [{ id: 'guides', label: 'Guides', pages: [{ id: 'p1', title: 'Choosing a model', subtitle: 'How to pick', body: '# Hello\n\nBody text.' }] }] });
const makeDocsEdit = (editing) => ({
  editing, modelEdits: {}, baseModels: docsModels(docsModelList), liveModels: docsModels(docsModelList), liveCfg: docsCfg,
  setModelField: noop, setCfgField: noop, dirty: false, saving: false, error: '', start: noop, cancel: noop, save: noop
});
const docsProps = { appName: 'open-quill', onTry: noop, onNavigate: noop, onExit: noop, edit: makeDocsEdit(false) };
const docsEditProps = { ...docsProps, isAdmin: true, edit: makeDocsEdit(true) };
cases.push(['ModelDocs:overview', () => React.createElement(ModelDocs, { ...docsProps, target: { kind: 'overview', id: null } })]);
cases.push(['ModelDocs:model', () => React.createElement(ModelDocs, { ...docsProps, target: { kind: 'model', id: 'm1' } })]);
cases.push(['ModelDocs:legacy', () => React.createElement(ModelDocs, { ...docsProps, target: { kind: 'model', id: 'm2' } })]);
cases.push(['ModelDocs:page', () => React.createElement(ModelDocs, { ...docsProps, target: { kind: 'page', id: 'p1' } })]);
cases.push(['ModelDocs:missing', () => React.createElement(ModelDocs, { ...docsProps, target: { kind: 'model', id: 'gone' } })]);
cases.push(['ModelDocs:admin', () => React.createElement(ModelDocs, { ...docsProps, isAdmin: true, target: { kind: 'model', id: 'm1' } })]);
cases.push(['ModelDocs:adminOverview', () => React.createElement(ModelDocs, { ...docsProps, isAdmin: true, target: { kind: 'overview', id: null } })]);
cases.push(['ModelDocs:editing', () => React.createElement(ModelDocs, { ...docsEditProps, target: { kind: 'model', id: 'm1' } })]);
cases.push(['DocsNav', () => React.createElement(DocsNav, {
  tree: docsTree(docsModelList, docsCfg), target: { kind: 'overview', id: null },
  onSelect: noop, onExit: noop, appName: 'open-quill'
})]);
cases.push(['DocsNav:editing', () => React.createElement(DocsNav, {
  tree: docsTree(docsModelList, docsCfg, { includeEmpty: true }), target: { kind: 'overview', id: null },
  onSelect: noop, onExit: noop, appName: 'open-quill', editing: true,
  onAddTab: noop, onAddPage: noop, onRemoveTab: noop, onRemovePage: noop, onRenameTab: noop
})]);

// admin sections read everything from AdminProvider, so they need the context to render at all.
// renderToString does not run effects, so the provider's API calls never fire here.
const ADMIN_SECTIONS = [
  ['Interface', InterfaceSection], ['Events', EventsSection], ['Files', FilesSection],
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

const MODEL_TABS = [
  ['General', GeneralTab], ['Prompts', PromptsTab], ['Tools', ToolsTab], ['Reasoning', ReasoningTab],
  ['Context', ContextTab], ['Sampling', SamplingTab], ['Controls', ControlsTab], ['Appearance', AppearanceTab],
  ['Routing', RoutingTab]
];
const mixedModels = [
  { ...router, system_prompt: 'one', unavailable: 1, sunset_at: '2030-01-01', end_chat_allowed: 1, in_more_models: 1, more_models_label: 'Fast' },
  { ...plain, system_prompt: 'two', has_reasoning: 1, sandbox_allowed: 0 },
  { ...kwargModel, effort_enabled: 1, bg_enabled: 1 }
];
const legacyModel = { ...plain, id: 'm4', kwargs: [], effort_enabled: 1, effort_levels: ['low', 'high'] };
const inAdmin = (child) => React.createElement(AdminProvider, { user: adminUser, onClose: noop }, child);
const editing = (list, Tab) => inAdmin(React.createElement(EditorProvider, { models: list, edit: noop }, React.createElement(Tab)));
for (const [name, Tab] of MODEL_TABS) {
  cases.push(['ModelTab:' + name + ':single', () => editing([kwargModel], Tab)]);
  cases.push(['ModelTab:' + name + ':legacy', () => editing([legacyModel], Tab)]);
  cases.push(['ModelTab:' + name + ':mixed', () => editing(mixedModels, Tab)]);
}
cases.push(['ModelsCatalog', () => inAdmin(React.createElement(Catalog))]);
cases.push(['ModelsInspector:idle', () => inAdmin(React.createElement(Inspector, { models: [] }))]);
cases.push(['ModelsInspector:single', () => inAdmin(React.createElement(Inspector, { models: [kwargModel] }))]);
cases.push(['ModelsInspector:mixed', () => inAdmin(React.createElement(Inspector, { models: mixedModels }))]);

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
