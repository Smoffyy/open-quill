import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { copyText } from '../clipboard.js';
import { highlight, hljsVersion, subscribeHljs } from '../lib/hljs.js';
import { Copy, Check } from './icons.jsx';

export default function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false);
  const hlVersion = useSyncExternalStore(subscribeHljs, hljsVersion);
  const html = useMemo(() => highlight(code, lang), [code, lang, hlVersion]);
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
          {copied ? <Check key="c" className="copy-pop" /> : <Copy key="o" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre><code className={'hljs' + (lang ? ` language-${lang}` : '')} dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}
