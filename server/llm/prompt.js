export function buildMessages(model, history, extended, system = '') {
  let sys = String(system || '');
  if (model.has_reasoning && !model.effort_enabled) {
    const tok = extended ? model.reasoning_token : model.non_reasoning_token;
    if (tok && tok.trim()) sys = (sys ? sys + '\n' : '') + tok.trim();
  }
  const msgs = [];
  if (sys.trim()) msgs.push({ role: 'system', content: sys });
  for (const m of history) msgs.push(m.reasoning ? { role: m.role, content: m.content, reasoning: m.reasoning } : { role: m.role, content: m.content });
  return msgs;
}