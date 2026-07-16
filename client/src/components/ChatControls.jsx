import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { X } from './icons.jsx';

const FIELDS = [
  { k: 'temperature', label: 'Temperature', min: 0, max: 2, step: 0.05 },
  { k: 'top_p', label: 'Top P', min: 0, max: 1, step: 0.01 },
  { k: 'top_k', label: 'Top K', min: 0, max: 200, step: 1 },
  { k: 'min_p', label: 'Min P', min: 0, max: 1, step: 0.01 },
  { k: 'max_tokens', label: 'Max tokens', min: 0, max: 131072, step: 64 },
  { k: 'frequency_penalty', label: 'Frequency penalty', min: -2, max: 2, step: 0.05 },
  { k: 'presence_penalty', label: 'Presence penalty', min: -2, max: 2, step: 0.05 },
  { k: 'repeat_penalty', label: 'Repeat penalty', min: 0, max: 2, step: 0.05 }
];

export default function ChatControls({ chatId, initialParams, initialOverride, onChange, onClose }) {
  const [params, setParams] = useState(initialParams || {});
  const [override, setOverride] = useState(initialOverride || '');
  const [status, setStatus] = useState('idle');
  const timer = useRef(null);

  useEffect(() => { setParams(initialParams || {}); setOverride(initialOverride || ''); }, [chatId]);

  function save(nextParams, nextOverride) {
    if (onChange) onChange(nextParams, nextOverride);
    if (!chatId) { setStatus('idle'); return; }
    setStatus('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await api.patch('/api/chats/' + chatId, { genParams: nextParams, systemOverride: nextOverride });
        setStatus('saved');
        setTimeout(() => setStatus(s => s === 'saved' ? 'idle' : s), 1400);
      } catch { setStatus('idle'); }
    }, 600);
  }

  function setField(k, v) {
    const next = { ...params };
    if (v === '' || v == null) delete next[k]; else next[k] = Number(v);
    setParams(next);
    save(next, override);
  }
  function setOv(v) { setOverride(v); save(params, v); }

  function resetAll() { setParams({}); setOverride(''); save({}, ''); }

  const activeCount = Object.keys(params).length + (override.trim() ? 1 : 0);

  return (
    <aside className="chatctl-panel">
      <div className="chatctl-head">
        <div>
          <div className="chatctl-title">Chat controls</div>
          <div className="chatctl-sub">{chatId ? <>Overrides apply to this chat only, on top of the model's own settings. {status === 'saving' ? 'Saving\u2026' : status === 'saved' ? 'Saved.' : ''}</> : 'These apply to the new chat once you send your first message.'}</div>
        </div>
        <button className="chatctl-x" onClick={onClose}><X style={{ width: 16 }} /></button>
      </div>
      <div className="chatctl-body">
        <div className="chatctl-section">System prompt override</div>
        <textarea className="chatctl-sys" rows={6} value={override} placeholder="Leave empty to use the model's own system prompt\u2026"
          onChange={(e) => setOv(e.target.value)} />
        <div className="chatctl-section">Sampling parameters</div>
        {FIELDS.map(f => {
          const set = params[f.k] != null;
          return (
            <div key={f.k} className={'chatctl-row' + (set ? ' set' : '')}>
              <label>{f.label}</label>
              {set ? (
                <>
                  <input type="range" min={f.min} max={f.max} step={f.step} value={params[f.k]} onChange={(e) => setField(f.k, e.target.value)} />
                  <input className="chatctl-num" type="number" min={f.min} max={f.max} step={f.step} value={params[f.k]} onChange={(e) => setField(f.k, e.target.value)} />
                  <button className="chatctl-clear" title="Use model default" onClick={() => setField(f.k, '')}>\u00d7</button>
                </>
              ) : (
                <button className="chatctl-default" onClick={() => setField(f.k, f.k === 'max_tokens' ? 4096 : f.k === 'top_k' ? 40 : f.k === 'repeat_penalty' ? 1.1 : f.k === 'top_p' ? 0.95 : f.k === 'temperature' ? 0.7 : 0)}>Default</button>
              )}
            </div>
          );
        })}
        {activeCount > 0 && <button className="chatctl-reset" onClick={resetAll}>Reset all to model defaults</button>}
      </div>
    </aside>
  );
}
