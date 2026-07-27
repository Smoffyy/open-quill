import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Up, Down } from './icons.jsx';
import { t } from '../i18n.jsx';

const SKIP = 'trail,thread-find,actions,code-bar,msg-time,ctx-row,steer-chips,retry-menu,more-menu,msg-model-badge,pin-tag,model-status';
const SKIP_SET = new Set(SKIP.split(','));
const HL_ALL = 'oq-find';
const HL_ONE = 'oq-find-active';

const supportsHighlight = () => typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined';

function skipped(node) {
  let el = node.parentElement;
  while (el) {
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return true;
    const cl = el.classList;
    if (cl && cl.length) for (const c of cl) if (SKIP_SET.has(c)) return true;
    if (el.classList && el.classList.contains('thread')) return false;
    el = el.parentElement;
  }
  return false;
}

function flatten(root) {
  const nodes = [];
  const starts = [];
  let text = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      return skipped(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  let n = walker.nextNode();
  while (n) {
    starts.push(text.length);
    nodes.push(n);
    text += n.nodeValue;
    n = walker.nextNode();
  }
  return { nodes, starts, text };
}

function locate(starts, nodes, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return { node: nodes[lo], offset: offset - starts[lo] };
}

function midOf(node) {
  let el = node.nodeType === 1 ? node : node.parentElement;
  while (el) {
    const mid = el.getAttribute && el.getAttribute('data-mid');
    if (mid) return mid;
    el = el.parentElement;
  }
  return null;
}

function computeRanges(root, query) {
  const out = [];
  if (!root || !query) return out;
  const { nodes, starts, text } = flatten(root);
  if (!text) return out;
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  let at = hay.indexOf(needle);
  while (at !== -1) {
    const a = locate(starts, nodes, at);
    const b = locate(starts, nodes, at + needle.length - 1);
    try {
      const r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset + 1);
      out.push(r);
    } catch {}
    at = hay.indexOf(needle, at + needle.length);
  }
  return out;
}

export default function ThreadFind({ scrollRef, revision, onMatches, onClose }) {
  const [q, setQ] = useState('');
  const [total, setTotal] = useState(0);
  const [at, setAt] = useState(0);
  const inputRef = useRef(null);
  const barRef = useRef(null);
  const rangesRef = useRef([]);
  const rafRef = useRef(0);
  const term = q.trim();

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const clearHighlights = useCallback(() => {
    if (!supportsHighlight()) return;
    CSS.highlights.delete(HL_ALL);
    CSS.highlights.delete(HL_ONE);
  }, []);

  const paint = useCallback((ranges, index) => {
    if (!supportsHighlight()) return;
    if (!ranges.length) { clearHighlights(); return; }
    const rest = ranges.filter((_, i) => i !== index);
    CSS.highlights.set(HL_ALL, new Highlight(...rest));
    const one = ranges[index];
    if (one) CSS.highlights.set(HL_ONE, new Highlight(one));
    else CSS.highlights.delete(HL_ONE);
  }, [clearHighlights]);

  const run = useCallback(() => {
    const root = scrollRef.current?.querySelector('.thread');
    if (!term || term.length < 2 || !root) {
      rangesRef.current = [];
      setTotal(0);
      setAt(0);
      clearHighlights();
      onMatches(null);
      return;
    }
    const ranges = computeRanges(root, term);
    rangesRef.current = ranges;
    setTotal(ranges.length);
    setAt(i => (ranges.length ? Math.min(i, ranges.length - 1) : 0));
    const ids = new Set();
    for (const r of ranges) { const m = midOf(r.startContainer); if (m) ids.add(m); }
    onMatches(ids.size ? ids : null);
  }, [term, scrollRef, clearHighlights, onMatches]);

  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(run);
    return () => cancelAnimationFrame(rafRef.current);
  }, [run, revision]);

  useEffect(() => { paint(rangesRef.current, at); }, [paint, at, total]);

  useEffect(() => () => { clearHighlights(); onMatches(null); }, [clearHighlights, onMatches]);

  const reveal = useCallback((index) => {
    const r = rangesRef.current[index];
    const scroller = scrollRef.current;
    if (!r || !scroller) return;
    const mid = midOf(r.startContainer);
    const host = mid ? scroller.querySelector('[data-mid="' + (window.CSS && CSS.escape ? CSS.escape(mid) : mid) + '"]') : null;
    if (host) host.scrollIntoView({ block: 'center', behavior: 'auto' });
    requestAnimationFrame(() => {
      try {
        const rect = r.getBoundingClientRect();
        if (!rect || (!rect.height && !rect.width)) return;
        const box = scroller.getBoundingClientRect();
        const delta = rect.top - (box.top + box.height / 2);
        if (Math.abs(delta) > 24) scroller.scrollTop += delta;
      } catch {}
    });
  }, [scrollRef]);

  const step = useCallback((dir) => {
    const n = rangesRef.current.length;
    if (!n) return;
    setAt(prev => {
      const next = (prev + dir + n) % n;
      reveal(next);
      return next;
    });
  }, [reveal]);

  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
  };

  const status = useMemo(() => {
    if (!term || term.length < 2) return '';
    if (!total) return t('No matches');
    return t('{n} of {total}', { n: at + 1, total });
  }, [term, total, at]);

  return (
    <div className="thread-find" ref={barRef} role="search" aria-label={t('Find in conversation')}>
      <Search style={{ width: 15 }} />
      <input
        ref={inputRef}
        className="tf-input"
        type="text"
        value={q}
        placeholder={t('Find in conversation')}
        aria-label={t('Find in conversation')}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
      />
      <span className="tf-count" aria-live="polite">{status}</span>
      <button type="button" className="tf-btn" onClick={() => step(-1)} disabled={!total} aria-label={t('Previous match')} title={t('Previous match')}><Up style={{ width: 14 }} /></button>
      <button type="button" className="tf-btn" onClick={() => step(1)} disabled={!total} aria-label={t('Next match')} title={t('Next match')}><Down style={{ width: 14 }} /></button>
      <button type="button" className="tf-btn tf-close" onClick={onClose} aria-label={t('Close find')} title={t('Close find')}><X style={{ width: 14 }} /></button>
    </div>
  );
}
