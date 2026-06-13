import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24); if (d < 7) return d + 'd ago';
  return new Date(ts).toLocaleDateString();
}

export default function ChatsOverview({ onOpen, onClose }) {
  const [chats, setChats] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const offsetRef = useRef(0);
  const bodyRef = useRef(null);
  const busyRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true; setLoading(true);
    try {
      const r = await api.get(`/api/chats-overview?offset=${offsetRef.current}&limit=18`);
      setChats(cs => {
        const seen = new Set(cs.map(c => c.id));
        return [...cs, ...r.chats.filter(c => !seen.has(c.id))];
      });
      offsetRef.current += r.chats.length;
      setHasMore(r.hasMore);
    } catch { setHasMore(false); }
    busyRef.current = false; setLoading(false);
  }, []);

  useEffect(() => { loadMore(); }, [loadMore]);

  function onScroll() {
    const el = bodyRef.current; if (!el || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320) loadMore();
  }

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="chats-overview">
      <div className="co-head">
        <h2>Your chats</h2>
        <button className="co-close" onClick={onClose}>✕</button>
      </div>
      <div className="co-body" ref={bodyRef} onScroll={onScroll}>
        {chats.length === 0 && !loading && <div className="art-empty">No chats yet.</div>}
        <div className="co-grid">
          {chats.map((c, i) => (
            <button key={c.id} className="co-card" style={{ animationDelay: (i % 18) * 22 + 'ms' }} onClick={() => onOpen(c.id)}>
              <div className="co-title">{c.starred ? '★ ' : ''}{c.title || 'New chat'}</div>
              {c.preview && <div className="co-preview">{c.preview}</div>}
              <div className="co-fade" />
              <div className="co-time">{timeAgo(c.updated_at)}</div>
            </button>
          ))}
        </div>
        {loading && <div className="co-loading"><span className="skeleton" style={{ width: 120, height: 12 }} /></div>}
        {!hasMore && chats.length > 0 && <div className="co-end">That's all of them.</div>}
      </div>
    </div>
  );
}
