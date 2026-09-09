// One fade per word, started when the word first appears.
//
// The reveal loop hands Markdown a longer string every tick, so the only way to
// give newly written text its own opacity ramp is to make each word its own
// element. Words keep their position in the parent's child list as text is
// appended, which is what lets React reuse their DOM: a fade already running is
// never restarted, and only the words that just arrived begin one. The tail of a
// reply is a soft gradient a few words long rather than a hard edge.
//
// Runs as a rehype plugin rather than a DOM pass so the spans are part of the
// React tree and reconcile with everything else in the block. Whitespace stays
// as plain text: it has nothing to fade, and leaving it alone keeps the number
// of elements down and line breaking exactly where it was.

// `pre` and `code` are read back as raw strings by the `pre` component (a tool
// call or a reasoning segment is encoded in one), so splitting them would break
// the parse, not just the look. KaTeX owns its own subtree for the same reason.
const OPAQUE = /(?:^|\s)(?:katex|math)(?:\s|$|-)/;

function opaque(node) {
  if (node.tagName === 'pre' || node.tagName === 'code') return true;
  const cn = node.properties && node.properties.className;
  if (!cn) return false;
  return OPAQUE.test(Array.isArray(cn) ? cn.join(' ') : String(cn));
}

function split(node) {
  const kids = node.children;
  if (!kids || !kids.length) return;
  const out = [];
  for (const kid of kids) {
    if (kid.type !== 'text') {
      if (kid.type === 'element' && !opaque(kid)) split(kid);
      out.push(kid);
      continue;
    }
    for (const part of kid.value.split(/(\s+)/)) {
      if (!part) continue;
      if (!part.trim()) out.push({ type: 'text', value: part });
      else out.push({ type: 'element', tagName: 'span', properties: { className: ['rv-word'] }, children: [{ type: 'text', value: part }] });
    }
  }
  node.children = out;
}

export function rehypeRevealWords() {
  return (tree) => split(tree);
}
