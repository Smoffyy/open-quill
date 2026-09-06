import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import { copyText } from '../clipboard.js';
import { useFocusTrap } from '../lib/focus.js';
import { t } from '../i18n.jsx';

const COLORS = ['var(--text)', '#6c8ebf', '#b48ead', '#a3be8c', '#d08770', '#8fa1b3'];

function Section({ label, role, tokens, text, open, onToggle, color }) {
  return (
    <div className="pl-seg">
      <div className="pl-head" onClick={onToggle}>
        {color && <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />}
        <span className="pl-role">{role}</span>
        <span className="pl-name">{label}</span>
        <span className="pl-tok">{tokens.toLocaleString()} {t('tok')}</span>
      </div>
      {open && <div className="pl-body">{text || t('(empty)')}</div>}
    </div>
  );
}

export default function PromptLedger({ chatId, modelId, onClose }) {
  const boxRef = useRef(null);
  useFocusTrap(boxRef, onClose);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    api.get(`/api/chats/${chatId}/prompt${modelId ? '?modelId=' + encodeURIComponent(modelId) : ''}`)
      .then(d => { if (live) setData(d); })
      .catch(e => { if (live) setErr(String(e.message || e)); });
    return () => { live = false; };
  }, [chatId, modelId]);

  const bar = useMemo(() => {
    if (!data) return [];
    const parts = [
      ...data.sections.map((s, i) => ({ label: s.name, tokens: s.tokens, color: COLORS[i % COLORS.length] })),
      { label: t('Messages'), tokens: data.messages.reduce((n, m) => n + m.tokens, 0), color: 'var(--text-faint)' },
    ].filter(p => p.tokens > 0);
    const total = parts.reduce((n, p) => n + p.tokens, 0) || 1;
    return parts.map(p => ({ ...p, pct: (p.tokens / total) * 100 }));
  }, [data]);

  function copyAll() {
    if (!data) return;
    const text = (data.raw || []).map(m => `### ${m.role}\n${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n');
    copyText(text).then(ok => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1600); } });
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target.classList.contains('overlay') && onClose()}>
      <div className="modal" ref={boxRef} role="dialog" aria-modal="true" style={{ maxWidth: 760, width: '92vw' }}>
        <button className="modal-close" onClick={onClose} aria-label={t('Close')}>✕</button>
        <h2>{t('What gets sent')}</h2>
        <div className="hint">{t('The exact prompt this conversation would send right now, in order, with what each part costs.')}</div>
        {err && <div className="err">{err}</div>}
        {!data && !err && <div className="muted-note">{t('Assembling…')}</div>}
        {data && (
          <>
            <div className="pl-bar">
              {bar.map((p, i) => <i key={i} style={{ width: p.pct + '%', background: p.color }} title={`${p.label}: ${p.tokens}`} />)}
            </div>
            <div className="field row" style={{ borderBottom: 0 }}>
              <div>
                <label>{data.modelName}</label>
                <div className="muted-note">
                  {t('{n} tokens total', { n: data.total.toLocaleString() })}
                  {data.dropped > 0 && ' · ' + t('{n} message(s) not included', { n: data.dropped })}
                </div>
              </div>
              <button className="btn ghost" onClick={copyAll}>{copied ? t('Copied') : t('Copy prompt')}</button>
            </div>
            {data.sections.map((s, i) => (
              <Section key={s.name} label={s.name} role="system" tokens={s.tokens} text={s.text}
                color={COLORS[i % COLORS.length]}
                open={!!open['s' + i]} onToggle={() => setOpen(o => ({ ...o, ['s' + i]: !o['s' + i] }))} />
            ))}
            {data.messages.map((m, i) => (
              <Section key={'m' + i} label={m.text.slice(0, 80).replace(/\s+/g, ' ') || t('(empty)')} role={m.role} tokens={m.tokens} text={m.text}
                open={!!open['m' + i]} onToggle={() => setOpen(o => ({ ...o, ['m' + i]: !o['m' + i] }))} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
