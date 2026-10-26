import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { BASE_MACROS, CODE_SPLIT, KATEX_OPTIONS, ensureKatex, guardBlock, hasMath, isolateDisplayMath, katexPlugin, katexVersion, normalizeMathDelims, subscribeKatex, wrapBarePowers, wrapMathEnvironments } from '../../lib/mathjs.js';
import CodeBlock from './CodeBlock.jsx';
import MermaidBlock from './MermaidBlock.jsx';
import { rehypeRevealWords } from '../../lib/revealwords.js';
import ToolCard from './ToolCard.jsx';
import { b64decode } from '../../lib/oqr.js';
import { transformTools } from '../../lib/toolfences.js';
import { repairTables } from '../../lib/tablefix.js';
import { foldInlineHtml, htmlBlockText } from '../../lib/rawhtml.js';
import ReasoningBlock from './ReasoningBlock.jsx';

export const ReasonSegs = React.createContext(null);

function isFenceLine(line) {
  return /^\s*(`{3,}|~{3,})/.test(line);
}

function splitBreaks(value) {
  const parts = value.split('\n');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    if (i) out.push({ type: 'break' });
    const piece = i === 0 ? parts[i].replace(/[ \t]+$/, '')
      : i === parts.length - 1 ? parts[i].replace(/^[ \t]+/, '')
        : parts[i].replace(/^[ \t]+|[ \t]+$/g, '');
    if (piece) out.push({ type: 'text', value: piece });
  }
  return out;
}

const PHRASING = new Set(['paragraph', 'heading', 'emphasis', 'strong', 'delete', 'link', 'tableCell']);

function remarkBreaks() {
  return (tree) => {
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      const phrasing = PHRASING.has(node.type);
      if (phrasing) node.children = foldInlineHtml(node.children);
      const out = [];
      for (const child of node.children) {
        if (child.type === 'html' && typeof child.value === 'string' && /^(?:\s*<br\s*\/?>\s*)+$/i.test(child.value)) {
          const count = (child.value.match(/<br\s*\/?>/gi) || []).length || 1;
          for (let i = 0; i < count; i++) out.push({ type: 'break' });
        } else if (child.type === 'html' && typeof child.value === 'string') {
          if (phrasing) { out.push(...splitBreaks(child.value)); continue; }
          const text = htmlBlockText(child.value);
          const parts = splitBreaks(text === null ? child.value : text);
          if (parts.length) out.push({ type: 'paragraph', children: parts });
        } else if (child.type === 'text' && typeof child.value === 'string' && child.value.indexOf('\n') !== -1) {
          for (const part of splitBreaks(child.value)) out.push(part);
        } else {
          walk(child);
          out.push(child);
        }
      }
      node.children = out;
    };
    walk(tree);
    return tree;
  };
}

const BLOCK_HARD_LINES = 500;

function blockify(text) {
  const lines = text.split('\n');
  const blocks = [];
  let start = 0;
  let count = 0;
  let inFence = false;
  let hasContent = false;
  let inMath = false;
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const end = pos + line.length;
    const next = end + 1;
    count++;
    if (isFenceLine(line)) {
      if (line.trim() !== '') hasContent = true;
      if (inFence) {
        inFence = false;
        blocks.push(text.slice(start, end));
        start = next; count = 0; hasContent = false;
      } else inFence = true;
      pos = next;
      continue;
    }
    // A display block is as unsplittable as a fence: cutting it on a blank line
    // hands remark-math two halves with an unbalanced $$ and both render as
    // literal text with stray dollars.
    if (!inFence) {
      const dollars = (line.match(/\$\$/g) || []).length;
      if (dollars % 2) inMath = !inMath;
    }
    if (!inFence && !inMath && line.trim() === '' && hasContent) {
      blocks.push(text.slice(start, end));
      start = next; count = 0; hasContent = false;
    } else if (!inFence && !inMath && count >= BLOCK_HARD_LINES) {
      blocks.push(text.slice(start, end));
      start = next; count = 0; hasContent = false;
    } else if (line.trim() !== '') hasContent = true;
    pos = next;
  }
  if (count) blocks.push(text.slice(start));
  return blocks;
}

function ReasonSeg({ index }) {
  const ctx = React.useContext(ReasonSegs);
  const segs = ctx && ctx.segs;
  const text = segs && segs[index];
  if (text == null) return null;
  const live = !!(ctx.live && index === segs.length - 1);
  return <ReasoningBlock text={text} live={live} durationMs={(ctx.segMs && ctx.segMs[index]) || 0} collapsible={ctx.collapsible !== false} />;
}

const mdComponents = {
  pre({ children }) {
    const el = Array.isArray(children) ? children[0] : children;
    const props = el?.props || {};
    const m = /language-(\w+)/.exec(props.className || '');
    const raw = String(props.children || '').replace(/\n$/, '');
    const lang = m ? m[1].toLowerCase() : '';
    if (lang === 'reasonseg') return <ReasonSeg index={Number(raw.trim())} />;
    if (lang === 'toolcall') {
      const data = (() => { try { return JSON.parse(b64decode(raw)); } catch { return null; } })();
      if (data && data.call) return <ToolCard call={data.call} result={data.result} />;
      return null;
    }
    if (lang === 'mermaid') return <MermaidBlock code={raw} />;
    return <CodeBlock lang={m ? m[1] : ''} code={raw} />;
  },
  code({ className, children }) {
    return <code className={className}>{children}</code>;
  },
  a({ node, title, ...props }) {
    return <a {...props} data-tip={title || undefined} />;
  },
  img({ node, title, ...props }) {
    return <img {...props} data-tip={title || undefined} />;
  }
};

const MarkdownBlock = React.memo(function MarkdownBlock({ text, reveal }) {
  const prepared = React.useMemo(() => guardBlock(text), [text]);
  const needsMath = React.useMemo(() => hasMath(prepared), [prepared]);
  const mathReady = React.useSyncExternalStore(subscribeKatex, katexVersion, katexVersion);
  React.useEffect(() => { if (needsMath && !katexPlugin()) ensureKatex(); }, [needsMath, mathReady]);
  const rehypePlugins = React.useMemo(() => {
    const plugin = needsMath ? katexPlugin() : null;
    const list = plugin ? [[plugin, { ...KATEX_OPTIONS, macros: { ...BASE_MACROS } }]] : [];
    // Last, so every other plugin still sees whole text nodes.
    if (reveal) list.push(rehypeRevealWords);
    return list;
  }, [needsMath, mathReady, reveal]);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
      rehypePlugins={rehypePlugins}
      components={mdComponents}
    >{prepared}</ReactMarkdown>
  );
});

function neutralizeOpenMath(text) {
  let i = 0;
  let open = -1;
  let openLen = 0;
  let inFence = false;
  let inCode = false;
  while (i < text.length) {
    const ch = text[i];
    if (inFence) {
      if (ch === '`' && text.startsWith('```', i)) { inFence = false; i += 3; continue; }
      i++;
      continue;
    }
    if (inCode) {
      if (ch === '`' || ch === '\n') inCode = false;
      i++;
      continue;
    }
    if (ch === '`') {
      if (text.startsWith('```', i)) { inFence = true; i += 3; } else { inCode = true; i++; }
      continue;
    }
    if (ch === '\\') { i += 2; continue; }
    if (ch === '$') {
      const len = text[i + 1] === '$' ? 2 : 1;
      if (open === -1) {
        open = i;
        openLen = len;
        i += len;
        continue;
      }
      if (openLen === len) {
        open = -1;
        i += len;
        continue;
      }
      if (openLen === 2 && len === 1) { i += 1; continue; }
      open = -1;
      i += 1;
      continue;
    }
    i++;
  }
  if (open === -1) return text;
  let out = text.slice(0, open) + '\\$';
  if (openLen === 2) out += '\\$';
  return out + text.slice(open + openLen);
}

const BARE_MATH_ARG = /\\(?:ce|pu|sqrt|frac|tfrac|dfrac|cfrac|binom|tbinom|dbinom|mathbb|mathbf|mathcal|mathfrak|mathrm|mathsf|mathit|text|operatorname|overline|underline|hat|bar|vec|dot|ddot|tilde|widehat|widetilde|overbrace|underbrace|overset|underset|stackrel|bcancel|cancel|xcancel|boxed|colorbox|color)\s*[{([\d]/;
const BARE_MATH_SYM = /\\(?:sum|prod|int|iint|iiint|oint|lim|inf|sup|max|min|log|ln|exp|sin|cos|tan|sec|csc|cot|arcsin|arccos|arctan|sinh|cosh|tanh|alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega|partial|nabla|infty|forall|exists|nexists|emptyset|varnothing|in|notin|subset|supset|subseteq|supseteq|cup|cap|setminus|cdot|cdots|ldots|ddots|vdots|times|div|pm|mp|leq|geq|neq|approx|equiv|sim|simeq|cong|propto|perp|parallel|angle|triangle|square|circ|bullet|star|dagger|ddagger|ell|hbar|Re|Im|wp|aleph|beth|left|right|big|Big|bigg|Bigg)(?=[^a-zA-Z]|$)/;
const BARE_MATH_CMD = new RegExp(BARE_MATH_ARG.source + '|' + BARE_MATH_SYM.source);

function scanMathExpr(seg, start) {
  let j = start;
  let depth = 0;
  while (j < seg.length) {
    const ch = seg[j];
    if (ch === '\\') {
      const rest = seg.slice(j);
      const cmd = rest.match(/^\\[a-zA-Z]+/);
      if (cmd) { j += cmd[0].length; continue; }
      j += 2;
      continue;
    }
    if (ch === '{') { depth++; j++; continue; }
    if (ch === '}') {
      depth--;
      j++;
      if (depth <= 0) {
        if (j < seg.length && seg[j] === '{') continue;
        if (j < seg.length && seg[j] === '\\') {
          const rest = seg.slice(j);
          if (BARE_MATH_CMD.test(rest)) continue;
        }
        break;
      }
      continue;
    }
    if (depth > 0) { j++; continue; }
    if (/[\d.+\-=,;:!<>^_|/() ]/.test(ch)) { j++; continue; }
    break;
  }
  return j;
}

function wrapBareMathCommands(text) {
  if (typeof text !== 'string' || text.indexOf('\\') === -1) return text;
  const parts = text.split(CODE_SPLIT);
  for (let p = 0; p < parts.length; p++) {
    const seg = parts[p];
    if (!seg || seg.startsWith('`') || seg.startsWith('~~~')) continue;
    let result = '';
    let i = 0;
    let inMath = false;
    let mathChar = '';
    while (i < seg.length) {
      if (seg[i] === '$') {
        if (seg[i + 1] === '$') {
          inMath = !inMath;
          mathChar = '$$';
          result += '$$';
          i += 2;
        } else {
          if (inMath && mathChar === '$') inMath = false;
          else if (!inMath) { inMath = true; mathChar = '$'; }
          result += '$';
          i++;
        }
        continue;
      }
      if (inMath) { result += seg[i]; i++; continue; }
      if (seg[i] === '\\' && !inMath) {
        const rest = seg.slice(i);
        if (BARE_MATH_CMD.test(rest)) {
          let prefixStart = i;
          while (prefixStart > 0 && /[\d.+-]/.test(seg[prefixStart - 1]) && seg[prefixStart - 1] !== '\n') prefixStart--;
          const prefix = seg.slice(prefixStart, i);
          let j = scanMathExpr(seg, i);
          while (j < seg.length) {
            const tail = seg.slice(j);
            if (/^[,;]\s*[+-]?\d*\\/.test(tail) && BARE_MATH_CMD.test(tail.replace(/^[,;]\s*[+-]?\d*/, ''))) {
              const skip = tail.match(/^[,;]\s*[+-]?\d*/)[0].length;
              j += skip;
              j = scanMathExpr(seg, j);
            } else break;
          }
          const expr = prefix + seg.slice(i, j);
          if (prefixStart < i) {
            result = result.slice(0, result.length - prefix.length);
          }
          result += '$' + expr + '$';
          i = j;
          continue;
        }
      }
      result += seg[i];
      i++;
    }
    parts[p] = result;
  }
  return parts.join('');
}

const PROGRESSIVE_SIZE_TRIGGER = 20000;
const PROGRESSIVE_BLOCK_TRIGGER = 40;
const PROGRESSIVE_INITIAL_LINES = 300;
const PROGRESSIVE_STEP_LINES = 1200;

function lineCount(str) {
  let n = 1;
  for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) === 10) n++;
  return n;
}

function ProgressiveBlocks({ blocks }) {
  const sizes = React.useMemo(() => blocks.map(lineCount), [blocks]);
  const advance = React.useCallback((from, budget) => {
    let lines = 0, i = from;
    while (i < blocks.length) { lines += sizes[i]; i++; if (lines >= budget) break; }
    return Math.min(blocks.length, Math.max(i, from + 1));
  }, [blocks, sizes]);
  const [count, setCount] = React.useState(() => advance(0, PROGRESSIVE_INITIAL_LINES));
  React.useEffect(() => { setCount(advance(0, PROGRESSIVE_INITIAL_LINES)); }, [advance]);
  React.useEffect(() => {
    if (count >= blocks.length) return;
    const idle = window.requestIdleCallback ? window.requestIdleCallback.bind(window) : ((cb) => setTimeout(() => cb(), 16));
    const cancel = window.cancelIdleCallback ? window.cancelIdleCallback.bind(window) : clearTimeout;
    const handle = idle(() => setCount(c => advance(c, PROGRESSIVE_STEP_LINES)));
    return () => cancel(handle);
  }, [count, blocks.length, advance]);
  const shown = count >= blocks.length ? blocks : blocks.slice(0, count);
  return shown.map((b, i) => <MarkdownBlock key={i} text={b} />);
}

function Markdown({ children, streaming, reveal }) {
  if (typeof children !== 'string') {
    return <MarkdownBlock text={children} />;
  }
  let text = isolateDisplayMath(wrapMathEnvironments(wrapBareMathCommands(normalizeMathDelims(wrapBarePowers(repairTables(transformTools(children)))))));
  if (streaming) text = neutralizeOpenMath(text);
  const blocks = blockify(text);
  if (!streaming && (text.length > PROGRESSIVE_SIZE_TRIGGER || blocks.length > PROGRESSIVE_BLOCK_TRIGGER)) {
    return <ProgressiveBlocks blocks={blocks} />;
  }
  return blocks.map((b, i) => <MarkdownBlock key={i} text={b} reveal={reveal} />);
}

export default React.memo(Markdown);