import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { t } from '../i18n.jsx';

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

export default function ChatsOverview({ onOpen, onClose, onChatsChanged }) {
  const [chats, setChats] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('all');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const offsetRef = useRef(0);
  const bodyRef = useRef(null);
  const busyRef = useRef(false);
  const tabRef = useRef('all');

  const loadMore = useCallback(async (reset) => {
    if (busyRef.current) return;
    busyRef.current = true; setLoading(true);
    if (reset) { offsetRef.current = 0; setChats([]); setHasMore(true); }
    try {
      const r = await api.get(`/api/chats-overview?offset=${offsetRef.current}&limit=18&archived=${tabRef.current === 'archived' ? 1 : 0}`);
      setChats(cs => {
        const base = reset ? [] : cs;
        const seen = new Set(base.map(c => c.id));
        return [...base, ...r.chats.filter(c => !seen.has(c.id))];
      });
      offsetRef.current += r.chats.length;
      setHasMore(r.hasMore);
    } catch { setHasMore(false); }
    busyRef.current = false; setLoading(false);
  }, []);

  useEffect(() => { loadMore(); }, [loadMore]);

  function switchTab(t) {
    setTab(t); tabRef.current = t;
    setSelected(new Set()); setSelecting(false);
    loadMore(true);
  }

  function onScroll() {
    const el = bodyRef.current; if (!el || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320) loadMore();
  }

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  function toggleSel(id) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function clickCard(c) {
    if (selecting) toggleSel(c.id);
    else onOpen(c.id);
  }

  async function bulkArchive(archived) {
    if (!selected.size || busy) return;
    setBusy(true);
    const ids = [...selected];
    for (const id of ids) { try { await api.patch('/api/chats/' + id, { archived }); } catch {} }
    setChats(cs => cs.filter(c => !selected.has(c.id)));
    setSelected(new Set());
    setBusy(false);
    toast(`${ids.length} chat${ids.length === 1 ? '' : 's'} ${archived ? 'archived' : 'restored'}.`);
    onChatsChanged?.();
  }

  async function bulkDelete() {
    if (!selected.size || busy) return;
    if (!confirm(`Permanently delete ${selected.size} chat${selected.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setBusy(true);
    const ids = [...selected];
    for (const id of ids) { try { await api.del('/api/chats/' + id); } catch {} }
    setChats(cs => cs.filter(c => !selected.has(c.id)));
    setSelected(new Set());
    setBusy(false);
    toast(`${ids.length} chat${ids.length === 1 ? '' : 's'} deleted.`);
    onChatsChanged?.();
  }

  function selectAll() {
    setSelected(prev => prev.size === chats.length ? new Set() : new Set(chats.map(c => c.id)));
  }

  return (
    <div className="chats-overview">
      <div className="co-head">
        <h2>{t("Your chats")}</h2>
        <div className="co-tools">
          <div className="seg co-seg">
            <button className={tab === 'all' ? 'on' : ''} onClick={() => switchTab('all')}>{t("Active")}</button>
            <button className={tab === 'archived' ? 'on' : ''} onClick={() => switchTab('archived')}>{t("Archived")}</button>
          </div>
          <button className={'co-select-btn' + (selecting ? ' on' : '')} onClick={() => { setSelecting(v => !v); setSelected(new Set()); }}>{selecting ? t('Done') : t('Select')}</button>
        </div>
        <button className="co-close" onClick={onClose}>✕</button>
      </div>
      {selecting && (
        <div className="co-bulkbar">
          <button className="co-bulk-link" onClick={selectAll}>{selected.size === chats.length && chats.length ? t('Clear selection') : t('Select all')}</button>
          <span className="co-bulk-count">{selected.size} selected</span>
          <div className="co-bulk-actions">
            <button className="btn ghost" disabled={!selected.size || busy} onClick={() => bulkArchive(tab !== 'archived')}>{tab === 'archived' ? t('Unarchive') : t('Archive')}</button>
            <button className="btn ghost danger" disabled={!selected.size || busy} onClick={bulkDelete}>{t("Delete")}</button>
          </div>
        </div>
      )}
      <div className="co-body" ref={bodyRef} onScroll={onScroll}>
        {chats.length === 0 && !loading && <div className="art-empty">{tab === 'archived' ? t('No archived chats.') : t('No chats yet.')}</div>}
        <div className="co-grid">
          {chats.map((c, i) => (
            <button key={c.id} className={'co-card' + (selecting && selected.has(c.id) ? ' selected' : '')} style={{ animationDelay: (i % 18) * 22 + 'ms' }} onClick={() => clickCard(c)}>
              {selecting && <span className={'co-check' + (selected.has(c.id) ? ' on' : '')}>{selected.has(c.id) ? '✓' : ''}</span>}
              <div className="co-title">{c.starred ? '★ ' : ''}{c.ended ? '🔒 ' : ''}{c.title || t('New chat')}</div>
              {c.preview && <div className="co-preview">{c.preview}</div>}
              <div className="co-fade" />
              <div className="co-time">{timeAgo(c.updated_at)}</div>
            </button>
          ))}
        </div>
        {loading && <div className="co-loading"><span className="skeleton" style={{ width: 120, height: 12 }} /></div>}
        {!hasMore && chats.length > 0 && <div className="co-end">{t("That's all of them.")}</div>}
      </div>
    </div>
  );
}
