const INLINE = {
  __proto__: null,
  b: 'strong', strong: 'strong', i: 'em', em: 'em', u: 'u', s: 's', strike: 's', del: 'del', ins: 'ins',
  sup: 'sup', sub: 'sub', mark: 'mark', kbd: 'kbd', code: 'code', small: 'small', span: 'span',
  abbr: 'abbr', q: 'q', cite: 'cite', var: 'var', samp: 'samp'
};
const OPEN = /^<([a-z][a-z0-9]*)(?:\s[^>]*)?>$/i;
const CLOSE = /^<\/([a-z][a-z0-9]*)\s*>$/i;
const BLOCK_TAGS = /^(?:address|article|aside|blockquote|center|details|dialog|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul)$/i;
const ENTITIES = { __proto__: null, nbsp: ' ', lt: '<', gt: '>', amp: '&', quot: '"', '#39': "'" };

function tagOf(node, re) {
  const m = node.type === 'html' && typeof node.value === 'string' ? re.exec(node.value.trim()) : null;
  return m ? m[1].toLowerCase() : '';
}

function pushBreak(out) {
  const last = out[out.length - 1];
  if (!last || last.type === 'break' || (last.type === 'text' && /\n\s*$/.test(last.value))) return;
  out.push({ type: 'break' });
}

export function foldInlineHtml(children) {
  const out = [];
  for (let i = 0; i < children.length; i++) {
    const open = tagOf(children[i], OPEN);
    const block = BLOCK_TAGS.test(open);
    let end = -1;
    if (INLINE[open] || block) {
      for (let j = i + 1; j < children.length; j++) {
        if (tagOf(children[j], CLOSE) === open) { end = j; break; }
      }
    }
    if (end === -1) {
      out.push(children[i]);
      continue;
    }
    const inner = foldInlineHtml(children.slice(i + 1, end));
    if (block) {
      pushBreak(out);
      out.push(...inner);
      if (end + 1 < children.length) pushBreak(out);
    } else {
      out.push({ type: 'emphasis', data: { hName: INLINE[open] }, children: inner });
    }
    i = end;
  }
  return out;
}

export function htmlBlockText(value) {
  const text = String(value || '').replace(/<!--[\s\S]*?-->/g, '');
  if (!text.trim()) return '';
  const open = /^\s*<([a-z][a-z0-9]*)\b/i.exec(text);
  if (!open || !new RegExp('</' + open[1] + '\\s*>', 'i').test(text)) return null;
  return text
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (m, tag) => (BLOCK_TAGS.test(tag) ? '\n' : ''))
    .replace(/&(nbsp|lt|gt|amp|quot|#39);/g, (m, name) => ENTITIES[name])
    .replace(/[ \t]*\n[\s]*/g, '\n')
    .trim();
}