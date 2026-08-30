import { Panel, Cube, Sliders, Users, Sparkles, Chat, Globe, Mic, Brain, FileText, Bulb, Plug, Shield, Eye, Wave, Star, Box, Gear, Clock } from '../icons.jsx';
import { tk } from '../../i18n.jsx';

/* Each section declares everything the shell needs to render it:
   - title/blurb  the page header
   - find/index   what the Ctrl-K finder matches on
   - saves        which store backs it, so the header can show that store's
                  save state instead of the shell keeping its own list */

export const NAV = [
  { group: tk('Runtime'), items: [
    { id: 'overview', label: tk('Overview'), Icon: Panel, title: tk('Overview'),
      blurb: tk('Catalog size, member count, spend, and the last few admin actions.'),
      find: tk('dashboard home status summary snapshot'),
      index: [tk('Draft'), tk('Recent admin events'), tk('Publish')] },
    { id: 'models', label: tk('Models'), Icon: Cube, title: tk('Models'),
      blurb: tk('The catalog users choose from. Each entry binds a provider model id to a prompt, a set of abilities, and a price.'),
      find: tk('llm catalog prompt system parameters sampling'),
      index: [tk('System prompt'), tk('Request controls'), tk('kwargs'), tk('Reasoning'), tk('Context window'), tk('Sampling'), tk('Stop sequences'), tk('Price'), tk('Capabilities'), tk('Logo'), tk('Badges'), tk('Reference page'), tk('Routing'), tk('Voice calls'), tk('Availability')] },
    { id: 'providers', label: tk('Providers'), Icon: Sliders, title: tk('Providers'),
      blurb: tk('Backends models are routed through. One base URL per connection.'),
      find: tk('backend endpoint api key connection openai llamacpp lmstudio ollama'),
      index: [tk('Base URL'), tk('API key'), tk('Discover'), tk('Test')] }
  ] },
  { group: tk('Tools'), items: [
    { id: 'search', label: tk('Web search'), Icon: Globe, title: tk('Web search'), saves: 'workspace',
      blurb: tk('Exposes a search tool backed by a SearXNG instance you run.'),
      find: tk('searxng internet browse query engine'),
      index: [tk('Web search tool'), tk('Query URL'), tk('Host allowlist'), tk('Pages per search'), tk('Tool instructions')] },
    { id: 'voice', label: tk('Voice'), Icon: Mic, title: tk('Voice'), saves: 'workspace',
      blurb: tk('Dictation and hands-free calls, with pluggable speech-to-text and text-to-speech endpoints.'),
      find: tk('stt tts whisper speech microphone call kokoro piper'),
      index: [tk('Dictation'), tk('Calls'), tk('Speech to text'), tk('Text to speech'), tk('Rate')] },
    { id: 'memory', label: tk('Memory'), Icon: Brain, title: tk('Memory'), saves: 'workspace',
      blurb: tk('Per-user long-term memory, and tools for searching a user’s own past chats.'),
      find: tk('remember history recall chat search'),
      index: [tk('Long-term memory'), tk('Chat history tools'), tk('Search past chats')] },
    { id: 'files', label: tk('Reference files'), Icon: FileText, title: tk('Reference files'), saves: 'workspace',
      blurb: tk('A shared file set every model can list, read, and search on demand.'),
      find: tk('memory bank documents knowledge upload pdf markdown'),
      index: [tk('Expose the file set'), tk('Preamble'), tk('Files')] },
    { id: 'skills', label: tk('Skills'), Icon: Bulb, title: tk('Skills'),
      blurb: tk('Instruction files a model loads by name when a task matches the description.'),
      find: tk('playbook markdown instructions procedure'),
      index: [tk('New skill'), tk('Instructions'), tk('Loads when')] },
    { id: 'mcp', label: tk('MCP servers'), Icon: Plug, title: tk('MCP servers'),
      blurb: tk('Model Context Protocol endpoints shared with everyone on this workspace.'),
      find: tk('tools protocol connector integration server'),
      index: [tk('Add server'), tk('Transport'), tk('Command'), tk('Headers')] }
  ] },
  { group: tk('Workspace'), items: [
    { id: 'branding', label: tk('Branding'), Icon: Sparkles, title: tk('Branding'), saves: 'workspace',
      blurb: tk('Name, icon, interface preset, and typography sent to every connected client.'),
      find: tk('appearance logo font theme identity disclaimer preset'),
      index: [tk('Icon'), tk('Interface preset'), tk('Display font'), tk('Footer line'), tk('Model reference button')] },
    { id: 'launcher', label: tk('New chat screen'), Icon: Chat, title: tk('New chat screen'), saves: 'workspace',
      blurb: tk('Greetings and one-tap prompts shown before the first message.'),
      find: tk('home greeting welcome quick prompts starters'),
      index: [tk('Greetings'), tk('Starter prompts')] },
    { id: 'members', label: tk('Members'), Icon: Users, title: tk('Members'), saves: 'workspace',
      blurb: tk('Accounts, roles, per-member spend caps, and registration.'),
      find: tk('users people admins roles accounts signup budget'),
      index: [tk('Accept new sign-ups'), tk('Role'), tk('Remove member')] }
  ] },
  { group: tk('Policy'), items: [
    { id: 'guardrails', label: tk('Guardrails'), Icon: Shield, title: tk('Guardrails'), saves: 'workspace',
      blurb: tk('Screen prompts with a model before they reach the assistant.'),
      find: tk('safety moderation filter block screening'),
      index: [tk('Screen prompts'), tk('Screening model'), tk('Screening prompt'), tk('Refusal log')] },
    { id: 'network', label: tk('Network'), Icon: Eye, title: tk('Network'), saves: 'workspace',
      blurb: tk('Outbound connection policy, and a log of what this server has tried to reach.'),
      find: tk('egress privacy offline local only allowlist firewall'),
      index: [tk('Block public internet'), tk('Host allowlist'), tk('Connection log')] },
    { id: 'quotas', label: tk('Quotas'), Icon: Gear, title: tk('Quotas'), saves: 'workspace',
      blurb: tk('Upload ceilings, sandbox storage, request queueing, and spend caps.'),
      find: tk('limits budgets caps uploads sandbox queue sessions'),
      index: [tk('Attachments'), tk('Sandbox storage'), tk('Scheduling'), tk('Spend caps'), tk('Sessions')] }
  ] },
  { group: tk('Records'), items: [
    { id: 'usage', label: tk('Usage'), Icon: Wave, title: tk('Usage'),
      blurb: tk('Token counts and estimated spend by member and by model.'),
      find: tk('analytics tokens cost spend pricing report'),
      index: [tk('Tool reliability'), tk('Price table'), tk('By member'), tk('By model')] },
    { id: 'ratings', label: tk('Ratings'), Icon: Star, title: tk('Ratings'),
      blurb: tk('Thumbs users left on replies, newest first.'),
      find: tk('feedback thumbs quality reviews votes'),
      index: [tk('Ratings')] },
    { id: 'events', label: tk('Event log'), Icon: Clock, title: tk('Event log'),
      blurb: tk('Sensitive admin actions, retained for 120 days.'),
      find: tk('audit history trail security actions'),
      index: [tk('Export CSV'), tk('Actor'), tk('Action')] },
    { id: 'storage', label: tk('Storage'), Icon: Box, title: tk('Storage'),
      blurb: tk('Isolated databases. Selecting one sets what loads on the next restart.'),
      find: tk('database switch env backup profile isolate multi tenant'),
      index: [tk('Databases'), tk('Create'), tk('Use next start')] }
  ] }
];

export const SECTIONS = NAV.flatMap(g => g.items.map(it => ({ ...it, group: g.group })));

export const DEFAULT_SECTION = 'overview';

// Ids the panel used to ship with. Kept so bookmarks and the stored tab survive.
const ALIASES = {
  __proto__: null,
  dashboard: 'overview', overview: 'overview',
  appearance: 'branding', branding: 'branding',
  homescreen: 'launcher', home: 'launcher',
  websearch: 'search',
  membank: 'files',
  privacy: 'network',
  safety: 'guardrails',
  limits: 'quotas',
  analytics: 'usage',
  feedback: 'ratings',
  audit: 'events',
  databases: 'storage'
};

export function resolveSection(id) {
  const mapped = ALIASES[id] || id;
  return SECTIONS.some(s => s.id === mapped) ? mapped : DEFAULT_SECTION;
}

export function sectionMeta(id) {
  return SECTIONS.find(s => s.id === id) || SECTIONS[0];
}
