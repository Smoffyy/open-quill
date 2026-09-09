import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { copyText } from '../clipboard.js';
import { cancelHighlight, highlight, hljsVersion, scheduleHighlight, subscribeHljs } from '../lib/hljs.js';
import { escHtml } from '../lib/artifacts.js';
import { Copy, Check } from './icons.jsx';
import { t } from '../i18n.jsx';

const NEAR_VIEWPORT = '900px';

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false);
  const hlVersion = useSyncExternalStore(subscribeHljs, hljsVersion, hljsVersion);
  // Whether this block has been asked to highlight yet. A thread can hold
  // hundreds of them and only the ones near the viewport are worth the work, so
  // the first pass is still gated; after that the gate stays open.
  const [near, setNear] = useState(false);
  const preRef = useRef(null);

  // Highlighted while rendering rather than afterwards. Held in state, the block
  // was a flush behind its own text and grew in a later commit than the one that
  // added the line, which moved everything under it. Computed in an effect
  // instead, the line painted plain and was coloured on the next commit, so the
  // highlighting flashed once per flush. Doing it here is one render, one paint,
  // with the right height and the right colours in the same frame.
  //
  // The module's cache is skipped on purpose: a block that is still being
  // written would otherwise leave one entry per flush behind it and evict every
  // other block in the thread. This memo is the cache that matters, and it lasts
  // as long as the block is mounted.
  const html = useMemo(
    () => (near ? highlight(code, lang, { cache: false }) : escHtml(code)),
    [near, code, lang, hlVersion]
  );

  useEffect(() => {
    if (near) return;
    const el = preRef.current;
    if (!el) return;
    let done = false;
    let alive = true;
    const job = () => { if (alive) setNear(true); };
    const paint = () => {
      if (done) return;
      done = true;
      scheduleHighlight(job);
    };
    if (typeof IntersectionObserver === 'undefined') { paint(); return () => { alive = false; cancelHighlight(job); }; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); paint(); } }, { rootMargin: NEAR_VIEWPORT });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
      cancelHighlight(job);
    };
  }, [near]);

  async function copy() {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }
  return (
    <div className="code-wrap">
      <div className="code-copy-anchor">
        <button className="code-copy" title={copied ? t('Copied') : t('Copy')} aria-label={copied ? t('Copied') : t('Copy')}
          onPointerDown={(e) => { e.preventDefault(); copy(); }}>
          {copied ? <Check key="c" className="copy-pop" /> : <Copy key="o" />}
          <span className="code-copy-label">{copied ? t('Copied') : t('Copy')}</span>
        </button>
      </div>
      <div className={'code-bar' + (copied ? ' flash' : '')}>{lang || 'text'}</div>
      <pre ref={preRef}><code className={'hljs' + (lang ? ` language-${lang}` : '')} dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}

export default React.memo(CodeBlock);
