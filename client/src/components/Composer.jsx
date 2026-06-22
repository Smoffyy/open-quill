import React, { useRef, useEffect, useState } from 'react';
import ModelDropdown from './ModelDropdown.jsx';
import { api } from '../api.js';
import { Plus, Mic, Wave, Up, Stop, FileText, Cube, Check, Globe } from './icons.jsx';

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

export default function Composer({
  value, onChange, onSend, onStop, streaming, models,
  currentId, onSelect, extended, onToggleExtended, autoFocus, placeholder, modelUp, focusKey, visionSupported, canUseUnavailable, budget, sandbox, sandboxAllowed = true, onToggleSandbox, onWantSandbox, webSearch, webSearchAvailable, onToggleWebSearch, modelHasBg, bgInChat, onToggleBgInChat
}) {
  const ta = useRef(null);
  const fileInput = useRef(null);
  const dragDepth = useRef(0);
  const plusRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [glow, setGlow] = useState('var(--accent)');
  const [plusMenu, setPlusMenu] = useState(false);
  const [showReason, setShowReason] = useState(false);

  useEffect(() => {
    if (!plusMenu) return;
    const h = (e) => { if (plusRef.current && !plusRef.current.contains(e.target)) setPlusMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [plusMenu]);

  const grewOnce = useRef(false);
  useEffect(() => {
    const el = ta.current; if (!el) return;
    const prev = el.style.height;
    el.style.height = 'auto';
    const next = Math.min(el.scrollHeight, 280) + 'px';
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
    if (streaming || uploading) return;
    if (blockSend || budgetBlock) return;
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

  function key(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } }
  const activeModel = models?.find(m => m.id === currentId) || null;
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
  const canSend = (value.trim().length > 0 || files.length > 0) && !uploading && !blockSend && !budgetBlock;
  const cls = 'composer' + (dragActive ? ' dragging' : '') + (hasImage ? ' glowing' : '') + (unavailable ? ' unavailable' : '') + ((blockSend || budgetBlock) ? ' blocked' : '');
  const fmtUsd = (n) => '$' + (Number(n || 0) > 0 && Number(n || 0) < 0.01 ? Number(n).toFixed(4) : Number(n || 0).toFixed(2));

  return (
    <div className={'composer-stack' + ((bannerMounted || showBudgetBanner) ? ' has-banner' : '')}>
    {(bannerMounted || showBudgetBanner) && <div className={'unavail-bg' + (bannerOut && !showBudgetBanner ? ' out' : '')} />}
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
      <textarea ref={ta} rows={1} value={value} placeholder={placeholder || 'How can I help you today?'}
        onChange={(e) => onChange(e.target.value)} onKeyDown={key} onPaste={onPaste} />
      <input ref={fileInput} type="file" multiple hidden onChange={pickFiles}
        accept={(visionSupported ? 'image/*,' : '') + FILE_ACCEPT} />
      <div className="composer-bar">
        <div className="composer-left">
          <div className="plus-wrap" ref={plusRef}>
            <button className="plus" onClick={() => setPlusMenu(m => !m)} title="More">
              <Plus style={{ width: 17, height: 17 }} />
              {enabledCount > 0 && <span className="plus-badge">{enabledCount}</span>}
            </button>
            {plusMenu && (
              <div className="plus-menu">
                <button onClick={() => { setPlusMenu(false); fileInput.current?.click(); }}>
                  <FileText style={{ width: 16 }} /> {visionSupported ? 'Upload images or files' : 'Upload files'}
                </button>
                {sandboxAllowed && (
                  <button onClick={() => onToggleSandbox && onToggleSandbox()}>
                    <Cube style={{ width: 16 }} /> Enable Sandbox Tools
                    <span className={'mini-switch' + (sandbox ? ' on' : '')}>{sandbox && <Check style={{ width: 12 }} />}</span>
                  </button>
                )}
                {webSearchAvailable && (
                  <button onClick={() => onToggleWebSearch && onToggleWebSearch()}>
                    <Globe style={{ width: 16 }} /> Web Search
                    <span className={'mini-switch' + (webSearch ? ' on' : '')}>{webSearch && <Check style={{ width: 12 }} />}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="composer-right">
          <ModelDropdown models={models} currentId={currentId} onSelect={onSelect}
            extended={extended} onToggleExtended={onToggleExtended} up={modelUp}
            modelHasBg={modelHasBg} bgInChat={bgInChat} onToggleBgInChat={onToggleBgInChat} />
          <button className="mic"><Mic style={{ width: 18, height: 18 }} /></button>
          {streaming ? (
            <button key="stop" className="send stop" onClick={onStop}><Stop style={{ width: 16, height: 16 }} /></button>
          ) : canSend ? (
            <button key="send" className="send" onClick={doSend} disabled={uploading}><Up style={{ width: 17, height: 17 }} /></button>
          ) : (
            <button key="mic" className="mic"><Wave style={{ width: 20, height: 20 }} /></button>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
