import { applyPromptVars } from './provider.js';

export function buildMessages(model, history, extended, sandboxPrompt, summaryText, vars = {}, instructions = '') {
  let sys = applyPromptVars(model.system_prompt || '', vars);
  if (instructions && instructions.trim()) sys = (sys ? sys + '\n\n' : '') + "The user has provided the following instructions to keep in mind across all conversations. Follow them unless they conflict with safety or a direct request in the conversation:\n" + instructions.trim();
  if (summaryText && summaryText.trim()) sys = (sys ? sys + '\n\n' : '') + 'Summary of the earlier part of this conversation (older messages were compacted to save context, treat this as established context):\n' + summaryText.trim();
  if (sandboxPrompt) sys = (sys ? sys + '\n\n' : '') + sandboxPrompt;
  if (model.has_reasoning && !model.effort_enabled) {
    const tok = extended ? model.reasoning_token : model.non_reasoning_token;
    if (tok && tok.trim()) sys = (sys ? sys + '\n' : '') + tok.trim();
  }
  const msgs = [];
  if (sys.trim()) msgs.push({ role: 'system', content: sys });
  for (const m of history) msgs.push({ role: m.role, content: m.content });
  return msgs;
}

