import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { Search, Star } from './icons.jsx';

export default function SearchModal({ onClose, onOpen }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const seq = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const s = ++seq.current;
    if (q.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try { const d = await api.get('/api/search?q=' + encodeURIComponent(q.trim())); if (s === seq.current) { setResults(d.results || []); setActive(0); } }
      catch { if (s === seq.current) setResults([]); }
      finally { if (s === seq.current) setLoading(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  function pick(r) { if (r) { onOpen(r.id); onClose(); } }
  function onKey(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(results.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[active]); }
  }

  function highlight(text) {
    const term = q.trim();
    if (!term) return text;
    const i = text.toLowerCase().indexOf(term.toLowerCase());
    if (i === -1) return text;
    return <>{text.slice(0, i)}<mark>{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>;
  }

  return (
    <div className="overlay search-overlay" onMouseDown={(e) => e.target.classList.contains('overlay') && onClose()}>
      <div className="search-modal" onKeyDown={onKey}>
        <div className="search-head">
          <Search style={{ width: 18 }} />
          <input ref={inputRef} value={q} placeholder="Search your chats…" onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="search-body">
          {q.trim().length < 2 && <div className="search-empty">Type at least 2 characters to search across all your conversations.</div>}
          {q.trim().length >= 2 && !loading && results.length === 0 && <div className="search-empty">No matches.</div>}
          {results.map((r, i) => (
            <button key={r.id} className={'search-row' + (i === active ? ' active' : '')} onMouseEnter={() => setActive(i)} onClick={() => pick(r)}>
              <div className="search-title">{r.starred && <Star style={{ width: 13, marginRight: 4 }} />}{highlight(r.title || 'Untitled')}</div>
              {r.snippet && <div className="search-snippet">{highlight(r.snippet)}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
