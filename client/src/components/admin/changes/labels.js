import { tk } from '../../../i18n.jsx';

export const MODEL_FIELDS = {
  __proto__: null,
  display_name: tk('Display name'), internal_name: tk('Model id'), provider_id: tk('Connection'), description: tk('Subtitle'),
  kind: tk('Type'), enabled: tk('Listed in the picker'), is_default: tk('Default for new accounts'),
  unavailable: tk('Marked as down'), unavailable_reason: tk('Reason shown to members'), sunset_at: tk('Retire on'),
  sunset_action: tk('On that date'), cost_in: tk('Input $/M'), cost_out: tk('Output $/M'),
  system_prompt: tk('System prompt'), call_prompt: tk('Voice calls'),
  has_vision: tk('Image input'), sandbox_allowed: tk('Sandbox'), sandbox_auto: tk('Sandbox on by default'),
  web_search_allowed: tk('Web search'), web_search_auto: tk('Web search on by default'), skills_allowed: tk('Skills'),
  mcp_allowed: tk('MCP tools'), chat_search_allowed: tk('Past-chat search'), end_chat_allowed: tk('End conversation'),
  memory_allowed: tk('Memory'), calculator_allowed: tk('Calculator'), todo_allowed: tk('To-do list'),
  ask_user_allowed: tk('Ask the member'), consult_allowed: tk('Consult other models'), consult_models: tk('Models it can ask'),
  consult_images: tk('Send images'), agent_steps: tk('Tool calls per turn'), hide_tool_calls: tk('Hide tool calls'),
  reasoning_collapsible: tk('Reasoning'), hide_thinking: tk('Reasoning'), think_open: tk('Opening tag'), think_close: tk('Closing tag'),
  has_reasoning: tk('Switch modes with a prompt token'), reasoning_token: tk('Extended token'), non_reasoning_token: tk('Standard token'),
  num_ctx: tk('Window size'), summary_padding: tk('Compact when this much is left'), recent_window: tk('Turns kept verbatim'),
  enable_summaries: tk('Compact older turns'), ctx_trim_mode: tk('When the chat outgrows the window'),
  long_convo_reminder: tk('Conversation length awareness'), stop: tk('Stop sequences'),
  kwargs: tk('Request controls'), effort_enabled: tk('Request controls'),
  static_icon: tk('Static'), generating_icon: tk('While generating'), thinking_icon: tk('While thinking'),
  generating_anim: tk('Motion'), thinking_anim: tk('Motion'), icon_size: tk('Size beside replies'), icon_position: tk('Position'),
  dropdown_icon: tk('Logo in the picker'), show_name: tk('Name beside replies'), badges_off: tk('Badges'),
  bg_enabled: tk('Use a backdrop'), bg_image: tk('Image URL or CSS gradient'),
  router_rules: tk('Rules'), router_default: tk('Fallback'),
  in_more_models: tk('Folder'), more_models_label: tk('Folder')
};

export const SETTINGS = {
  __proto__: null,
  api_base_url: tk('Base URL'), api_key: tk('API key'),
  web_search_enabled: tk('Web search tool'), web_search_engine: tk('Search engine'), searxng_url: tk('Query URL'),
  web_search_count: tk('Pages per search'), web_search_domains: tk('Host allowlist'),
  upload_limit_mb_admin: tk('Attachment limit for admins'), upload_limit_mb_user: tk('Attachment limit for members'),
  sandbox_limit_mb_admin: tk('Sandbox storage for admins'), sandbox_limit_mb_user: tk('Sandbox storage for members'),
  model_queue: tk('Scheduling'), budget_user: tk('Member spend cap'), budget_admin: tk('Admin spend cap'),
  budget_warn_fraction: tk('Spend warning'), budget_enforce: tk('Enforce spend caps'),
  session_ttl_days: tk('Session length'), max_sessions: tk('Sessions per account'),
  auto_title_enabled: tk('Chat titles'), auto_title_model_mode: tk('Title model'), auto_title_model_id: tk('Title model'),
  membank_enabled: tk('Expose the file set'), membank_hide_tools: tk('Hide tool calls'),
  voice_mic_enabled: tk('Dictation'), voice_call_enabled: tk('Calls'),
  voice_stt_engine: tk('Speech to text'), voice_stt_url: tk('Speech to text'), voice_stt_key: tk('Speech to text'), voice_stt_model: tk('Speech to text'),
  voice_tts_engine: tk('Text to speech'), voice_tts_url: tk('Text to speech'), voice_tts_key: tk('Text to speech'), voice_tts_model: tk('Text to speech'),
  voice_tts_voice: tk('Voice'), voice_tts_speed: tk('Rate'),
  safety_enabled: tk('Screen prompts'), safety_model_mode: tk('Screening model'), safety_model_id: tk('Screening model'),
  safety_prompt: tk('Screening prompt'), safety_verbose: tk('Tell members why'), safety_reason_enabled: tk('Explain refusals'),
  chat_search_enabled: tk('Chat history tools'),
  allow_signups: tk('Accept new sign-ups'),
  local_only: tk('Local only'), egress_local_only: tk('Block public internet'), egress_allow_websearch: tk('Let web search through'),
  egress_allowlist: tk('Host allowlist'),
  greetings: tk('Greetings'), quick_prompts: tk('Starter prompts'),
  app_name: tk('Name'), disclaimer: tk('Footer line'), support_contact: tk('Support contact'),
  model_docs_enabled: tk('Model reference'), model_docs_config: tk('Model reference'),
  app_icon: tk('Icon'), app_font: tk('Display font'), ui_preset: tk('Base layout')
};

export const SETTING_DETAIL = {
  __proto__: null,
  voice_stt_url: 'URL', voice_stt_key: 'key', voice_stt_model: 'model',
  voice_tts_url: 'URL', voice_tts_key: 'key', voice_tts_model: 'model',
  safety_model_id: 'id', auto_title_model_id: 'id'
};

export const THEME_FIELDS = {
  __proto__: null,
  name: tk('Name'), basePreset: tk('Base layout'), doc: tk('Design'), active: tk('Active theme')
};

export const AREA_TITLES = {
  __proto__: null,
  models: tk('Models'), workspace: tk('Workspace'), interface: tk('Interface')
};