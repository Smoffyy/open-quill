import { Panel, Cube, Sliders, Sparkles, Chat, Users, Globe, Mic, Brain, FileText, Bulb, Plug, Shield, Star, Clock, Gear, Wave } from '../icons.jsx';

export const NAV_GROUPS = [
  { id: 'root', label: '', items: [
    { id: 'dashboard', label: 'Dashboard', desc: 'A live snapshot of the workspace: catalog, people, spend, and recent activity.', Icon: Panel, keywords: 'overview home stats snapshot' }
  ] },
  { id: 'catalog', label: 'Catalog', items: [
    { id: 'models', label: 'Models', desc: 'The catalog users pick from. Prompts, abilities, look, and pricing per model.', Icon: Cube, keywords: 'llm edit prompt catalog assistants' },
    { id: 'providers', label: 'Providers', desc: 'The LLM backends your models run through.', Icon: Sliders, keywords: 'backend connection endpoint api key' }
  ] },
  { id: 'workspace', label: 'Workspace', items: [
    { id: 'appearance', label: 'Appearance', desc: 'Name, icon, interface preset, and typography across every client.', Icon: Sparkles, keywords: 'branding logo font preset theme disclaimer identity' },
    { id: 'homescreen', label: 'Home Screen', desc: 'The greetings and quick prompts users see when they start a new chat.', Icon: Chat, keywords: 'greeting welcome quick prompts buttons' },
    { id: 'members', label: 'Members', desc: 'Everyone who has signed in: roles, budgets, and account removal.', Icon: Users, keywords: 'users people roles admins accounts' }
  ] },
  { id: 'capabilities', label: 'Capabilities', items: [
    { id: 'websearch', label: 'Web Search', desc: 'Give models a web search tool backed by your own SearXNG instance.', Icon: Globe, keywords: 'searxng internet browse search engine' },
    { id: 'voice', label: 'Voice', desc: 'Dictation and voice calls, speech-to-text and text-to-speech engines.', Icon: Mic, keywords: 'stt tts speech call whisper dictation' },
    { id: 'memory', label: 'Memory', desc: 'Per-user long-term memory and searching past chats as a tool.', Icon: Brain, keywords: 'user memory history chat search remember' },
    { id: 'membank', label: 'Memory Bank', desc: 'Reference files every model can read on demand.', Icon: FileText, keywords: 'files knowledge documents reference' },
    { id: 'skills', label: 'Skills', desc: 'Reusable instruction files models load on demand for specific tasks.', Icon: Bulb, keywords: 'instructions markdown playbooks' },
    { id: 'mcp', label: 'Connectors', desc: 'Connect local MCP servers and expose their tools to every model.', Icon: Plug, keywords: 'mcp servers tools protocol integrations' },
    { id: 'safety', label: 'Safety', desc: 'Screen user prompts with a model before they reach the assistant.', Icon: Shield, keywords: 'moderation filter blocked screening guardrails' }
  ] },
  { id: 'insights', label: 'Insights', items: [
    { id: 'analytics', label: 'Analytics', desc: 'Workspace-wide token use, estimated cost, and price presets.', Icon: Wave, keywords: 'usage tokens cost spend pricing charts' },
    { id: 'feedback', label: 'Feedback', desc: 'Thumbs up and down users left on responses, for reviewing model quality.', Icon: Star, keywords: 'ratings thumbs reviews quality' }
  ] },
  { id: 'governance', label: 'Governance', items: [
    { id: 'limits', label: 'Limits & Budgets', desc: 'Guardrails applied across the app. These take effect immediately.', Icon: Gear, keywords: 'uploads sandbox sessions queue budgets caps' },
    { id: 'audit', label: 'Audit Log', desc: 'A record of sensitive admin actions. Pruned after 120 days.', Icon: Clock, keywords: 'log history actions security trail' }
  ] }
];

export const SECTIONS = NAV_GROUPS.flatMap(g => g.items.map(it => ({ ...it, group: g.label })));

export const LEGACY_SECTION_IDS = { overview: 'dashboard', branding: 'appearance', home: 'homescreen' };

export function sectionById(id) {
  return SECTIONS.find(s => s.id === id) || SECTIONS[0];
}
