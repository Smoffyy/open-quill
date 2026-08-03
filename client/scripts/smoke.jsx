import React from 'react';
import { renderToString } from 'react-dom/server';
import ModelEditor, { ME_SECTIONS } from '../src/components/admin/ModelEditor.jsx';
import PromptLedger from '../src/components/PromptLedger.jsx';
import ShortcutsModal from '../src/components/ShortcutsModal.jsx';
import KeybindsPanel from '../src/components/KeybindsPanel.jsx';
import BranchTree from '../src/components/BranchTree.jsx';
import Login from '../src/components/Login.jsx';
import { AdminProvider } from '../src/components/admin/store.jsx';
import AnalyticsSection from '../src/components/admin/sections/AnalyticsSection.jsx';
import AppearanceSection from '../src/components/admin/sections/AppearanceSection.jsx';
import AuditSection from '../src/components/admin/sections/AuditSection.jsx';
import DashboardSection from '../src/components/admin/sections/DashboardSection.jsx';
import DatabasesSection from '../src/components/admin/sections/DatabasesSection.jsx';
import FeedbackSection from '../src/components/admin/sections/FeedbackSection.jsx';
import HomeScreenSection from '../src/components/admin/sections/HomeScreenSection.jsx';
import LimitsSection from '../src/components/admin/sections/LimitsSection.jsx';
import McpSection from '../src/components/admin/sections/McpSection.jsx';
import MembankSection from '../src/components/admin/sections/MembankSection.jsx';
import MembersSection from '../src/components/admin/sections/MembersSection.jsx';
import MemorySection from '../src/components/admin/sections/MemorySection.jsx';
import ModelsSection from '../src/components/admin/sections/ModelsSection.jsx';
import PrivacySection from '../src/components/admin/sections/PrivacySection.jsx';
import ProvidersSection from '../src/components/admin/sections/ProvidersSection.jsx';
import SafetySection from '../src/components/admin/sections/SafetySection.jsx';
import SkillsSection from '../src/components/admin/sections/SkillsSection.jsx';
import VoiceSection from '../src/components/admin/sections/VoiceSection.jsx';
import WebSearchSection from '../src/components/admin/sections/WebSearchSection.jsx';

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

// admin sections read everything from AdminProvider, so they need the context to render at all.
// renderToString does not run effects, so the provider's API calls never fire here.
const ADMIN_SECTIONS = [
  ['Analytics', AnalyticsSection], ['Appearance', AppearanceSection], ['Audit', AuditSection],
  ['Dashboard', DashboardSection], ['Databases', DatabasesSection], ['Feedback', FeedbackSection],
  ['HomeScreen', HomeScreenSection], ['Limits', LimitsSection], ['Mcp', McpSection],
  ['Membank', MembankSection], ['Members', MembersSection], ['Memory', MemorySection],
  ['Models', ModelsSection], ['Privacy', PrivacySection], ['Providers', ProvidersSection],
  ['Safety', SafetySection], ['Skills', SkillsSection], ['Voice', VoiceSection],
  ['WebSearch', WebSearchSection],
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
