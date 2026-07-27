import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Markdown from './Markdown.jsx';
import { copyText } from '../clipboard.js';
import { openLightbox } from '../lightbox.js';
import ReasoningBlock from './ReasoningBlock.jsx';
import BranchCompare from './BranchCompare.jsx';
import ToolCard from './ToolCard.jsx';
import { Copy, Check, ThumbUp, ThumbDown, Retry, FileText, Pencil, Fork, Pin, Trash, Dots, Steer } from './icons.jsx';
import { api } from '../api.js';
import { extLabel } from '../lib/files.js';
import { t } from '../i18n.jsx';

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

function MoreMenu({ items }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (menuRef.current && !menuRef.current.contains(e.target) && btnRef.current && !btnRef.current.contains(e.target)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', h);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('mousedown', h); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    const mh = menu ? menu.offsetHeight : 220;
    const mw = menu ? menu.offsetWidth : 200;
    const below = window.innerHeight - r.bottom;
    const up = below < mh + 12 && r.top > below;
    const top = up ? Math.max(8, r.top - mh - 6) : r.bottom + 6;
    const left = Math.min(Math.max(8, r.right - mw), window.innerWidth - mw - 8);
    setPos({ top, left });
  }, [open]);
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <span className="retry-wrap">
      <button ref={btnRef} className={'action-btn' + (open ? ' on' : '')} title={t("More actions")} onClick={() => setOpen(o => !o)}><Dots style={{ width: 18 }} /></button>
      {open && createPortal(
        <div ref={menuRef} className="retry-menu more-menu portal"
          style={{ position: 'fixed', top: pos ? pos.top : -9999, left: pos ? pos.left : -9999, right: 'auto', bottom: 'auto', visibility: pos ? 'visible' : 'hidden', zIndex: 200 }}>
          {list.map((it, i) => (
            <button key={i} className={(it.on ? 'on' : '') + (it.danger ? ' danger' : '')} onClick={() => { setOpen(false); it.run(); }}>
              {it.icon}{it.label}
            </button>
          ))}
        </div>, document.body)}
    </span>
  );
}

function BranchNav({ msg, onSelectBranch }) {
  if (!msg.branchCount || msg.branchCount < 2) return null;
  const i = msg.branchIndex ?? 0;
  const go = (d) => { const t = msg.siblings?.[i + d]; if (t) onSelectBranch?.(t); };
  return (
    <span className="branch-nav">
      <button className="branch-arrow" disabled={i <= 0} onClick={() => go(-1)} title={t("Previous version")}>‹</button>
      <span className="branch-count">{i + 1}/{msg.branchCount}</span>
      <button className="branch-arrow" disabled={i >= msg.branchCount - 1} onClick={() => go(1)} title={t("Next version")}>›</button>
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
          <a className="att-link" href={a.url} target="_blank" rel="noreferrer" title={a.name}>
            <span className="att-name">{a.name}</span>
            <span className="att-foot">
              <FileText style={{ width: 13 }} />
              <span className="att-type">{extLabel(a.name)}</span>
            </span>
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

function StreamStatus({ status }) {
  const pct = status && Number.isFinite(status.pct) ? status.pct : null;
  const total = status && status.total ? status.total : 0;
  const cached = status && status.cache ? status.cache : 0;
  const label = status && status.phase === 'generating' ? t('Working') : t('Reading your prompt');
  return (
    <div className="model-status" role="status">
      <span className="mst-label">{label}</span>
      {pct !== null && total > 0 && (
        <>
          <span className="mst-bar"><span className="mst-fill" style={{ width: pct + '%' }} /></span>
          <span className="mst-pct">{pct}%</span>
        </>
      )}
      {total > 0 && <span className="mst-note">{cached > 0 ? `${cached.toLocaleString()} ${t('cached')} · ${total.toLocaleString()} ${t('tokens')}` : `${total.toLocaleString()} ${t('tokens')}`}</span>}
    </div>
  );
}

function LedgerRow({ tokens, pct, state, id, onToggleExclude }) {
  const excluded = state === 'excluded';
  const summarized = state === 'summarized';
  return (
    <div className={'ctx-row' + (excluded ? ' excluded' : '') + (summarized ? ' summarized' : '')}>
      <span className="ctx-tokens">{Number(tokens || 0).toLocaleString()} {t('tok')}</span>
      {pct > 0 && <span className="ctx-bar"><span className="ctx-fill" style={{ width: Math.min(100, pct) + '%' }} /></span>}
      {pct > 0 && <span className="ctx-pct">{pct}%</span>}
      {summarized && <span className="ctx-tag">{t('in summary')}</span>}
      {excluded && <span className="ctx-tag out">{t('not sent')}</span>}
      {onToggleExclude && !summarized && (
        <button className="ctx-btn" onClick={() => onToggleExclude(id, !excluded)}
          title={excluded ? t('Send this message to the model again') : t('Stop sending this message to the model')}>
          {excluded ? t('Restore') : t('Drop')}
        </button>
      )}
    </div>
  );
}

function SteerChips({ notes }) {
  if (!notes || !notes.length) return null;
  return (
    <div className="steer-chips">
      {notes.map((n, i) => (
        <span key={i} className="steer-chip" title={n}><Steer style={{ width: 11 }} /> {t('steered')}: {n}</span>
      ))}
    </div>
  );
}

function Message({ msg, model, models, currentId, streaming, phase, liveCall, chatId, pins, onTogglePinFile, onRegenerate, onRegenerateWith, onEdit, onDelete, onSelectBranch, onFork, onTogglePin, showIcon = true, chatEnded = false, ledger = false, ledgerTokens = 0, ledgerPct = 0, ledgerState = '', onToggleExclude, steers = null, status = null }) {
  if (chatEnded) { onRegenerate = null; onRegenerateWith = null; onEdit = null; onFork = null; onDelete = null; }
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef(null);
  useEffect(() => {
    if (!streaming || !msg.content) { setTyping(false); return; }
    setTyping(true);
    clearTimeout(typingTimer.current);
    const v = parseInt(document.documentElement.style.getPropertyValue('--caret-blink'));
    typingTimer.current = setTimeout(() => setTyping(false), Number.isFinite(v) && v > 0 ? v : 500);
    return () => clearTimeout(typingTimer.current);
  }, [streaming, msg.content]);
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
      <div className={'msg user' + (msg._enter ? ' enter' : '') + (msg.pinned ? ' pinned' : '') + (ledger && ledgerState === 'excluded' ? ' ctx-out' : '')} data-mid={msg.id}>
        <div className="user-col">
          {ledger && ledgerState && <LedgerRow tokens={ledgerTokens} pct={ledgerPct} state={ledgerState} id={msg.id} onToggleExclude={onToggleExclude} />}
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
              {msg.branchCount > 1 && chatId && <button className="action-btn" onClick={() => setCompare(true)} title={t("Compare versions")}><Columns style={{ width: 18 }} /></button>}
              <button className="action-btn" onClick={doCopy} title={t("Copy")}>{copied ? <Check /> : <Copy />}</button>
              {onEdit && <button className="action-btn" onClick={startEdit} title={t("Edit")}><Pencil style={{ width: 18 }} /></button>}
              <MoreMenu items={[
                onFork && { label: t('Branch into a new chat'), icon: <Fork style={{ width: 15 }} />, run: () => onFork(msg.id) },
                onTogglePin && { label: msg.pinned ? t('Unpin') : t('Pin (keep in context)'), icon: <Pin style={{ width: 15 }} />, on: !!msg.pinned, run: () => onTogglePin(msg.id, !msg.pinned) },
                onDelete && chatId && { label: t('Delete message'), icon: <Trash style={{ width: 15 }} />, danger: true, run: () => onDelete(msg.id) }
              ]} />
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

  const [fb, setFb] = useState(msg.feedback || 0);
  useEffect(() => { setFb(msg.feedback || 0); }, [msg.id]);
  async function rate(r) {
    const next = fb === r ? 0 : r;
    setFb(next);
    try { await api.post(`/api/messages/${msg.id}/feedback`, { rating: next }); } catch { setFb(fb); }
  }

  const inner = (
    <>
      {ledger && ledgerState && <LedgerRow tokens={ledgerTokens} pct={ledgerPct} state={ledgerState} id={msg.id} onToggleExclude={onToggleExclude} />}
      {msg.pinned && <div className="pin-tag"><Pin style={{ width: 12 }} /> Pinned</div>}
      <ReasoningBlock text={msg.reasoning} live={streaming && phase === 'thinking'} collapsible={model?.reasoningCollapsible !== false} />
      {(msg.content || streaming) && (
        <div className={'assistant-body' + (streaming ? ' streaming' : '') + (streaming && typing ? ' typing' : '') + (streaming && phase === 'thinking' ? ' thinking' : '')}>
          {msg.content ? <Markdown streaming={streaming}>{msg.content}</Markdown> : null}
          {streaming && liveCall && liveCall.tool && (
            <div className="tool-live"><ToolCard call={liveCall} result={null} /></div>
          )}
          {streaming && !msg.content && !liveCall && <StreamStatus status={status} />}
          {streaming && !msg.content && !liveCall && <p className="stream-wait" aria-hidden="true"></p>}
        </div>
      )}
      {streaming && msg.content && (
        <div className="actions stream-actions">
          <button className="action-btn" onClick={doCopy} title={t("Copy what's written so far")}>{copied ? <Check /> : <Copy />}</button>
        </div>
      )}
      {!streaming && msg.content && (
        <div className="actions">
          <button className="action-btn" onClick={doCopy} title={t("Copy")}>{copied ? <Check /> : <Copy />}</button>
          <BranchNav msg={msg} onSelectBranch={onSelectBranch} />
          {msg.branchCount > 1 && chatId && <button className="action-btn" onClick={() => setCompare(true)} title={t("Compare versions")}><Columns style={{ width: 18 }} /></button>}
          <span className="retry-wrap" ref={retryRef}>
            {onRegenerate && <button className="action-btn" title={t("Retry")} onClick={() => onRegenerate(msg.id)}><Retry /></button>}
            {onRegenerateWith && models && models.length > 1 && (
              <button className="action-caret" title={t("Retry with another model")} onClick={() => setRetryMenu(o => !o)}>▾</button>
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
          <MoreMenu items={[
            chatId && !String(msg.id).startsWith('inc-') && { label: t('Good response'), icon: <ThumbUp style={{ width: 15 }} />, on: fb === 1, run: () => rate(1) },
            chatId && !String(msg.id).startsWith('inc-') && { label: t('Bad response'), icon: <ThumbDown style={{ width: 15 }} />, on: fb === -1, run: () => rate(-1) },
            onFork && { label: t('Branch into a new chat'), icon: <Fork style={{ width: 15 }} />, run: () => onFork(msg.id) },
            onTogglePin && { label: msg.pinned ? t('Unpin') : t('Pin (keep in context)'), icon: <Pin style={{ width: 15 }} />, on: !!msg.pinned, run: () => onTogglePin(msg.id, !msg.pinned) },
            onDelete && chatId && !String(msg.id).startsWith('inc-') && { label: t('Delete message'), icon: <Trash style={{ width: 15 }} />, danger: true, run: () => onDelete(msg.id) }
          ]} />
          {model?.displayName && <span className="msg-model-badge">{model.displayName}</span>}
        </div>
      )}
      <SteerChips notes={steers} />
      {compare && chatId && <BranchCompare chatId={chatId} messageId={msg.id} onSelect={onSelectBranch} onClose={() => setCompare(false)} />}
    </>
  );

  if (pos === 'left') {
    const gutter = model?.iconSize > 0 ? model.iconSize : 40;
    return (
      <div className={'msg assistant icon-left' + (msg._enter ? ' enter' : '') + (!streaming && msg.content ? ' has-actions' : '') + (msg.pinned ? ' pinned' : '') + (ledger && ledgerState === 'excluded' ? ' ctx-out' : '')} data-mid={msg.id}>
        {icon && <div className="il-avatar" style={{ left: -(gutter + 14) }}>{icon}</div>}
        {showName && <div className="assistant-name">{model.displayName}</div>}
        {inner}
      </div>
    );
  }

  return (
    <div className={'msg assistant' + (msg._enter ? ' enter' : '') + (!streaming && msg.content ? ' has-actions' : '') + (msg.pinned ? ' pinned' : '') + (ledger && ledgerState === 'excluded' ? ' ctx-out' : '')} data-mid={msg.id}>
      {pos === 'above' && icon}
      {inner}
      {pos === 'below' && icon}
    </div>
  );
}

export default React.memo(Message);
