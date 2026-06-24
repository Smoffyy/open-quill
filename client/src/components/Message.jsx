import React, { useState, useRef, useEffect } from 'react';
import Markdown from './Markdown.jsx';
import { copyText } from '../clipboard.js';
import { openLightbox } from '../lightbox.js';
import ReasoningBlock from './ReasoningBlock.jsx';
import BranchCompare from './BranchCompare.jsx';
import { Copy, Check, ThumbUp, ThumbDown, Retry, FileText, Pencil, Fork, Pin } from './icons.jsx';

function Columns(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" /></svg>);
}

const glowCache = new Map();
function useLogoGlow(src) {
  const [color, setColor] = useState(() => glowCache.get(src) || null);
  useEffect(() => {
    if (!src) return;
    if (glowCache.has(src)) { setColor(glowCache.get(src)); return; }
    let on = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const S = 24;
        const cv = document.createElement('canvas');
        cv.width = S; cv.height = S;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, S, S);
        const d = cx.getImageData(0, 0, S, S).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3];
          if (a < 40) continue;
          const lum = d[i] + d[i + 1] + d[i + 2];
          if (lum > 720 || lum < 36) continue;
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
        const c = n > 8 ? `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})` : null;
        glowCache.set(src, c);
        if (on) setColor(c);
      } catch { glowCache.set(src, null); if (on) setColor(null); }
    };
    img.onerror = () => { glowCache.set(src, null); if (on) setColor(null); };
    img.src = src;
    return () => { on = false; };
  }, [src]);
  return color;
}

function fmtTime(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  return {
    short: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    full: d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
  };
}

function BranchNav({ msg, onSelectBranch }) {
  if (!msg.branchCount || msg.branchCount < 2) return null;
  const i = msg.branchIndex ?? 0;
  const go = (d) => { const t = msg.siblings?.[i + d]; if (t) onSelectBranch?.(t); };
  return (
    <span className="branch-nav">
      <button className="branch-arrow" disabled={i <= 0} onClick={() => go(-1)} title="Previous version">‹</button>
      <span className="branch-count">{i + 1}/{msg.branchCount}</span>
      <button className="branch-arrow" disabled={i >= msg.branchCount - 1} onClick={() => go(1)} title="Next version">›</button>
    </span>
  );
}

function Attachments({ items, pins, onTogglePinFile }) {
  if (!items || !items.length) return null;
  const pinnedUrls = new Set((pins || []).map(p => p.url));
  return (
    <div className="msg-attachments">
      {items.map((a, i) => a.type && a.type.startsWith('image/') ? (
        <button key={i} className="att image" onClick={() => openLightbox(a.url, a.name)}><img src={a.url} alt={a.name} /></button>
      ) : (
        <div key={i} className={'att file' + (pinnedUrls.has(a.url) ? ' pinned-file' : '')}>
          <a className="att-link" href={a.url} target="_blank" rel="noreferrer">
            <FileText style={{ width: 18 }} />
            <div className="att-meta"><div className="att-name">{a.name}</div><div className="att-type">{(a.name.split('.').pop() || 'file').toUpperCase()}</div></div>
          </a>
          {onTogglePinFile && (
            <button className={'att-pin' + (pinnedUrls.has(a.url) ? ' on' : '')} title={pinnedUrls.has(a.url) ? 'Unpin from chat' : 'Pin to chat (keep in context)'} onClick={() => onTogglePinFile(a)}><Pin style={{ width: 13 }} /></button>
          )}
        </div>
      ))}
    </div>
  );
}

function ModelIcon({ model, phase, below, name }) {
  const base = model?.staticIcon || '';
  const map = {
    static: base,
    generating: model?.generatingIcon || base,
    thinking: model?.thinkingIcon || base
  };
  const src = map[phase] || base;
  const glow = useLogoGlow(phase === 'generating' || phase === 'thinking' ? src : null);
  if (!base && !name) return null;
  const anim = phase === 'generating' ? (model?.generatingAnim || 'spin') : phase === 'thinking' ? (model?.thinkingAnim || 'pulse') : '';
  const cls = anim === 'none' ? '' : anim;
  const sz = model?.iconSize > 0 ? model.iconSize : 40;
  return (
    <div className={'msg-icon' + (below ? ' below' : '') + (name ? ' with-name' : '')}>
      {base && <img src={src} className={cls} style={{ width: sz, height: sz, ...(glow ? { '--icon-glow': glow } : {}) }} alt="" />}
      {name && <span className="msg-icon-name">{name}</span>}
    </div>
  );
}

function Message({ msg, model, models, currentId, streaming, phase, chatId, pins, onTogglePinFile, onRegenerate, onRegenerateWith, onEdit, onSelectBranch, onFork, onTogglePin, showIcon = true }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [retryMenu, setRetryMenu] = useState(false);
  const [compare, setCompare] = useState(false);
  const retryRef = useRef(null);
  const taRef = useRef(null);
  useEffect(() => {
    if (!retryMenu) return;
    const h = (e) => { if (retryRef.current && !retryRef.current.contains(e.target)) setRetryMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [retryMenu]);
  useEffect(() => {
    if (editing && taRef.current) { const el = taRef.current; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight + 2, 460) + 'px'; }
  }, [editing, draft]);
  async function doCopy() {
    const clean = (msg.content || '').replace(/\[\[OQR:[A-Za-z0-9+/=]+\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!(await copyText(clean))) return;
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  }
  function startEdit() { setDraft(msg.content || ''); setEditing(true); }
  function saveEdit() { const v = draft.trim(); setEditing(false); if (v && v !== msg.content) onEdit?.(msg.id, v); }
  if (msg.role === 'user') {
    return (
      <div className={'msg user' + (msg._enter ? ' enter' : '') + (msg.pinned ? ' pinned' : '')} data-mid={msg.id}>
        <div className="user-col">
          {msg.pinned && <div className="pin-tag"><Pin style={{ width: 12 }} /> Pinned</div>}
          <Attachments items={msg.attachments} pins={pins} onTogglePinFile={onTogglePinFile} />
          {editing ? (
            <div className="edit-box">
              <textarea ref={taRef} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit(); if (e.key === 'Escape') setEditing(false); }} />
              <div className="edit-actions">
                <button className="btn ghost" onClick={() => setEditing(false)}>Cancel</button>
                <button className="btn primary" onClick={saveEdit}>Save &amp; submit</button>
              </div>
            </div>
          ) : (
            msg.content && <div className="bubble-user"><Markdown>{msg.content}</Markdown></div>
          )}
          {msg.content && !editing && (
            <div className="actions user-actions">
              {(() => { const t = fmtTime(msg.created_at); return t ? <span className="msg-time" data-full={t.full}>{t.short}</span> : null; })()}
              <BranchNav msg={msg} onSelectBranch={onSelectBranch} />
              {msg.branchCount > 1 && chatId && <button className="action-btn" onClick={() => setCompare(true)} title="Compare versions"><Columns style={{ width: 15 }} /></button>}
              <button className="action-btn" onClick={doCopy} title="Copy">{copied ? <Check /> : <Copy />}</button>
              {onEdit && <button className="action-btn" onClick={startEdit} title="Edit"><Pencil style={{ width: 15 }} /></button>}
              {onFork && <button className="action-btn" onClick={() => onFork(msg.id)} title="Fork into a new chat"><Fork style={{ width: 15 }} /></button>}
              {onTogglePin && <button className={'action-btn' + (msg.pinned ? ' on' : '')} onClick={() => onTogglePin(msg.id, !msg.pinned)} title={msg.pinned ? 'Unpin' : 'Pin (keep in context)'}><Pin style={{ width: 15 }} /></button>}
            </div>
          )}
          {compare && chatId && <BranchCompare chatId={chatId} messageId={msg.id} onSelect={onSelectBranch} onClose={() => setCompare(false)} />}
        </div>
      </div>
    );
  }
  const pos = model?.iconPosition || 'below';
  const iconPhase = streaming ? phase : 'static';
  const showIt = showIcon || streaming;
  const showName = !!model?.showName && !!model?.displayName;
  const icon = showIt ? <ModelIcon model={model} phase={iconPhase} below={pos === 'below'} name={pos === 'left' ? null : (showName ? model.displayName : null)} /> : null;

  const inner = (
    <>
      {msg.pinned && <div className="pin-tag"><Pin style={{ width: 12 }} /> Pinned</div>}
      <ReasoningBlock text={msg.reasoning} live={streaming && phase === 'thinking'} collapsible={model?.reasoningCollapsible !== false} />
      {(msg.content || !streaming) && (
        <div className={'assistant-body' + (streaming ? ' streaming' : '')}>
          <Markdown streaming={streaming}>{msg.content}</Markdown>
        </div>
      )}
      {!streaming && msg.content && (
        <div className="actions">
          <button className="action-btn" onClick={doCopy} title="Copy">{copied ? <Check /> : <Copy />}</button>
          <BranchNav msg={msg} onSelectBranch={onSelectBranch} />
          {msg.branchCount > 1 && chatId && <button className="action-btn" onClick={() => setCompare(true)} title="Compare versions"><Columns style={{ width: 15 }} /></button>}
          <span className="retry-wrap" ref={retryRef}>
            <button className="action-btn" title="Retry" onClick={() => onRegenerate?.(msg.id)}><Retry /></button>
            {onRegenerateWith && models && models.length > 1 && (
              <button className="action-caret" title="Retry with another model" onClick={() => setRetryMenu(o => !o)}>▾</button>
            )}
            {retryMenu && (
              <div className="retry-menu">
                <div className="retry-menu-label">Retry with</div>
                {models.map(mm => (
                  <button key={mm.id} className={mm.id === currentId ? 'on' : ''} onClick={() => { setRetryMenu(false); onRegenerateWith(msg.id, mm.id); }}>
                    {mm.staticIcon && <img src={mm.staticIcon} alt="" />}{mm.displayName}{mm.id === currentId && <Check style={{ width: 13, marginLeft: 'auto' }} />}
                  </button>
                ))}
              </div>
            )}
          </span>
          {onFork && <button className="action-btn" title="Fork into a new chat" onClick={() => onFork(msg.id)}><Fork /></button>}
          {onTogglePin && <button className={'action-btn' + (msg.pinned ? ' on' : '')} title={msg.pinned ? 'Unpin' : 'Pin (keep in context)'} onClick={() => onTogglePin(msg.id, !msg.pinned)}><Pin /></button>}
          {model?.displayName && <span className="msg-model-badge">{model.displayName}</span>}
        </div>
      )}
      {compare && chatId && <BranchCompare chatId={chatId} messageId={msg.id} onSelect={onSelectBranch} onClose={() => setCompare(false)} />}
    </>
  );

  if (pos === 'left') {
    return (
      <div className={'msg assistant icon-left' + (msg._enter ? ' enter' : '') + (!streaming && msg.content ? ' has-actions' : '') + (msg.pinned ? ' pinned' : '')} data-mid={msg.id}>
        <div className="assistant-row">
          <div className="assistant-avatar">{icon}</div>
          <div className="assistant-main">
            {showName && <div className="assistant-name">{model.displayName}</div>}
            {inner}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={'msg assistant' + (msg._enter ? ' enter' : '') + (!streaming && msg.content ? ' has-actions' : '') + (msg.pinned ? ' pinned' : '')} data-mid={msg.id}>
      {pos === 'above' && icon}
      {inner}
      {pos === 'below' && icon}
    </div>
  );
}

export default React.memo(Message);
