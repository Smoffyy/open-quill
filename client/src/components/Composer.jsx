import React, { useRef, useEffect, useState, useLayoutEffect } from 'react';
import ModelDropdown from './ModelDropdown.jsx';
import FunctionsBar from './FunctionsBar.jsx';
import { api } from '../api.js';
import { transcribeBlob } from '../voice.js';
import { toast } from '../toast.js';
import { Plus, Mic, Wave, Up, Stop, FileText, Cube, Check, Globe, Box, X, Chevron, TextIcon, Star, NewChatIcon, Sliders, Wand } from './icons.jsx';
import StyleSubmenu, { styleNameFor } from './StyleMenu.jsx';

const FILE_ACCEPT = '.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.lua,.html,.css,.xml,.yml,.yaml,.pdf,.log';

// grab the most common solid color from an image
function dominantColor(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const s = 24; const c = document.createElement('canvas'); c.width = s; c.height = s;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, s, s);
        const data = ctx.getImageData(0, 0, s, s).data;
        const counts = {}; let best = null, bestN = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const key = (data[i] >> 4) + ',' + (data[i + 1] >> 4) + ',' + (data[i + 2] >> 4);
          counts[key] = (counts[key] || 0) + 1;
          if (counts[key] > bestN) { bestN = counts[key]; best = [data[i], data[i + 1], data[i + 2]]; }
        }
        resolve(best ? `rgb(${best[0]},${best[1]},${best[2]})` : null);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function PmSub({ className = '', children, onMouseEnter, onMouseLeave }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ flipLeft: false, top: -6, maxH: 0, ready: false });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const wrap = el.parentElement; if (!wrap) return;
    const measure = () => {
      const row = wrap.getBoundingClientRect();
      const pad = 8;
      const availH = window.innerHeight - pad * 2;
      const h = el.offsetHeight;
      const effH = Math.min(h, availH);
      const flipLeft = row.right + 4 + el.offsetWidth > window.innerWidth - pad;
      let top = -6;
      const over = row.top + top + effH - (window.innerHeight - pad);
      if (over > 0) top -= over;
      if (row.top + top < pad) top = pad - row.top;
      setPos({ flipLeft, top, maxH: h > availH ? availH : 0, ready: true });
    };
    measure();
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
  currentId, onSelect, extended, onToggleExtended, autoFocus, placeholder, modelUp, focusKey, visionSupported, canUseUnavailable, budget, sandbox, sandboxAllowed = true, onToggleSandbox, onWantSandbox, webSearch, webSearchAvailable, onToggleWebSearch, modelHasBg, bgInChat, onToggleBgInChat, project, onClearProject, savedPrompts = [], onUsePrompt, onSavePrompt, onDeletePrompt, onNewChat, onShortcuts, functions = [],
  voiceMic = false, voiceCall = false, sttEngine = 'browser', onStartCall,
  safetyFlagged = false, safetyChecking = false, safetyVerbose = false, safetyReason = '',
  styles = [], styleId = 'normal', onSelectStyle, onSaveStyles,
  conversationEnded = false, endedReason = '',
  queuedMsg = '', onQueue, onCancelQueue, canContinue = false, onContinue,
  compareIds = [], onSetCompare, hideModelPicker = false
}) {
  const ta = useRef(null);
  const fileInput = useRef(null);
  const dragDepth = useRef(0);
  const plusRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dictating, setDictating] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const dictRef = useRef(null);
  const dictMediaRef = useRef(null);
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => () => { stopDictation(true); }, []);
  function appendText(text) {
    const cur = valueRef.current || '';
    onChange((cur ? cur.replace(/\s+$/, '') + ' ' : '') + text.trim());
  }
  function stopDictation(silent) {
    if (dictRef.current) { try { dictRef.current.stop(); } catch {} dictRef.current = null; }
    if (dictMediaRef.current && dictMediaRef.current.state !== 'inactive') { try { dictMediaRef.current.stop(); } catch {} }
    if (!silent) setDictating(false);
  }
  async function toggleDictation() {
    if (dictating) { stopDictation(); return; }
    if (sttEngine === 'browser') {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { toastLocal('This browser has no built-in speech recognition.'); return; }
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
      let base = valueRef.current || '';
      rec.onresult = (e) => {
        let fin = '', interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) fin += t; else interim += t;
        }
        if (fin) base = (base ? base.replace(/\s+$/, '') + ' ' : '') + fin.trim();
        onChange(base + (interim ? (base ? ' ' : '') + interim : ''));
      };
      rec.onend = () => { setDictating(false); dictRef.current = null; };
      rec.onerror = () => { setDictating(false); dictRef.current = null; };
      dictRef.current = rec;
      try { rec.start(); setDictating(true); } catch {}
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        dictMediaRef.current = null;
        setDictating(false);
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (blob.size < 1500) return;
        setTranscribing(true);
        try { const text = await transcribeBlob(blob); if (text) appendText(text); }
        catch (e) { toastLocal(e.message || 'Transcription failed.'); }
        setTranscribing(false);
      };
      dictMediaRef.current = mr;
      mr.start();
      setDictating(true);
    } catch { toastLocal('Microphone access denied.'); }
  }
  function toastLocal(msg) { try { toast(msg, { icon: 'info', kind: 'warn', duration: 4200 }); } catch {} }
  const [dragActive, setDragActive] = useState(false);
  const [glow, setGlow] = useState('var(--accent)');
  const [plusMenu, setPlusMenu] = useState(false);
  const [plusDown, setPlusDown] = useState(false);
  const [promptsOpen, setPromptsOpen] = useState(false);
  const promptsTimer = useRef(null);
  const openPrompts = () => { clearTimeout(promptsTimer.current); setPromptsOpen(true); setStylesOpen(false); };
  const closePrompts = (now) => {
    clearTimeout(promptsTimer.current);
    if (now === true) { setPromptsOpen(false); return; }
    promptsTimer.current = setTimeout(() => setPromptsOpen(false), 160);
  };
  const [stylesOpen, setStylesOpen] = useState(false);
  const stylesTimer = useRef(null);
  const openStyles = () => { clearTimeout(stylesTimer.current); setStylesOpen(true); setPromptsOpen(false); };
  const closeStyles = (now) => {
    clearTimeout(stylesTimer.current);
    if (now === true) { setStylesOpen(false); return; }
    stylesTimer.current = setTimeout(() => setStylesOpen(false), 160);
  };
  useEffect(() => () => clearTimeout(stylesTimer.current), []);
  useEffect(() => { if (!plusMenu) setStylesOpen(false); }, [plusMenu]);
  const [compareOpen, setCompareOpen] = useState(false);
  const compareTimer = useRef(null);
  const openCompare = () => { clearTimeout(compareTimer.current); setCompareOpen(true); setPromptsOpen(false); setStylesOpen(false); };
  const closeCompare = (now) => {
    clearTimeout(compareTimer.current);
    if (now === true) { setCompareOpen(false); return; }
    compareTimer.current = setTimeout(() => setCompareOpen(false), 160);
  };
  useEffect(() => () => clearTimeout(compareTimer.current), []);
  useEffect(() => { if (!plusMenu) setCompareOpen(false); }, [plusMenu]);
  useEffect(() => () => clearTimeout(promptsTimer.current), []);
  const [showReason, setShowReason] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);

  useEffect(() => {
    if (!plusMenu) { setPromptsOpen(false); return; }
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
  useEffect(() => {
    const el = ta.current; if (!el) return;
    const prev = el.style.height;
    el.style.height = 'auto';
    const measured = Math.min(el.scrollHeight, 280);
    const next = measured + 'px';
    setMultiline(m => { const ml = measured > 44; return m === ml ? m : ml; });
    if (!grewOnce.current) { el.style.height = next; grewOnce.current = true; return; } // no animation on first paint
    el.style.height = prev || next;
    requestAnimationFrame(() => { if (ta.current) ta.current.style.height = next; });
  }, [value]);
  useEffect(() => { if (autoFocus || focusKey !== undefined) ta.current?.focus(); }, [autoFocus, focusKey]);
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach(f => f.preview && URL.revokeObjectURL(f.preview)), []);

  const [upErr, setUpErr] = useState('');
  function addFiles(list) {
    let picked = Array.from(list || []);
    if (!visionSupported) picked = picked.filter(f => !f.type.startsWith('image/'));
    if (!picked.length) return;
    setUpErr('');
    const mapped = picked.map(file => ({
      id: Math.random().toString(36).slice(2), file, name: file.name, type: file.type, size: file.size,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    }));
    setFiles(fs => [...fs, ...mapped]);
    if (sandboxAllowed && !sandbox && mapped.some(f => !f.preview)) onWantSandbox?.();
    const lastImg = [...mapped].reverse().find(f => f.preview);
    if (lastImg) dominantColor(lastImg.preview).then(c => c && setGlow(c));
  }
  function pickFiles(e) { addFiles(e.target.files); e.target.value = ''; }
  // ctrl+v / cmd+v an image (or any file) straight into the box
  function onPaste(e) {
    const dt = e.clipboardData; if (!dt) return;
    const found = [];
    if (dt.files && dt.files.length) found.push(...Array.from(dt.files));
    else if (dt.items) for (const it of dt.items) if (it.kind === 'file') { const f = it.getAsFile(); if (f) found.push(f); }
    if (found.length) { e.preventDefault(); addFiles(found); }
  }
  function removeFile(id) {
    setFiles(fs => { const t = fs.find(f => f.id === id); if (t?.preview) URL.revokeObjectURL(t.preview); return fs.filter(f => f.id !== id); });
  }

  function onDragEnter(e) { e.preventDefault(); dragDepth.current++; setDragActive(true); }
  function onDragOver(e) { e.preventDefault(); }
  function onDragLeave(e) { e.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) { dragDepth.current = 0; setDragActive(false); } }
  function onDrop(e) { e.preventDefault(); dragDepth.current = 0; setDragActive(false); addFiles(e.dataTransfer.files); }

  async function doSend() {
    if (uploading) return;
    if (blockSend || budgetBlock || safetyFlagged || safetyChecking || conversationEnded) return;
    if (streaming) {
      const t = value.trim();
      if (t && onQueue && !queuedMsg) { onQueue(t); onChange(''); }
      return;
    }
    if (!value.trim() && files.length === 0) return;
    let attachments = [];
    if (files.length) {
      setUploading(true);
      try { const r = await api.uploadFiles(files.map(f => f.file)); attachments = r.files || []; }
      catch (e) { setUploading(false); setUpErr(e?.message || 'Upload failed — the file may be too large.'); return; }
      setUploading(false);
    }
    files.forEach(f => f.preview && URL.revokeObjectURL(f.preview));
    setFiles([]); setGlow('var(--accent)');
    onSend(attachments);
  }

  useEffect(() => { setShowReason(false); }, [currentId]);

  const slashActive = value.startsWith('/') && !value.includes('\n');
  const slashQuery = slashActive ? value.slice(1).toLowerCase().trim() : '';
  const slashCmds = [];
  if (slashActive) {
    if (onNewChat) slashCmds.push({ id: 'new', label: 'New chat', icon: <NewChatIcon style={{ width: 16 }} />, run: () => { onChange(''); onNewChat(); } });
    if (sandboxAllowed && onToggleSandbox) slashCmds.push({ id: 'sandbox', label: (sandbox ? 'Disable' : 'Enable') + ' sandbox tools', icon: <Cube style={{ width: 16 }} />, run: () => { onChange(''); onToggleSandbox(); } });
    if (webSearchAvailable && onToggleWebSearch) slashCmds.push({ id: 'web', label: (webSearch ? 'Disable' : 'Enable') + ' web search', icon: <Globe style={{ width: 16 }} />, run: () => { onChange(''); onToggleWebSearch(); } });
    if (onShortcuts) slashCmds.push({ id: 'keys', label: 'Keyboard shortcuts', icon: <Sliders style={{ width: 16 }} />, run: () => { onChange(''); onShortcuts(); } });
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
    } catch (e) { toast(e.message || 'Could not improve the prompt.'); }
    setImproving(false);
  }
  const improvedNow = !!(improvedRef.current && value === improvedRef.current.improved);
  const unavailable = !!activeModel?.unavailable;
  const blockSend = unavailable && !canUseUnavailable;
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
  const enabledCount = (sandbox ? 1 : 0) + (webSearch ? 1 : 0);
  const canSend = (value.trim().length > 0 || files.length > 0) && !uploading && !blockSend && !budgetBlock && !safetyFlagged && !safetyChecking && !conversationEnded;
  const [multiline, setMultiline] = useState(false);
  const cls = 'composer' + (multiline ? ' ml' : '') + (dragActive ? ' dragging' : '') + (hasImage ? ' glowing' : '') + (unavailable ? ' unavailable' : '') + ((blockSend || budgetBlock) ? ' blocked' : '');
  const fmtUsd = (n) => '$' + (Number(n || 0) > 0 && Number(n || 0) < 0.01 ? Number(n).toFixed(4) : Number(n || 0).toFixed(2));

  return (
    <div className={'composer-stack' + ((bannerMounted || showBudgetBanner || safetyFlagged || conversationEnded) ? ' has-banner' : '')}>
    {(bannerMounted || showBudgetBanner || safetyFlagged || conversationEnded) && <div className={'unavail-bg' + (bannerOut && !showBudgetBanner && !safetyFlagged && !conversationEnded ? ' out' : '')} />}
    {conversationEnded && (
      <div className="unavail-banner ended-banner">
        <div className="unavail-row">
          <span className="unavail-msg"><strong>The assistant ended this conversation.</strong> {endedReason ? endedReason : 'It can no longer be continued, edited, or branched.'}</span>
        </div>
      </div>
    )}
    {safetyFlagged && (
      <div className="unavail-banner safety-banner">
        <div className="unavail-row">
          <span className="unavail-msg"><strong>Message flagged.</strong> {safetyReason && safetyReason.trim() ? safetyReason.trim() : 'This prompt was blocked by the safety check — please revise it and try again.'}</span>
        </div>
      </div>
    )}
    {showBudgetBanner && (
      <div className={'unavail-banner budget-banner ' + budgetState}>
        <div className="unavail-row">
          <span className="unavail-msg">
            {budgetState === 'over'
              ? <><strong>Monthly budget reached.</strong> {fmtUsd(budget.spent)} of {fmtUsd(budget.cap)} used{budget.enforce && !canUseUnavailable ? '. New messages are paused until next month.' : '.'}</>
              : <><strong>Approaching your monthly budget.</strong> {fmtUsd(budget.spent)} of {fmtUsd(budget.cap)} used.</>}
          </span>
        </div>
      </div>
    )}
    {bannerMounted && bannerInfo.current && (
      <div className={'unavail-banner' + (bannerOut ? ' out' : '') + (showReason ? ' open' : '')}>
        <div className="unavail-row">
          <span className="unavail-msg"><strong>{bannerInfo.current.name}</strong> is currently unavailable.</span>
          {bannerInfo.current.reason && (
            <button className="unavail-learn" onClick={() => setShowReason(s => !s)}>{showReason ? 'Hide' : 'Learn more'}</button>
          )}
        </div>
        {showReason && bannerInfo.current.reason && (
          <div className="unavail-reason">{bannerInfo.current.reason}</div>
        )}
      </div>
    )}
    <div className={cls} style={{ '--glow': glow }}
      onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragActive && <div className="drop-hint">Drop to attach{visionSupported ? '' : ' files'}</div>}
      {files.length > 0 && (
        <div className="attach-row">
          {files.map(f => (
            <div key={f.id} className={'attach-chip' + (f.preview ? ' image' : '')}>
              {f.preview
                ? <img src={f.preview} alt={f.name} />
                : <div className="attach-file"><FileText style={{ width: 18 }} /><div className="attach-meta"><div className="attach-name">{f.name}</div><div className="attach-type">{(f.name.split('.').pop() || 'file').toUpperCase()}</div></div></div>}
              <button className="attach-x" onClick={() => removeFile(f.id)} title="Remove">✕</button>
            </div>
          ))}
        </div>
      )}
      {upErr && <div className="attach-err">{upErr}</div>}
      <FunctionsBar functions={functions} input={value} onChange={onChange} onSend={onSend} model={models?.find(m => m.id === currentId)} />
      {slashOpen && (
        <div className="slash-menu">
          <div className="slash-head">Commands</div>
          {slashShown.map((c, i) => (
            <button key={c.id} className={'slash-item' + (i === slashIdx ? ' active' : '')} onMouseEnter={() => setSlashIdx(i)} onMouseDown={(e) => { e.preventDefault(); c.run(); }}>
              <span className="slash-ico">{c.icon}</span>
              <span className="slash-label">{c.label}</span>
              {c.sub && <span className="slash-sub">{c.sub}</span>}
            </button>
          ))}
        </div>
      )}
      <textarea ref={ta} rows={1} value={value} placeholder={placeholder || 'How can I help you today?'}
        onChange={(e) => onChange(e.target.value)} onKeyDown={key} onPaste={onPaste} />
      <input ref={fileInput} type="file" multiple hidden onChange={pickFiles}
        accept={(visionSupported ? 'image/*,' : '') + FILE_ACCEPT} />
      {safetyChecking && safetyVerbose && <div className="safety-checking">Safety check…</div>}
      {improving && <div className="safety-checking">Improving prompt…</div>}
      {queuedMsg && (
        <div className="queued-chip">
          <span className="queued-label">Queued:</span>
          <span className="queued-text">{queuedMsg.length > 90 ? queuedMsg.slice(0, 90) + '…' : queuedMsg}</span>
          <button className="queued-x" title="Cancel queued message" onClick={() => onCancelQueue?.()}><X style={{ width: 12 }} /></button>
        </div>
      )}
      {canContinue && !streaming && !conversationEnded && (
        <div className="continue-row">
          <button className="continue-btn" onClick={() => onContinue?.()}>Continue generating →</button>
        </div>
      )}
      {compareIds.length > 0 && (
        <div className="queued-chip compare-chip">
          <span className="queued-label">Compare:</span>
          <span className="queued-text">{[models?.find(m => m.id === currentId)?.displayName || 'Current', ...compareIds.map(id => models?.find(m => m.id === id)?.displayName || 'model')].join(' vs ')}</span>
          <button className="queued-x" title="Cancel comparison" onClick={() => onSetCompare?.([])}><X style={{ width: 12 }} /></button>
        </div>
      )}
      <div className="composer-bar">
        <div className="composer-left">
          <div className="plus-wrap" ref={plusRef}>
            <button className="plus" onClick={() => setPlusMenu(m => !m)} title="More">
              <Plus style={{ width: 17, height: 17 }} />
              {enabledCount > 0 && <span className="plus-badge">{enabledCount}</span>}
            </button>
            {plusMenu && (
              <div className={'plus-menu' + (plusDown ? ' down' : '')}>
                <button className="pm-item" onClick={() => { setPlusMenu(false); fileInput.current?.click(); }}>
                  <FileText />
                  <span className="pm-label">{visionSupported ? 'Add files or photos' : 'Add files'}</span>
                  <span className="pm-shortcut">{/mac/i.test(navigator.platform) ? '⌘U' : 'Ctrl+U'}</span>
                </button>
                <div className="pm-divider" />
                <div className="pm-subwrap" onMouseEnter={openPrompts} onMouseLeave={closePrompts}>
                  <button className={'pm-item' + (promptsOpen ? ' active' : '')} onClick={() => (promptsOpen ? closePrompts(true) : openPrompts())}>
                    <TextIcon />
                    <span className="pm-label">Saved prompts</span>
                    <Chevron className="pm-chev" />
                  </button>
                  {promptsOpen && (
                    <PmSub onMouseEnter={openPrompts} onMouseLeave={closePrompts}>
                      {(savedPrompts || []).length === 0 && <div className="pm-empty">No saved prompts yet.</div>}
                      {(savedPrompts || []).map(p => (
                        <div key={p.id} className="pm-prompt">
                          <button className="pm-prompt-use" title={p.text} onClick={() => { setPlusMenu(false); onUsePrompt && onUsePrompt(p.text); }}>
                            <Star style={{ width: 13 }} /> <span className="pm-prompt-title">{p.title}</span>
                          </button>
                          {onDeletePrompt && <button className="pm-prompt-x" title="Delete" onClick={(e) => { e.stopPropagation(); onDeletePrompt(p.id); }}><X style={{ width: 12 }} /></button>}
                        </div>
                      ))}
                      {onSavePrompt && value.trim() && (
                        <button className="pm-save-prompt" onClick={() => { onSavePrompt(); setPromptsOpen(false); }}>
                          <Plus style={{ width: 13 }} /> Save current text as prompt
                        </button>
                      )}
                    </PmSub>
                  )}
                </div>
                {onSelectStyle && (
                  <div className="pm-subwrap" onMouseEnter={openStyles} onMouseLeave={closeStyles}>
                    <button className={'pm-item' + (stylesOpen ? ' active' : '')} onClick={() => (stylesOpen ? closeStyles(true) : openStyles())}>
                      <Sliders />
                      <span className="pm-label">Response style</span>
                      <span className="pm-note">{styleNameFor(styleId, styles)}</span>
                      <Chevron className="pm-chev" />
                    </button>
                    {stylesOpen && (
                      <PmSub className="styles" onMouseEnter={openStyles} onMouseLeave={closeStyles}>
                        <StyleSubmenu styles={styles} styleId={styleId} currentId={currentId} onSaveStyles={onSaveStyles}
                          onSelect={(id) => { onSelectStyle && onSelectStyle(id); }} />
                      </PmSub>
                    )}
                  </div>
                )}
                <button className="pm-item" disabled={improving || (!value.trim() && !improvedNow)}
                  onClick={() => { setPlusMenu(false); improvePrompt(); }}>
                  <Wand />
                  <span className="pm-label">{improvedNow ? 'Restore original prompt' : 'Improve prompt'}</span>
                </button>
                {onSetCompare && models && models.length > 1 && (
                  <div className="pm-subwrap" onMouseEnter={openCompare} onMouseLeave={closeCompare}>
                    <button className={'pm-item' + (compareOpen ? ' active' : '')} onClick={() => (compareOpen ? closeCompare(true) : openCompare())}>
                      <Cube />
                      <span className="pm-label">Compare models</span>
                      {compareIds.length > 0 && <span className="pm-note">+{compareIds.length}</span>}
                      <Chevron className="pm-chev" />
                    </button>
                    {compareOpen && (
                      <PmSub className="styles" onMouseEnter={openCompare} onMouseLeave={closeCompare}>
                        <div className="style-menu-label">Also answer with</div>
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
                        <div className="style-menu-label" style={{ textTransform: 'none', letterSpacing: 0 }}>Pick up to 2 extra models. Your next message will be answered by each as versions of one response.</div>
                      </PmSub>
                    )}
                  </div>
                )}
                {(sandboxAllowed || webSearchAvailable) && <div className="pm-divider" />}
                {sandboxAllowed && (
                  <button className="pm-item" onClick={() => onToggleSandbox && onToggleSandbox()}>
                    <Cube />
                    <span className="pm-label">Sandbox tools</span>
                    {sandbox && <Check className="pm-check" />}
                  </button>
                )}
                {webSearchAvailable && (
                  <button className="pm-item" onClick={() => onToggleWebSearch && onToggleWebSearch()}>
                    <Globe />
                    <span className="pm-label">Web search</span>
                    {webSearch && <Check className="pm-check" />}
                  </button>
                )}
              </div>
            )}
          </div>
          {project && (
            <div className="composer-project" title={'In project: ' + project.name}>
              <Box style={{ width: 14 }} />
              <span className="cp-name">{project.name}</span>
              {onClearProject && <button className="cp-x" onClick={onClearProject} title="Remove from project"><X style={{ width: 12 }} /></button>}
            </div>
          )}
        </div>
        <div className="composer-right">
          {!hideModelPicker && <ModelDropdown models={models} currentId={currentId} onSelect={onSelect}
            extended={extended} onToggleExtended={onToggleExtended} up={modelUp}
            modelHasBg={modelHasBg} bgInChat={bgInChat} onToggleBgInChat={onToggleBgInChat} />}
          {voiceMic && (
            <button className={'mic' + (dictating ? ' rec' : '') + (transcribing ? ' busy' : '')} onClick={toggleDictation}
              title={dictating ? 'Stop dictation' : transcribing ? 'Transcribing…' : 'Dictate'} disabled={transcribing}>
              <Mic style={{ width: 18, height: 18 }} />
            </button>
          )}
          {streaming ? (
            <button key="stop" className="send stop" onClick={onStop}><Stop style={{ width: 16, height: 16 }} /></button>
          ) : safetyChecking ? (
            <button key="send" className={'send' + (safetyVerbose ? ' checking' : ' quiet')} disabled title={safetyVerbose ? 'Safety check…' : undefined}><Up style={{ width: 17, height: 17 }} /></button>
          ) : canSend ? (
            <button key="send" className="send" onClick={doSend} disabled={uploading}><Up style={{ width: 17, height: 17 }} /></button>
          ) : voiceCall ? (
            <button key="call" className="mic call" onClick={onStartCall} title="Start a voice call"><Wave style={{ width: 20, height: 20 }} /></button>
          ) : (
            <button key="send" className="send ghost" disabled><Up style={{ width: 17, height: 17 }} /></button>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
