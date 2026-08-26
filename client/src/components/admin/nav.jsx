import { Panel, Cube, Sliders, Sparkles, Chat, Users, Globe, Mic, Brain, FileText, Bulb, Plug, Shield, Star, Clock, Gear, Wave, Box } from '../icons.jsx';
import { tk } from '../../i18n.jsx';

export const NAV_GROUPS = [
  { id: 'root', label: '', items: [
    { id: 'dashboard', label: tk('Dashboard'), desc: tk('A live snapshot of the workspace: catalog, people, spend, and recent activity.'), Icon: Panel, keywords: tk('overview home stats snapshot') }
  ] },
  { id: 'catalog', label: tk('Catalog'), items: [
    { id: 'models', label: tk('Models'), desc: tk('The catalog users pick from. Prompts, abilities, look, and pricing per model.'), Icon: Cube, keywords: tk('llm edit prompt catalog assistants') },
    { id: 'providers', label: tk('Providers'), desc: tk('The LLM backends your models run through.'), Icon: Sliders, keywords: tk('backend connection endpoint api key') }
  ] },
  { id: 'workspace', label: tk('Workspace'), items: [
    { id: 'appearance', label: tk('Appearance'), desc: tk('Name, icon, interface preset, and typography across every client.'), Icon: Sparkles, keywords: tk('branding logo font preset theme disclaimer identity') },
    { id: 'homescreen', label: tk('Home Screen'), desc: tk('The greetings and quick prompts users see when they start a new chat.'), Icon: Chat, keywords: tk('greeting welcome quick prompts buttons') },
    { id: 'members', label: tk('Members'), desc: tk('Everyone who has signed in: roles, budgets, and account removal.'), Icon: Users, keywords: tk('users people roles admins accounts') }
  ] },
  { id: 'capabilities', label: tk('Capabilities'), items: [
    { id: 'websearch', label: tk('Web Search'), desc: tk('Give models a web search tool backed by your own SearXNG instance.'), Icon: Globe, keywords: tk('searxng internet browse search engine') },
    { id: 'voice', label: tk('Voice'), desc: tk('Dictation and voice calls, speech-to-text and text-to-speech engines.'), Icon: Mic, keywords: tk('stt tts speech call whisper dictation') },
    { id: 'memory', label: tk('Memory'), desc: tk('Per-user long-term memory and searching past chats as a tool.'), Icon: Brain, keywords: tk('user memory history chat search remember') },
    { id: 'membank', label: tk('Memory Bank'), desc: tk('Reference files every model can read on demand.'), Icon: FileText, keywords: tk('files knowledge documents reference') },
    { id: 'skills', label: tk('Skills'), desc: tk('Reusable instruction files models load on demand for specific tasks.'), Icon: Bulb, keywords: tk('instructions markdown playbooks') },
    { id: 'mcp', label: tk('MCP'), desc: tk('Connect MCP servers for everyone on this workspace.'), Icon: Plug, keywords: tk('mcp servers tools protocol integrations connectors') },
    { id: 'privacy', label: tk('Privacy'), desc: tk('What this server has tried to connect to, and whether it was allowed.'), Icon: Shield, keywords: tk('egress outbound network local offline connections') },
    { id: 'safety', label: tk('Safety'), desc: tk('Screen user prompts with a model before they reach the assistant.'), Icon: Shield, keywords: tk('moderation filter blocked screening guardrails') }
  ] },
  { id: 'insights', label: tk('Insights'), items: [
    { id: 'analytics', label: tk('Analytics'), desc: tk('Workspace-wide token use, estimated cost, and price presets.'), Icon: Wave, keywords: tk('usage tokens cost spend pricing charts') },
    { id: 'feedback', label: tk('Feedback'), desc: tk('Thumbs up and down users left on responses, for reviewing model quality.'), Icon: Star, keywords: tk('ratings thumbs reviews quality') }
  ] },
  { id: 'governance', label: tk('Governance'), items: [
    { id: 'databases', label: tk('Databases'), desc: tk('Switch between isolated databases. Set which one loads next; changes apply on restart.'), Icon: Box, keywords: tk('database switch env storage backup profile isolate multi') },
    { id: 'limits', label: tk('Limits & Budgets'), desc: tk('Guardrails applied across the app. These take effect immediately.'), Icon: Gear, keywords: tk('uploads sandbox sessions queue budgets caps') },
    { id: 'audit', label: tk('Audit Log'), desc: tk('A record of sensitive admin actions. Pruned after 120 days.'), Icon: Clock, keywords: tk('log history actions security trail') }
  ] }
];

export const SECTIONS = NAV_GROUPS.flatMap(g => g.items.map(it => ({ ...it, group: g.label, groupId: g.id })));

export const LEGACY_SECTION_IDS = { overview: 'dashboard', branding: 'appearance', home: 'homescreen' };

export function sectionById(id) {
  return SECTIONS.find(s => s.id === id) || SECTIONS[0];
}
