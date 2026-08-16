import { useRef, useEffect, useState, useLayoutEffect, useCallback } from 'react';
import ModelDropdown from './ModelDropdown.jsx';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { useAttachments } from '../lib/attachments.js';
import { useDictation } from '../lib/dictation.js';
import { Plus, Mic, Wave, Up, Stop, FileText, Cube, Check, Globe, Box, X, Chevron, TextIcon, Star, NewChatIcon, Sliders, Wand, Steer } from './icons.jsx';
import StyleSubmenu, { styleNameFor } from './StyleMenu.jsx';
import { extLabel } from '../lib/files.js';
import { t, fmtDate } from '../i18n.jsx';
import { focusUnlessTouch } from '../lib/touch.js';
import { useSubmenus } from '../lib/submenu.js';

// The picker no longer advertises a list. The server decides what it can read by
// sniffing the bytes, so any format is accepted here and one that turns out to be
// unreadable is reported to the model as such rather than silently dropped.
const FILE_ACCEPT = '';

function PmSub({ className = '', children, onMouseEnter, onMouseLeave }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ flipLeft: false, top: -6, maxH: 0, ready: false });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => {
      const wrap = el.parentElement; if (!wrap) return;
      const row = wrap.getBoundingClientRect();
      const pad = 8;
      const availH = window.innerHeight - pad * 2;
      const h = el.scrollHeight;
      const effH = Math.min(h, availH);
      const flipLeft = row.right + 4 + el.offsetWidth > window.innerWidth - pad;
      let top = -6;
      const over = row.top + top + effH - (window.innerHeight - pad);
      if (over > 0) top -= over;
      if (row.top + top < pad) top = pad - row.top;
      setPos(prev => (prev.ready && prev.flipLeft === flipLeft && prev.top === top && prev.maxH === (h > availH ? availH : 0)) ? prev : { flipLeft, top, maxH: h > availH ? availH : 0, ready: true });
    };
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [children]);
  return (
    <div ref={ref}
      className={'pm-sub' + (className ? ' ' + className : '') + (pos.flipLeft ? ' left' : '')}
      style={{ top: pos.top, maxHeight: pos.maxH || undefined, visibility: pos.ready ? undefined : 'hidden' }}
      onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {children}
    </div>
  );
}

export default function Composer({
  value, onChange, onSend, onStop, streaming, models,
  currentId, onSelect, extended, onToggleExtended, autoFocus, placeholder, modelUp, focusKey, visionSupported, canUseUnavailable, budget, sandbox, sandboxAllowed = true, onToggleSandbox, webSearch, webSearchAvailable, onToggleWebSearch, modelHasBg, bgInChat, onToggleBgInChat, project, onClearProject, projects = [], onSetProject, savedPrompts = [], onUsePrompt, onSavePrompt, onDeletePrompt, onNewChat, onShortcuts,
  voiceMic = false, voiceCall = false, sttEngine = 'browser', onStartCall,
  safetyFlagged = false, safetyChecking = false, safetyVerbose = false, safetyReason = '',
  styles = [], styleId = 'normal', onSelectStyle, onSaveStyles,
  conversationEnded = false, endedReason = '',
  removedModel = null, onOpenDocs = null,
  queueCount = 0, onQueue, canContinue = false, onContinue, onSteer, canSteer = false,
  compareIds = [], onSetCompare, hideModelPicker = false, reasoningEffort, onSetEffort, kwargValues, onSetKwarg,
  ctxGauge = null
}) {
  const ta = useRef(null);
  const fileInput = useRef(null);
  const plusRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const { dictating, transcribing, toggleDictation } = useDictation({ sttEngine, valueRef, onChange });
  const {
    files, dragActive, glow, upErr, setUpErr,
    pickFiles, onPaste, removeFile, clearFiles, dragProps
  } = useAttachments({ visionSupported });

  const [plusMenu, setPlusMenu] = useState(false);
  const [plusDown, setPlusDown] = useState(false);
  const sub = useSubmenus();
  const { closeAll: closeSubs } = sub;
  useEffect(() => { if (!plusMenu) closeSubs(); }, [plusMenu, closeSubs]);
  const [showReason, setShowReason] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);

  useLayoutEffect(() => {
    if (!plusMenu) return;
    const btn = plusRef.current && plusRef.current.querySelector('.plus');
    if (btn) {
      const r = btn.getBoundingClientRect();
      setPlusDown(window.innerHeight - r.bottom > 320);
    }
    const h = (e) => { if (plusRef.current && !plusRef.current.contains(e.target)) setPlusMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [plusMenu]);

  const grewOnce = useRef(false);
  const fitRaf = useRef(0);
  const fitWidth = useRef(0);
  const fit = useCallback((animate) => {
    const el = ta.current; if (!el) return;
    cancelAnimationFrame(fitRaf.current);
    const MAX = 280;
    if ((el.value ? el.value.length : 0) > 4000) {
      el.style.overflowY = 'auto';
      el.style.height = MAX + 'px';
      setMultiline(m => (m === true ? m : true));
      grewOnce.current = true;
      return;
    }
    const prev = el.offsetHeight;
    el.style.height = 'auto';
    const raw = el.scrollHeight;
    const measured = Math.min(raw, MAX);
    el.style.overflowY = raw > MAX ? 'auto' : 'hidden';
    setMultiline(m => { const ml = measured > 44; return m === ml ? m : ml; });
    if (!animate || !grewOnce.current || Math.abs(prev - measured) < 1) {
      el.style.height = measured + 'px';
      grewOnce.current = true;
      return;
    }
    el.style.height = prev + 'px';
    fitRaf.current = requestAnimationFrame(() => { if (ta.current) ta.current.style.height = measured + 'px'; });
  }, []);
  useEffect(() => { fit(true); }, [value, fit]);
  useEffect(() => {
    fit(false);
    const onResize = () => fit(false);
    window.addEventListener('resize', onResize);
    let ro;
    const host = ta.current ? (ta.current.parentElement || ta.current) : null;
    if (typeof ResizeObserver !== 'undefined' && host) {
      fitWidth.current = host.clientWidth;
      ro = new ResizeObserver(() => {
        const w = host.clientWidth;
        if (w !== fitWidth.current) { fitWidth.current = w; fit(false); }
      });
      ro.observe(host);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (ta.current) fit(false); });
    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
      cancelAnimationFrame(fitRaf.current);
    };
  }, [fit]);
  useEffect(() => { if (autoFocus || focusKey !== undefined) focusUnlessTouch(ta.current); }, [autoFocus, focusKey]);
  useEffect(() => {
    const h = () => fileInput.current?.click();
    window.addEventListener('oq-attach-files', h);
    return () => window.removeEventListener('oq-attach-files', h);
  }, []);

  const [steerMode, setSteerMode] = useState(true);
  const steering = canSteer && steerMode && !!onSteer;
  useEffect(() => { if (!canSteer) setSteerMode(true); }, [canSteer]);
  async function doSend() {
    if (uploading) return;
    if (blockSend || budgetBlock || safetyFlagged || safetyChecking || conversationEnded) return;
    if (steering) {
      const t = value.trim();
      if (!t) return;
      onSteer(t);
      onChange('');
      return;
    }
    if (streaming) {
      const t = value.trim();
      if (!t && files.length === 0) return;
      if (!onQueue) return;
      let attachments = [];
      if (files.length) {
        setUploading(true);
        try { const r = await api.uploadFiles(files.map(f => f.file)); attachments = r.files || []; }
        catch (e) { setUploading(false); setUpErr(e?.message || t('Upload failed, the file may be too large.')); return; }
        setUploading(false);
        clearFiles();
      }
      onQueue(t, attachments);
      onChange('');
      return;
    }
    if (!value.trim() && files.length === 0) return;
    let attachments = [];
    if (files.length) {
      setUploading(true);
      try { const r = await api.uploadFiles(files.map(f => f.file)); attachments = r.files || []; }
      catch (e) { setUploading(false); setUpErr(e?.message || t('Upload failed, the file may be too large.')); return; }
      setUploading(false);
    }
    clearFiles();
    onSend(attachments);
  }

  useEffect(() => { setShowReason(false); }, [currentId]);

  const slashActive = value.startsWith('/') && !value.includes('\n');
  const slashQuery = slashActive ? value.slice(1).toLowerCase().trim() : '';
  const slashCmds = [];
  if (slashActive) {
    if (onNewChat) slashCmds.push({ id: 'new', label: t('New chat'), icon: <NewChatIcon style={{ width: 16 }} />, run: () => { onChange(''); onNewChat(); } });
    if (sandboxAllowed && onToggleSandbox) slashCmds.push({ id: 'sandbox', label: (sandbox ? t('Disable') : t('Enable')) + ' sandbox tools', icon: <Cube style={{ width: 16 }} />, run: () => { onChange(''); onToggleSandbox(); } });
    if (webSearchAvailable && onToggleWebSearch) slashCmds.push({ id: 'web', label: (webSearch ? t('Disable') : t('Enable')) + ' web search', icon: <Globe style={{ width: 16 }} />, run: () => { onChange(''); onToggleWebSearch(); } });
    if (onShortcuts) slashCmds.push({ id: 'keys', label: t('Keyboard shortcuts'), icon: <Sliders style={{ width: 16 }} />, run: () => { onChange(''); onShortcuts(); } });
    for (const p of (savedPrompts || [])) slashCmds.push({ id: 'p' + p.id, label: p.title, sub: 'prompt', icon: <Star style={{ width: 16 }} />, run: () => { onUsePrompt && onUsePrompt(p.text); } });
  }
  const slashShown = slashCmds.filter(c => c.label.toLowerCase().includes(slashQuery));
  const slashOpen = slashActive && slashShown.length > 0;
  useEffect(() => { setSlashIdx(0); }, [slashQuery, slashOpen]);

  function key(e) {
    if (slashOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => Math.min(slashShown.length - 1, i + 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); slashShown[slashIdx]?.run(); return; }
      if (e.key === 'Escape') { e.preventDefault(); onChange(''); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  }
  const activeModel = models?.find(m => m.id === currentId) || null;
  const [improving, setImproving] = useState(false);
  const improvedRef = useRef(null);
  useEffect(() => {
    if (improvedRef.current && value !== improvedRef.current.improved) improvedRef.current = null;
  }, [value]);
  async function improvePrompt() {
    if (improving) return;
    if (improvedRef.current && value === improvedRef.current.improved) {
      const orig = improvedRef.current.original;
      improvedRef.current = null;
      onChange(orig);
      return;
    }
    const text = value.trim();
    if (!text) return;
    setImproving(true);
    try {
      const r = await api.post('/api/improve-prompt', { text, modelId: currentId });
      if (r.text) { improvedRef.current = { original: value, improved: r.text }; onChange(r.text); }
    } catch (e) { toast(e.message || t('Could not improve the prompt.')); }
    setImproving(false);
  }
  const improvedNow = !!(improvedRef.current && value === improvedRef.current.improved);
  const unavailable = !!activeModel?.unavailable;
  const blockSend = (unavailable && !canUseUnavailable) || !!removedModel;
  const sunsetInfo = (() => {
    const sAt = activeModel?.sunsetAt;
    if (!sAt || unavailable || removedModel) return null;
    const d = new Date(sAt + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (days < 0) return null;
    const t = Math.max(0, Math.min(1, 1 - days / 14));
    return {
      name: activeModel.displayName,
      date: fmtDate(d, { month: 'long', day: 'numeric', year: 'numeric' }),
      mix: Math.round(t * 62)
    };
  })();
  const [bannerMounted, setBannerMounted] = useState(unavailable);
  const [bannerOut, setBannerOut] = useState(false);
  const bannerInfo = useRef(null);
  if (unavailable && activeModel) bannerInfo.current = { name: activeModel.displayName, reason: (activeModel.unavailableReason || '').trim() };
  useEffect(() => {
    if (unavailable) { setBannerMounted(true); setBannerOut(false); return; }
    if (!bannerMounted) return;
    setBannerOut(true);
    const t = setTimeout(() => { setBannerMounted(false); setShowReason(false); }, 300);
    return () => clearTimeout(t);
  }, [unavailable]);
  const hasImage = files.some(f => f.preview);
  const budgetState = budget && budget.cap ? budget.state : 'none';
  const budgetBlock = budgetState === 'over' && budget?.enforce && !canUseUnavailable;
  const showBudgetBanner = budgetState === 'warn' || budgetState === 'over';
  const sunsetOnly = !!sunsetInfo && !bannerMounted && !showBudgetBanner && !safetyFlagged && !conversationEnded && !removedModel;
  const enabledCount = (sandbox ? 1 : 0) + (webSearch ? 1 : 0);
  const hasText = /\S/.test(value);
  const canSend = (hasText || files.length > 0) && !uploading && !blockSend && !budgetBlock && !safetyFlagged && !safetyChecking && !conversationEnded;
  const [multiline, setMultiline] = useState(false);
  const cls = 'composer' + (multiline ? ' ml' : '') + (dragActive ? ' dragging' : '') + (hasImage ? ' glowing' : '') + ((unavailable || removedModel) ? ' unavailable' : '') + ((blockSend || budgetBlock) ? ' blocked' : '');
  const fmtUsd = (n) => '$' + (Number(n || 0) > 0 && Number(n || 0) < 0.01 ? Number(n).toFixed(4) : Number(n || 0).toFixed(2));

  return (
    <div className={'composer-stack' + ((bannerMounted || showBudgetBanner || safetyFlagged || conversationEnded || removedModel || sunsetInfo) ? ' has-banner' : '')}>
    {(bannerMounted || showBudgetBanner || safetyFlagged || conversationEnded || removedModel || sunsetInfo) && (
      <div className={'unavail-bg' + (bannerOut && !showBudgetBanner && !safetyFlagged && !conversationEnded && !removedModel && !sunsetInfo ? ' out' : '')}
        style={sunsetOnly ? {
          background: `color-mix(in srgb, #e5484d ${sunsetInfo.mix}%, var(--bg))`,
          borderColor: `color-mix(in srgb, #e5484d ${Math.min(70, sunsetInfo.mix + 12)}%, var(--border-soft))`,
          transition: 'background .4s ease, border-color .4s ease'
        } : undefined} />
    )}
    {removedModel && (
      <div className="unavail-banner removed-banner">
        <div className="unavail-row">
          <span className="unavail-msg"><strong>{removedModel.name}</strong> {t('has been removed, try using a different model to continue this chat.')}</span>
        </div>
      </div>
    )}
    {sunsetInfo && (
      <div className={'unavail-banner sunset-banner' + (sunsetOnly ? '' : ' pill')} style={sunsetOnly ? undefined : { background: `color-mix(in srgb, #e5484d ${sunsetInfo.mix}%, transparent)` }}>
        <div className="unavail-row">
          <span className="unavail-msg sunset-msg">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3.5 10h17" /></svg>
            <span><strong>{sunsetInfo.name}</strong> {t('is going away {date}.', { date: sunsetInfo.date })}</span>
          </span>
        </div>
      </div>
    )}
    {conversationEnded && (
      <div className="unavail-banner ended-banner">
        <div className="unavail-row">
          <span className="unavail-msg"><strong>{t("The assistant ended this conversation.")}</strong> {endedReason ? endedReason : t('It can no longer be continued, edited, or branched.')}</span>
        </div>
      </div>
    )}
    {safetyFlagged && (
      <div className="unavail-banner safety-banner">
        <div className="unavail-row">
          <span className="unavail-msg"><strong>{t("Message flagged.")}</strong> {safetyReason && safetyReason.trim() ? safetyReason.trim() : t('This prompt was blocked by the safety check, please revise it and try again.')}</span>
        </div>
      </div>
    )}
    {showBudgetBanner && (
      <div className={'unavail-banner budget-banner ' + budgetState}>
        <div className="unavail-row">
          <span className="unavail-msg">
            {budgetState === 'over'
              ? <><strong>{t("Monthly budget reached.")}</strong> {fmtUsd(budget.spent)} of {fmtUsd(budget.cap)} used{budget.enforce && !canUseUnavailable ? '. New messages are paused until next month.' : '.'}</>
              : <><strong>{t("Approaching your monthly budget.")}</strong> {fmtUsd(budget.spent)} of {fmtUsd(budget.cap)} used.</>}
          </span>
        </div>
      </div>
    )}
    {bannerMounted && bannerInfo.current && (
      <div className={'unavail-banner' + (bannerOut ? ' out' : '') + (showReason ? ' open' : '')}>
        <div className="unavail-row">
          <span className="unavail-msg">{t("{name} is currently unavailable.", { name: bannerInfo.current.name })}</span>
          {bannerInfo.current.reason && (
            <button className="unavail-learn" onClick={() => setShowReason(s => !s)}>{showReason ? t('Hide') : t('Learn more')}</button>
          )}
        </div>
        {showReason && bannerInfo.current.reason && (
          <div className="unavail-reason">{bannerInfo.current.reason}</div>
        )}
      </div>
    )}
    <div className={cls} style={{ '--glow': glow }}
      {...dragProps}>
      {dragActive && <div className="drop-hint">Drop to attach{visionSupported ? '' : ' files'}</div>}
      {files.length > 0 && (
        <div className="attach-row">
          {files.map(f => (
            <div key={f.id} className={'attach-chip' + (f.preview ? ' image' : '')}>
              {f.preview
                ? <img src={f.preview} alt={f.name} />
                : (
                  <div className="attach-file" title={f.name}>
                    <div className="attach-name">{f.name}</div>
                    <div className="attach-foot">
                      <FileText style={{ width: 13 }} />
                      <span className="attach-type">{extLabel(f.name)}</span>
                    </div>
                  </div>
                )}
              <button className="attach-x" onClick={() => removeFile(f.id)} title={t("Remove")}>✕</button>
            </div>
          ))}
        </div>
      )}
      {upErr && <div className="attach-err">{upErr}</div>}
      {slashOpen && (
        <div className="slash-menu">
          <div className="slash-head">{t("Commands")}</div>
          {slashShown.map((c, i) => (
            <button key={c.id} className={'slash-item' + (i === slashIdx ? ' active' : '')} onMouseEnter={() => setSlashIdx(i)} onMouseDown={(e) => { e.preventDefault(); c.run(); }}>
              <span className="slash-ico">{c.icon}</span>
              <span className="slash-label">{c.label}</span>
              {c.sub && <span className="slash-sub">{c.sub}</span>}
            </button>
          ))}
        </div>
      )}
      {canSteer && (
        <div className="steer-row">
          <div className="steer-seg">
            <button className={steerMode ? 'on' : ''} onClick={() => setSteerMode(true)} title={t('Correct the reply that is being written right now')}>
              <Steer style={{ width: 13 }} /> {t('Steer')}
            </button>
            <button className={!steerMode ? 'on' : ''} onClick={() => setSteerMode(false)} title={t('Send after this reply finishes')}>
              {t('Queue')}{queueCount > 0 ? ` (${queueCount})` : ''}
            </button>
          </div>
          <span className="steer-note">{steerMode ? t('Applied to the reply in progress, without losing what is already written.') : t('Sent as a new message when this reply finishes.')}</span>
        </div>
      )}
      <textarea ref={ta} rows={1} value={value} placeholder={steering ? t('Steer this reply, e.g. "shorter" or "you misread the file"…') : streaming ? (queueCount > 0 ? t('Queue another message ({n} waiting)…', { n: queueCount }) : t('Type to queue a message…')) : (placeholder || t('How can I help you today?'))}
        id="oq-composer" aria-label={t('Message input')}
        onChange={(e) => onChange(e.target.value)} onKeyDown={key} onPaste={onPaste} />
      <input ref={fileInput} type="file" multiple hidden onChange={pickFiles}
        {...(FILE_ACCEPT ? { accept: (visionSupported ? 'image/*,' : '') + FILE_ACCEPT } : {})} />
      {safetyChecking && safetyVerbose && <div className="safety-checking">{t("Safety check…")}</div>}
      {improving && <div className="safety-checking">{t("Improving prompt…")}</div>}
      {canContinue && !streaming && !conversationEnded && (
        <div className="continue-row">
          <button className="continue-btn" onClick={() => onContinue?.()}>{t("Continue generating →")}</button>
        </div>
      )}
      {compareIds.length > 0 && (
        <div className="queued-chip compare-chip">
          <span className="queued-label">{t("Compare:")}</span>
          <span className="queued-text">{[models?.find(m => m.id === currentId)?.displayName || 'Current', ...compareIds.map(id => models?.find(m => m.id === id)?.displayName || 'model')].join(' vs ')}</span>
          <button className="queued-x" title={t("Cancel comparison")} onClick={() => onSetCompare?.([])}><X style={{ width: 12 }} /></button>
        </div>
      )}
      <div className="composer-bar">
        <div className="composer-left">
          <div className="plus-wrap" ref={plusRef}>
            <button className={'plus' + (plusMenu ? ' on' : '')} onClick={() => setPlusMenu(m => !m)} title={t("More")}>
              <Plus style={{ width: 20, height: 20 }} />
              {enabledCount > 0 && <span className="plus-badge">{enabledCount}</span>}
            </button>
            {plusMenu && (
              <div className={'plus-menu' + (plusDown ? ' down' : '')}>
                <button className="pm-item" onClick={() => { setPlusMenu(false); fileInput.current?.click(); }}>
                  <FileText />
                  <span className="pm-label">{visionSupported ? t('Add files or photos') : t('Add files')}</span>
                  <span className="pm-shortcut">{/mac/i.test(navigator.platform) ? '⌘U' : t('Ctrl+U')}</span>
                </button>
                {onSetProject && (
                  <div className="pm-subwrap" onMouseEnter={() => sub.hoverOpen('project')} onMouseLeave={sub.hoverClose}>
                    <button className={'pm-item' + (sub.isOpen('project') ? ' active' : '')} onClick={() => sub.toggle('project')}>
                      <Box />
                      <span className="pm-label">{t('Add to project')}</span>
                      <Chevron className="pm-chev" />
                    </button>
                    {sub.isOpen('project') && (
                      <PmSub onMouseEnter={() => sub.hoverOpen('project')} onMouseLeave={sub.hoverClose}>
                        {projects.length === 0 && <div className="pm-empty">{t('No projects yet')}</div>}
                        {projects.map(p => (
                          <button key={p.id} className={'pm-item' + (project && p.id === project.id ? ' active' : '')}
                            onClick={() => { onSetProject(p); sub.closeAll(); setPlusMenu(false); }}>
                            <Box />
                            <span className="pm-label">{p.name}</span>
                          </button>
                        ))}
                        {project && onClearProject && (
                          <button className="pm-item" onClick={() => { onClearProject(); sub.closeAll(); setPlusMenu(false); }}>
                            <span className="pm-label">{t('Remove from project')}</span>
                          </button>
                        )}
                      </PmSub>
                    )}
                  </div>
                )}
                <div className="pm-divider" />
                <div className="pm-subwrap" onMouseEnter={() => sub.hoverOpen('prompts')} onMouseLeave={sub.hoverClose}>
                  <button className={'pm-item' + (sub.isOpen('prompts') ? ' active' : '')} onClick={() => sub.toggle('prompts')}>
                    <TextIcon />
                    <span className="pm-label">{t("Saved prompts")}</span>
                    <Chevron className="pm-chev" />
                  </button>
                  {sub.isOpen('prompts') && (
                    <PmSub onMouseEnter={() => sub.hoverOpen('prompts')} onMouseLeave={sub.hoverClose}>
                      {(savedPrompts || []).length === 0 && <div className="pm-empty">{t("No saved prompts yet.")}</div>}
                      {(savedPrompts || []).map(p => (
                        <div key={p.id} className="pm-prompt">
                          <button className="pm-prompt-use" title={p.text} onClick={() => { setPlusMenu(false); onUsePrompt && onUsePrompt(p.text); }}>
                            <Star style={{ width: 13 }} /> <span className="pm-prompt-title">{p.title}</span>
                          </button>
                          {onDeletePrompt && <button className="pm-prompt-x" title={t("Delete")} onClick={(e) => { e.stopPropagation(); onDeletePrompt(p.id); }}><X style={{ width: 12 }} /></button>}
                        </div>
                      ))}
                      {onSavePrompt && hasText && (
                        <button className="pm-save-prompt" onClick={() => { onSavePrompt(); sub.closeAll(); }}>
                          <Plus style={{ width: 13 }} /> Save current text as prompt
                        </button>
                      )}
                    </PmSub>
                  )}
                </div>
                {onSelectStyle && (
                  <div className="pm-subwrap" onMouseEnter={() => sub.hoverOpen('styles')} onMouseLeave={sub.hoverClose}>
                    <button className={'pm-item' + (sub.isOpen('styles') ? ' active' : '')} onClick={() => sub.toggle('styles')}>
                      <Sliders />
                      <span className="pm-label">{t("Response style")}</span>
                      <span className="pm-note">{styleNameFor(styleId, styles)}</span>
                      <Chevron className="pm-chev" />
                    </button>
                    {sub.isOpen('styles') && (
                      <PmSub className="styles" onMouseEnter={() => sub.hoverOpen('styles')} onMouseLeave={sub.hoverClose}>
                        <StyleSubmenu styles={styles} styleId={styleId} currentId={currentId} onSaveStyles={onSaveStyles}
                          onSelect={(id) => { onSelectStyle && onSelectStyle(id); }} />
                      </PmSub>
                    )}
                  </div>
                )}
                <button className="pm-item" disabled={improving || (!hasText && !improvedNow)}
                  onClick={() => { setPlusMenu(false); improvePrompt(); }}>
                  <Wand />
                  <span className="pm-label">{improvedNow ? t('Restore original prompt') : t('Improve prompt')}</span>
                </button>
                {onSetCompare && models && models.length > 1 && (
                  <div className="pm-subwrap" onMouseEnter={() => sub.hoverOpen('compare')} onMouseLeave={sub.hoverClose}>
                    <button className={'pm-item' + (sub.isOpen('compare') ? ' active' : '')} onClick={() => sub.toggle('compare')}>
                      <Cube />
                      <span className="pm-label">{t("Compare models")}</span>
                      {compareIds.length > 0 && <span className="pm-note">+{compareIds.length}</span>}
                      <Chevron className="pm-chev" />
                    </button>
                    {sub.isOpen('compare') && (
                      <PmSub className="styles" onMouseEnter={() => sub.hoverOpen('compare')} onMouseLeave={sub.hoverClose}>
                        <div className="style-menu-label">{t("Also answer with")}</div>
                        {models.filter(m => m.id !== currentId).map(m => {
                          const on = compareIds.includes(m.id);
                          return (
                            <button key={m.id} className={'style-item' + (on ? ' active' : '')}
                              onClick={() => onSetCompare(on ? compareIds.filter(x => x !== m.id) : (compareIds.length < 2 ? [...compareIds, m.id] : compareIds))}>
                              <span className="style-item-name">{m.displayName || m.id}</span>
                              {on && <Check style={{ width: 14 }} />}
                            </button>
                          );
                        })}
                        <div className="style-menu-label" style={{ textTransform: 'none', letterSpacing: 0 }}>{t("Pick up to 2 extra models. Your next message will be answered by each as versions of one response.")}</div>
                      </PmSub>
                    )}
                  </div>
                )}
                {(sandboxAllowed || webSearchAvailable) && <div className="pm-divider" />}
                {sandboxAllowed && (
                  <button className="pm-item" onClick={() => onToggleSandbox && onToggleSandbox()}>
                    <Cube />
                    <span className="pm-label">{t("Sandbox tools")}</span>
                    {sandbox && <Check className="pm-check" />}
                  </button>
                )}
                {webSearchAvailable && (
                  <button className="pm-item" onClick={() => onToggleWebSearch && onToggleWebSearch()}>
                    <Globe />
                    <span className="pm-label">{t("Web search")}</span>
                    {webSearch && <Check className="pm-check" />}
                  </button>
                )}
              </div>
            )}
          </div>
          {project && (
            <div className="composer-project" title={t('In project: {name}', { name: project.name })}>
              <Box style={{ width: 14 }} />
              <span className="cp-name">{project.name}</span>
              {onClearProject && <button className="cp-x" onClick={onClearProject} title={t("Remove from project")}><X style={{ width: 12 }} /></button>}
            </div>
          )}
          {!hideModelPicker && onOpenDocs && (
            <button type="button" className="mdocs-btn" title={t('Model docs')} onClick={onOpenDocs}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5.6C10.6 4.4 8.7 3.8 6.5 3.8c-1 0-2 .13-2.9.4v14.6c.9-.27 1.9-.4 2.9-.4 2.2 0 4.1.6 5.5 1.8 1.4-1.2 3.3-1.8 5.5-1.8 1 0 2 .13 2.9.4V4.2c-.9-.27-1.9-.4-2.9-.4-2.2 0-4.1.6-5.5 1.8zM12 5.6v14.6" /></svg></button>
          )}
        </div>
        <div className="composer-right">
          {ctxGauge}
          {!hideModelPicker && <ModelDropdown models={models} currentId={currentId} onSelect={onSelect}
            extended={extended} onToggleExtended={onToggleExtended} up={modelUp} isAdmin={canUseUnavailable}
            reasoningEffort={reasoningEffort} onSetEffort={onSetEffort}
            kwargValues={kwargValues} onSetKwarg={onSetKwarg}
            modelHasBg={modelHasBg} bgInChat={bgInChat} onToggleBgInChat={onToggleBgInChat} />}
          {voiceMic && (
            <button className={'mic' + (dictating ? ' rec' : '') + (transcribing ? ' busy' : '')} onClick={toggleDictation}
              title={dictating ? t('Stop dictation') : transcribing ? t('Transcribing…') : t('Dictate')} disabled={transcribing}>
              <Mic style={{ width: 20, height: 20 }} />
            </button>
          )}
          {steering && hasText && (
            <button key="steer" className="send steer" onClick={doSend} title={t('Steer this reply')}><Steer style={{ width: 20, height: 20 }} /></button>
          )}
          {streaming ? (
            <button key="stop" className="send stop" onClick={onStop} title={t('Stop generating')}><Stop style={{ width: 20, height: 20 }} /></button>
          ) : safetyChecking ? (
            <button key="send" className={'send' + (safetyVerbose ? ' checking' : ' quiet')} disabled title={safetyVerbose ? t('Safety check…') : undefined}><Up style={{ width: 20, height: 20 }} /></button>
          ) : canSend ? (
            <button key="send" className="send" onClick={doSend} disabled={uploading}><Up style={{ width: 20, height: 20 }} /></button>
          ) : voiceCall ? (
            <button key="call" className="mic call" onClick={onStartCall} title={t("Start a voice call")}><Wave style={{ width: 20, height: 20 }} /></button>
          ) : (
            <button key="send" className="send ghost" disabled><Up style={{ width: 20, height: 20 }} /></button>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
