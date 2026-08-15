import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { copyText } from '../clipboard.js';
import { cancelHighlight, highlight, hljsVersion, scheduleHighlight, subscribeHljs } from '../lib/hljs.js';
import { escHtml } from '../lib/artifacts.js';
import { Copy, Check } from './icons.jsx';
import { t } from '../i18n.jsx';

const NEAR_VIEWPORT = '900px';

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false);
  const hlVersion = useSyncExternalStore(subscribeHljs, hljsVersion, hljsVersion);
  const [html, setHtml] = useState(() => escHtml(code));
  const preRef = useRef(null);

  useEffect(() => {
    setHtml(escHtml(code));
    const el = preRef.current;
    if (!el) return;
    let done = false;
    let alive = true;
    const job = () => { if (alive) setHtml(highlight(code, lang)); };
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
  }, [code, lang, hlVersion]);

  async function copy() {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }
  return (
    <div className="code-wrap">
      <div className={'code-bar' + (copied ? ' flash' : '')}>
        <span>{lang || 'text'}</span>
        <button className="code-copy" onPointerDown={(e) => { e.preventDefault(); copy(); }}>
          {copied ? <Check key="c" className="copy-pop" /> : <Copy key="o" />} {copied ? t('Copied') : t('Copy')}
        </button>
      </div>
      <pre ref={preRef}><code className={'hljs' + (lang ? ` language-${lang}` : '')} dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}

export default React.memo(CodeBlock);
