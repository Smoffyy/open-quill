export function openFence(text) {
  let open = null;
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\t/g, '    ');
    const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!m) continue;
    const mark = m[1][0];
    const len = m[1].length;
    const rest = m[2].trim();
    if (open) { if (mark === open.mark && len >= open.len && rest === '') open = null; }
    else if (!(mark === '`' && rest.includes('`'))) open = { mark, len };
  }
  return open;
}

export function seamFor(text) {
  const body = String(text || '');
  if (!body.trim()) return '';
  let out = body.endsWith('\n') ? '' : '\n';
  const fence = openFence(body);
  if (fence) out += fence.mark.repeat(fence.len) + '\n';
  if (!/\n[ \t]*\n$/.test(body + out)) out += '\n';
  return out;
}

export function steerInstruction(notes, hadText, wasInBlock) {
  const list = notes.map(n => '- ' + n).join('\n');
  if (!hadText) return `Before you wrote anything, the user steered you with this:\n${list}\n\nWrite your reply applying that steer, and do not mention the interruption.`;
  return [
    `The user interrupted you mid-reply and steered you with this:`,
    list,
    '',
    'What you had already written is on their screen and cannot be taken back. It may have been cut off mid-word or mid-line.',
    wasInBlock
      ? 'You were inside a fenced code block when you were cut off; that block has already been closed for you, so do not write a closing fence.'
      : 'Your text has already been closed off cleanly.',
    'Carry on in a NEW markdown block, starting fresh. If you are writing code, open a new fenced block with the correct language tag. Never continue a sentence, a line of code, or a code block that was cut off.',
    'If the steer asks for a different approach or a rewrite, start that new version now; one short line naming the switch is fine. Otherwise pick up where the reply was going.',
    'Do not reproduce the earlier text, do not apologise, and do not comment on the interruption beyond that one line.'
  ].join('\n');
}
