import React, { useMemo, useState } from 'react';
import { copyText } from '../clipboard.js';
import hljs from 'highlight.js';
import { Copy, Check } from './icons.jsx';

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false);
  // re-highlight on each render so streaming code stays smooth
  const html = useMemo(() => {
    try {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      return hljs.highlightAuto(code).value;
    } catch { return escapeHtml(code); }
  }, [code, lang]);
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
        <button className="code-copy" onClick={copy}>
          {copied ? <Check key="c" className="copy-pop" /> : <Copy key="o" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre><code className={'hljs' + (lang ? ` language-${lang}` : '')} dangerouslySetInnerHTML={{ __html: html }} /></pre>
    </div>
  );
}
