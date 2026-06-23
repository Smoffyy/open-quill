import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { Pencil, Fork, Star, Compact, Sliders, Pin, Copy } from './icons.jsx';

export default function ChatMenu({ chat, modelId, pinned = [], onJump, onCopyConversation, onClose, onRename, onFork, onToggleStar, onInstructionsSaved }) {
  const ref = useRef(null);
  const [instr, setInstr] = useState(chat.instructions || '');
  const [ctx, setCtx] = useState(null);
  const [savedTick, setSavedTick] = useState(false);
  const saveTimer = useRef(null);
  const baseInstr = useRef(chat.instructions || '');

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  useEffect(() => {
    let on = true;
    const q = modelId ? '?modelId=' + encodeURIComponent(modelId) : '';
    api.get('/api/chats/' + chat.id + '/context' + q).then(d => { if (on) setCtx(d); }).catch(() => {});
    return () => { on = false; };
  }, [chat.id, modelId]);

  function changeInstr(v) {
    setInstr(v);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await api.patch('/api/chats/' + chat.id, { instructions: v }); baseInstr.current = v; onInstructionsSaved?.(v); setSavedTick(true); setTimeout(() => setSavedTick(false), 1200); } catch {}
    }, 500);
  }
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const pct = ctx && ctx.limit ? ctx.pct : 0;
  const meterClass = pct >= 90 ? 'over' : pct >= 70 ? 'warn' : '';

  return (
    <div className="chat-menu-pop" ref={ref}>
      <div className="cmp-actions">
        <button onClick={() => { onClose(); onRename?.(); }}><Pencil style={{ width: 15 }} /> Rename</button>
        <button onClick={() => { onClose(); onToggleStar?.(); }}><Star style={{ width: 15 }} /> {chat.starred ? 'Unstar' : 'Star'}</button>
        <button onClick={() => { onClose(); onFork?.(); }}><Fork style={{ width: 15 }} /> Fork chat</button>
        <button onClick={() => { onClose(); onCopyConversation?.(); }}><Copy style={{ width: 15 }} /> Copy all</button>
      </div>
      {pinned.length > 0 && (
        <div className="cmp-sec">
          <div className="cmp-label"><Pin style={{ width: 14 }} /> Pinned ({pinned.length})</div>
          <div className="cmp-pins">
            {pinned.map(m => (
              <button key={m.id} className="cmp-pin" onClick={() => onJump?.(m.id)}>
                <span className="cmp-pin-role">{m.role === 'user' ? 'You' : 'AI'}</span>
                <span className="cmp-pin-text">{(typeof m.content === 'string' ? m.content : '').replace(/\s+/g, ' ').trim().slice(0, 80) || '(no text)'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="cmp-sec">
        <div className="cmp-label"><Sliders style={{ width: 14 }} /> Chat instructions</div>
        <div className="cmp-note">Added to the system prompt for this chat only, on top of your global instructions.</div>
        <textarea className="cmp-instr" value={instr} maxLength={8000} rows={4}
          placeholder="e.g. Answer as a senior code reviewer. Be terse."
          onChange={(e) => changeInstr(e.target.value)} />
        <div className="cmp-saved">{savedTick ? 'Saved' : ''}</div>
      </div>
      <div className="cmp-sec">
        <div className="cmp-label"><Compact style={{ width: 14 }} /> Context window</div>
        {ctx ? (
          ctx.limit ? (
            <>
              <div className={'cmp-meter ' + meterClass}><span style={{ width: pct + '%' }} /></div>
              <div className="cmp-note">{ctx.used.toLocaleString()} / {ctx.limit.toLocaleString()} tokens ({pct}%){ctx.hasSummary ? ' · older turns compacted' : ''}</div>
            </>
          ) : (
            <div className="cmp-note">~{ctx.used.toLocaleString()} tokens in context. No window limit set for this model.</div>
          )
        ) : <div className="cmp-note">Measuring…</div>}
      </div>
    </div>
  );
}
