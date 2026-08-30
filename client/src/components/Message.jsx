import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import Markdown, { ReasonSegs } from './Markdown.jsx';
import { copyText } from '../clipboard.js';
import { openLightbox } from '../lightbox.js';
import ReasoningBlock from './ReasoningBlock.jsx';
import BranchCompare from './BranchCompare.jsx';
import ToolCard from './ToolCard.jsx';
import { Copy, Check, ThumbUp, ThumbDown, Retry, FileText, Pencil, Fork, Pin, Trash, Dots, Steer } from './icons.jsx';
import { api } from '../api.js';
import { extLabel } from '../lib/files.js';
import { useStatusLabel } from '../lib/status.js';
import { useAnchoredMenu, menuStyleOf } from '../lib/anchor.js';
import { t } from '../i18n.jsx';

function UserBubble({ content }) {
  const [collapsed, setCollapsed] = useState(true);
  const [overflowing, setOverflowing] = useState(false);
  const textRef = useRef(null);
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const clampPx = parseFloat(getComputedStyle(el).getPropertyValue('--user-clamp-h')) || 200;
    setOverflowing(el.scrollHeight > clampPx + 1);
  }, [content]);
  return (
    <div className="bubble-user">
      <div className={'bubble-user-text' + (collapsed && overflowing ? ' clamped' : '')} ref={textRef}>
        <Markdown>{content}</Markdown>
      </div>
      {overflowing && (
        <button className="bubble-toggle" onClick={() => setCollapsed(c => !c)}>
          {collapsed ? t('Show more') : t('Show less')}
        </button>
      )}
    </div>
  );
}

function Columns(props) {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" /></svg>);
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
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const pos = useAnchoredMenu(open, setOpen, btnRef, menuRef, { align: 'center' });
  const list = items.filter(Boolean);
  if (!list.length) return null;
  return (
    <span className="retry-wrap">
      <button ref={btnRef} className={'action-btn' + (open ? ' on' : '')} title={t("More actions")} aria-label={t("More actions")} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(o => !o)}><Dots /></button>
      {open && createPortal(
        <div ref={menuRef} className="retry-menu more-menu portal" role="menu" aria-label={t("More actions")} style={menuStyleOf(pos)}>
          {list.map((it, i) => (
            <button key={i} role="menuitem" aria-checked={it.on ? 'true' : undefined} className={(it.on ? 'on' : '') + (it.danger ? ' danger' : '')} onClick={() => { setOpen(false); it.run(); }}>
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
    <span className="branch-nav" role="group" aria-label={t("Message versions")}>
      <button className="branch-arrow" disabled={i <= 0} onClick={() => go(-1)} title={t("Previous version")} aria-label={t("Previous version")}>‹</button>
      <span className="branch-count" aria-live="polite">{i + 1}/{msg.branchCount}</span>
      <button className="branch-arrow" disabled={i >= msg.branchCount - 1} onClick={() => go(1)} title={t("Next version")} aria-label={t("Next version")}>›</button>
    </span>
  );
}

function Attachments({ items, pins, onTogglePinFile }) {
  if (!items || !items.length) return null;
  const pinnedUrls = new Set((pins || []).map(p => p.url));
  return (
    <div className="msg-attachments">
      {items.map((a, i) => a.type && a.type.startsWith('image/') ? (
        <button key={i} className="att image" onClick={() => openLightbox(a.url, a.name)} aria-label={t('Open image {name}', { name: a.name })}><img src={a.url} alt={a.name} loading="lazy" decoding="async" /></button>
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
            <button className={'att-pin' + (pinnedUrls.has(a.url) ? ' on' : '')} title={pinnedUrls.has(a.url) ? t('Unpin from chat') : t('Pin to chat (keep in context)')} aria-label={pinnedUrls.has(a.url) ? t('Unpin from chat') : t('Pin to chat')} aria-pressed={pinnedUrls.has(a.url)} onClick={() => onTogglePinFile(a)}><Pin style={{ width: 13 }} /></button>
          )}
        </div>
      ))}
    </div>
  );
}

function StatusCaption({ label, detail }) {
  const [mounted, setMounted] = useState(!!label);
  const [visible, setVisible] = useState(false);
  const [text, setText] = useState(label || '');
  const [title, setTitle] = useState(detail || '');
  const shown = useRef(false);
  const hideTimer = useRef(null);
  useEffect(() => {
    if (label) {
      setText(label);
      setTitle(detail || '');
      if (!shown.current) {
        shown.current = true;
        clearTimeout(hideTimer.current);
        setMounted(true);
        const raf = requestAnimationFrame(() => setVisible(true));
        return () => cancelAnimationFrame(raf);
      }
    } else if (shown.current) {
      shown.current = false;
      setVisible(false);
      hideTimer.current = setTimeout(() => setMounted(false), 220);
    }
  }, [label, detail]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  if (!mounted) return null;
  return <span className={'msg-icon-status' + (visible ? ' show' : '')} title={title || undefined}>{text}</span>;
}

const ModelIcon = React.forwardRef(function ModelIcon({ model, phase, below, name, statusLabel, statusDetail }, ref) {
  const base = model?.staticIcon || '';
  const map = {
    static: base,
    generating: model?.generatingIcon || base,
    thinking: model?.thinkingIcon || base
  };
  const src = map[phase] || base;
  if (!base && !name && !statusLabel) return null;
  const anim = phase === 'generating' ? (model?.generatingAnim || 'none') : phase === 'thinking' ? (model?.thinkingAnim || 'none') : '';
  const cls = anim === 'none' ? '' : anim;
  const sz = model?.iconSize > 0 ? model.iconSize : 40;
  return (
    <div ref={ref} className={'msg-icon' + (below ? ' below' : '') + (name ? ' with-name' : '')}>
      {base && <img src={src} className={cls} style={{ width: sz, height: sz }} alt="" />}
      {name && <span className="msg-icon-name">{name}</span>}
      <StatusCaption label={statusLabel} detail={statusDetail} />
    </div>
  );
});

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
        <button className="ctx-btn" aria-pressed={excluded} onClick={() => onToggleExclude(id, !excluded)}
          title={excluded ? t('Send this message to the model again') : t('Stop sending this message to the model')}>
          {excluded ? t('Restore') : t('Drop')}
        </button>
      )}
    </div>
  );
}

function SpeedChip({ speed }) {
  if (!speed || !(speed.tps > 0)) return null;
  const rate = speed.tps >= 100 ? Math.round(speed.tps) : Math.round(speed.tps * 10) / 10;
  const bits = [];
  if (speed.promptTps > 0) bits.push(`${t('prompt')} ${Math.round(speed.promptTps)} tok/s`);
  if (speed.out > 0) bits.push(`${Number(speed.out).toLocaleString()} ${t('tokens out')}`);
  if (!speed.exact) bits.push(t('Estimated from streamed text, this provider does not report timings.'));
  return <span className="msg-speed" title={bits.join(' · ')}>{rate} tok/s{!speed.exact && <span className="ms-est">~</span>}</span>;
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

function Message({ msg, model, models, currentId, streaming, phase, liveCall, liveCalls = null, canContinue = false, onContinue, chatId, pins, onTogglePinFile, onRegenerate, onRegenerateWith, onEdit, onDelete, onSelectBranch, onFork, onTogglePin, showIcon = true, chatEnded = false, ledger = false, ledgerTokens = 0, ledgerPct = 0, ledgerState = '', onToggleExclude, steers = null, status = null, statusDelay = true, showSpeed = false, preset = 'anthropic' }) {
  if (chatEnded) { onRegenerate = null; onRegenerateWith = null; onEdit = null; onFork = null; onDelete = null; }
  if (!chatId) { onRegenerate = null; onRegenerateWith = null; onEdit = null; onFork = null; onTogglePin = null; }
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
  const [textEntered, setTextEntered] = useState(false);
  useEffect(() => {
    if (streaming && msg.content) setTextEntered(true);
  }, [streaming, msg.content]);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [retryMenu, setRetryMenu] = useState(false);
  const [compare, setCompare] = useState(false);
  const retryRef = useRef(null);
  const retryMenuRef = useRef(null);
  const retryPos = useAnchoredMenu(retryMenu, setRetryMenu, retryRef, retryMenuRef, { align: 'center' });
  async function doCopy() {
    const clean = (msg.content || '').replace(/\[\[OQ(?:R:[A-Za-z0-9+/=]+|T:\d+)\]\]/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!(await copyText(clean))) return;
    setCopied(true); setTimeout(() => setCopied(false), 1400);
  }
  function startEdit() { setDraft(msg.content || ''); setEditing(true); }
  useEffect(() => {
    if (!onEdit) return;
    const h = (e) => { if (e.detail && e.detail.id === msg.id) startEdit(); };
    window.addEventListener('oq-msg-edit', h);
    return () => window.removeEventListener('oq-msg-edit', h);
  }, [onEdit, msg.id, msg.content]);
  function saveEdit() { const v = draft.trim(); setEditing(false); if (v && v !== msg.content) onEdit?.(msg.id, v); }

  const pos = model?.iconPosition || 'below';
  const iconRef = useRef(null);
  const iconSlide = useRef({ top: null, done: false });
  useLayoutEffect(() => {
    const el = iconRef.current;
    if (pos !== 'below' || !streaming || !el) { iconSlide.current = { top: null, done: false }; return; }
    const state = iconSlide.current;
    const top = el.offsetTop;
    if (state.top === null) {
      state.top = top;
      return;
    }
    if (state.done) return;
    const delta = state.top - top;
    if (Math.abs(delta) > 0.5) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${delta}px)`;
      requestAnimationFrame(() => {
        el.style.transition = 'transform .6s cubic-bezier(.16,1,.3,1)';
        el.style.transform = '';
      });
      state.done = true;
    }
  }, [pos, streaming, msg.content, msg.reasoning, phase, liveCall, liveCalls]);

  const [fb, setFb] = useState(msg.feedback || 0);
  useEffect(() => { setFb(msg.feedback || 0); }, [msg.id]);

  const segs = Array.isArray(msg.reasoningSegs) ? msg.reasoningSegs : null;
  const tailIsMarker = segs && /\[\[OQT:\d+\]\]\s*$/.test(msg.content || '');
  const segMs = Array.isArray(msg.reasoningSegMs) ? msg.reasoningSegMs : null;
  const segMsKey = segMs ? segMs.join(',') : '';
  const segCtx = useMemo(
    () => (segs ? { segs, segMs, live: !!(streaming && tailIsMarker), preset, collapsible: model?.reasoningCollapsible !== false } : null),
    [segs, segMsKey, streaming, tailIsMarker, preset, model]
  );
  const statusInfo = useStatusLabel(status, statusDelay);

  if (msg.role === 'user') {
    return (
      <div role="article" aria-label={t('Your message')} className={'msg user' + (msg._enter ? ' enter' : '') + (msg.pinned ? ' pinned' : '') + (ledger && ledgerState === 'excluded' ? ' ctx-out' : '')} data-mid={msg.id}>
        <div className="user-col">
          {ledger && ledgerState && <LedgerRow tokens={ledgerTokens} pct={ledgerPct} state={ledgerState} id={msg.id} onToggleExclude={onToggleExclude} />}
          {msg.pinned && <div className="pin-tag"><Pin style={{ width: 12 }} /> {t("Pinned")}</div>}
          <Attachments items={msg.attachments} pins={pins} onTogglePinFile={onTogglePinFile} />
          {editing ? (
            <>
              <div className="edit-box" data-value={draft + ' '}>
                <textarea value={draft} autoFocus rows={1} cols={1} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit(); if (e.key === 'Escape') setEditing(false); }} />
              </div>
              <div className="edit-actions">
                <button className="btn ghost" onClick={() => setEditing(false)}>{t("Cancel")}</button>
                <button className="btn primary" onClick={saveEdit}>{t("Save & submit")}</button>
              </div>
            </>
          ) : (
            msg.content && <UserBubble content={msg.content} />
          )}
          {msg.content && !editing && (
            <div className="actions user-actions">
              {(() => { const t = fmtTime(msg.created_at); return t ? <span className="msg-time" data-full={t.full}>{t.short}</span> : null; })()}
              <BranchNav msg={msg} onSelectBranch={onSelectBranch} />
              {msg.branchCount > 1 && chatId && <button className="action-btn" onClick={() => setCompare(true)} title={t("Compare versions")} aria-label={t("Compare versions")}><Columns /></button>}
              {onRegenerate && <button className="action-btn" onClick={() => onRegenerate(msg.id)} title={t("Retry")} aria-label={t("Retry")}><Retry /></button>}
              {onEdit && <button className="action-btn" onClick={startEdit} title={t("Edit")} aria-label={t("Edit")}><Pencil /></button>}
              <button className="action-btn" onClick={doCopy} title={t("Copy")} aria-label={copied ? t("Copied") : t("Copy")}>{copied ? <Check /> : <Copy />}</button>
              <MoreMenu items={[
                onFork && { label: t('Branch'), icon: <Fork style={{ width: 15 }} />, run: () => onFork(msg.id) },
                onTogglePin && { label: msg.pinned ? t('Unpin') : t('Pin'), icon: <Pin style={{ width: 15 }} />, on: !!msg.pinned, run: () => onTogglePin(msg.id, !msg.pinned) },
                onDelete && chatId && { label: t('Delete'), icon: <Trash style={{ width: 15 }} />, danger: true, run: () => onDelete(msg.id) }
              ]} />
            </div>
          )}
          {compare && chatId && <BranchCompare chatId={chatId} messageId={msg.id} onSelect={onSelectBranch} onClose={() => setCompare(false)} />}
        </div>
      </div>
    );
  }
  const iconPhase = streaming ? phase : 'static';
  const showIt = showIcon || streaming;
  const showName = !!model?.showName && !!model?.displayName;

  // Every call the model is currently spelling out, so a step that writes six
  // files shows six rows instead of one that keeps being overwritten. Falls back
  // to the single call for any caller that has not been updated.
  const liveRows = (liveCalls && liveCalls.length)
    ? liveCalls
    : (liveCall && liveCall.tool ? [{ index: 0, call: liveCall }] : []);
  const showStatus = streaming && !msg.content && !msg.reasoning && !liveRows.length && statusInfo.show;
  const icon = showIt ? <ModelIcon ref={iconRef} model={model} phase={iconPhase} below={pos === 'below'} name={pos === 'left' ? null : (showName ? model.displayName : null)}
    statusLabel={showStatus ? statusInfo.label : null} statusDetail={statusInfo.detail} /> : null;

  async function rate(r) {
    const next = fb === r ? 0 : r;
    setFb(next);
    try { await api.post(`/api/messages/${msg.id}/feedback`, { rating: next }); } catch { setFb(fb); }
  }

  const inner = (
    <>
      {ledger && ledgerState && <LedgerRow tokens={ledgerTokens} pct={ledgerPct} state={ledgerState} id={msg.id} onToggleExclude={onToggleExclude} />}
      {msg.pinned && <div className="pin-tag"><Pin style={{ width: 12 }} /> {t("Pinned")}</div>}
      <ReasoningBlock text={msg.reasoning} live={streaming && phase === 'thinking'} durationMs={msg.reasoningMs || 0} preset={preset} collapsible={model?.reasoningCollapsible !== false} />
      {(msg.content || streaming) && (
        <div className={'assistant-body' + (streaming ? ' streaming' : '') + (streaming && typing ? ' typing' : '') + (streaming && phase === 'thinking' ? ' thinking' : '') + (textEntered ? ' text-enter' : '')}>
          {msg.content ? (
            <ReasonSegs.Provider value={segCtx}>
              <Markdown streaming={streaming}>{msg.content}</Markdown>
            </ReasonSegs.Provider>
          ) : null}
          {streaming && liveRows.length > 0 && (
            <div className="tool-live">
              {liveRows.map(r => <ToolCard key={r.index} call={r.call} result={null} />)}
            </div>
          )}
          {streaming && !msg.content && !liveRows.length && <p className="stream-wait" aria-hidden="true"></p>}
        </div>
      )}
      {streaming && msg.content && (
        <div className="actions stream-actions">
          <button className="action-btn" onClick={doCopy} title={t("Copy what's written so far")} aria-label={t("Copy what's written so far")}>{copied ? <Check /> : <Copy />}</button>
        </div>
      )}
      {!streaming && msg.content && (
        <div className="actions">
          <button className="action-btn" onClick={doCopy} title={t("Copy")} aria-label={copied ? t("Copied") : t("Copy")}>{copied ? <Check /> : <Copy />}</button>
          {chatId && !String(msg.id).startsWith('inc-') && (
            <button className={'action-btn' + (fb === 1 ? ' on' : '')} onClick={() => rate(1)} title={t("Good response")} aria-label={t("Good response")} aria-pressed={fb === 1}><ThumbUp /></button>
          )}
          {chatId && !String(msg.id).startsWith('inc-') && (
            <button className={'action-btn' + (fb === -1 ? ' on' : '')} onClick={() => rate(-1)} title={t("Bad response")} aria-label={t("Bad response")} aria-pressed={fb === -1}><ThumbDown /></button>
          )}
          <span className="retry-wrap">
            {onRegenerate && <button className="action-btn" title={t("Retry")} aria-label={t("Retry")} onClick={() => onRegenerate(msg.id)}><Retry /></button>}
            {onRegenerateWith && models && models.length > 1 && (
              <button ref={retryRef} className={'action-caret' + (retryMenu ? ' on' : '')} title={t("Retry with another model")} aria-label={t("Retry with another model")} aria-expanded={retryMenu} aria-haspopup="menu" onClick={() => setRetryMenu(o => !o)}>▾</button>
            )}
            {retryMenu && createPortal(
              <div ref={retryMenuRef} className="retry-menu portal" role="menu" aria-label={t("Retry with another model")} style={menuStyleOf(retryPos)}>
                <div className="retry-menu-label">{t("Retry with")}</div>
                {models.map(mm => (
                  <button key={mm.id} role="menuitem" className={mm.id === currentId ? 'on' : ''} onClick={() => { setRetryMenu(false); onRegenerateWith(msg.id, mm.id); }}>
                    {mm.staticIcon && <img src={mm.staticIcon} alt="" />}{mm.displayName}{mm.id === currentId && <Check style={{ width: 13, marginLeft: 'auto' }} />}
                  </button>
                ))}
              </div>, document.body)}
          </span>
          <BranchNav msg={msg} onSelectBranch={onSelectBranch} />
          {msg.branchCount > 1 && chatId && <button className="action-btn" onClick={() => setCompare(true)} title={t("Compare versions")} aria-label={t("Compare versions")}><Columns /></button>}
          <MoreMenu items={[
            onFork && { label: t('Branch'), icon: <Fork style={{ width: 15 }} />, run: () => onFork(msg.id) },
            onTogglePin && { label: msg.pinned ? t('Unpin') : t('Pin'), icon: <Pin style={{ width: 15 }} />, on: !!msg.pinned, run: () => onTogglePin(msg.id, !msg.pinned) },
            onDelete && chatId && !String(msg.id).startsWith('inc-') && { label: t('Delete'), icon: <Trash style={{ width: 15 }} />, danger: true, run: () => onDelete(msg.id) }
          ]} />
          {showSpeed && <SpeedChip speed={msg.speed} />}
          {model?.displayName && <span className="msg-model-badge">{model.displayName}</span>}
          {canContinue && onContinue && (
            <button className="action-btn continue-act" onClick={onContinue} title={t("Pick up where this reply stopped")}>
              <Retry style={{ width: 14 }} /> {t("Continue")}
            </button>
          )}
        </div>
      )}
      <SteerChips notes={steers} />
      {compare && chatId && <BranchCompare chatId={chatId} messageId={msg.id} onSelect={onSelectBranch} onClose={() => setCompare(false)} />}
    </>
  );

  if (pos === 'left') {
    const gutter = model?.iconSize > 0 ? model.iconSize : 40;
    return (
      <div role="article" aria-label={model?.displayName || t('Assistant message')} className={'msg assistant icon-left' + (streaming ? ' streaming-msg' : '') + (msg._enter ? ' enter' : '') + (!streaming && msg.content ? ' has-actions' : '') + (msg.pinned ? ' pinned' : '') + (ledger && ledgerState === 'excluded' ? ' ctx-out' : '')} data-mid={msg.id}>
        {icon && <div className="il-avatar" style={{ left: -(gutter + 14) }}>{icon}</div>}
        {showName && <div className="assistant-name">{model.displayName}</div>}
        {inner}
      </div>
    );
  }

  return (
    <div role="article" aria-label={model?.displayName || t('Assistant message')} className={'msg assistant' + (streaming ? ' streaming-msg' : '') + (msg._enter ? ' enter' : '') + (!streaming && msg.content ? ' has-actions' : '') + (msg.pinned ? ' pinned' : '') + (ledger && ledgerState === 'excluded' ? ' ctx-out' : '')} data-mid={msg.id}>
      {pos === 'above' && icon}
      {inner}
      {pos === 'below' && icon}
    </div>
  );
}

export default React.memo(Message);
