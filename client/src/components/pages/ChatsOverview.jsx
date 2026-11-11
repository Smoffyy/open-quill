import { useState, useEffect, useRef, useCallback } from 'react';
import LibraryPage, { LibraryEmpty } from './LibraryPage.jsx';
import { api } from '../../lib/api.js';
import { notify } from '../../lib/notify.js';
import { askConfirm } from '../../lib/confirm.js';
import { t, tk, fmtRelative } from '../../i18n.jsx';
import { useSkeleton } from '../../lib/skeleton.js';
import { Check, Chat, Laptop } from '../ui/icons.jsx';

const WORDS = {
  chat: {
    title: tk('Chats'), untitled: tk('New chat'), none: tk('No chats yet.'), noneArchived: tk('No archived chats.'),
    archived: [tk('{n} chat archived.'), tk('{n} chats archived.')],
    restored: [tk('{n} chat restored.'), tk('{n} chats restored.')],
    deleted: [tk('{n} chat deleted.'), tk('{n} chats deleted.')],
    confirm: [tk('Delete {n} chat?'), tk('Delete {n} chats?')]
  },
  code: {
    title: tk('Sessions'), untitled: tk('Untitled session'), none: tk('No sessions yet'), noneArchived: tk('No archived sessions.'),
    archived: [tk('{n} session archived.'), tk('{n} sessions archived.')],
    restored: [tk('{n} session restored.'), tk('{n} sessions restored.')],
    deleted: [tk('{n} session deleted.'), tk('{n} sessions deleted.')],
    confirm: [tk('Delete {n} session?'), tk('Delete {n} sessions?')]
  }
};

const counted = (pair, n) => t(pair[n === 1 ? 0 : 1], { n });

export default function ChatsOverview({ mode = 'chat', onOpen, onSearch, onChatsChanged }) {
  const code = mode === 'code';
  const words = WORDS[code ? 'code' : 'chat'];
  const [chats, setChats] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const showSkeleton = useSkeleton(loading);
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
      const r = await api.get(`/api/chats-overview?offset=${offsetRef.current}&limit=18&archived=${tabRef.current === 'archived' ? 1 : 0}${code ? '&mode=code' : ''}`);
      setChats(cs => {
        const base = reset ? [] : cs;
        const seen = new Set(base.map(c => c.id));
        return [...base, ...r.chats.filter(c => !seen.has(c.id))];
      });
      offsetRef.current += r.chats.length;
      setHasMore(r.hasMore);
    } catch { setHasMore(false); }
    busyRef.current = false; setLoading(false);
  }, [code]);

  useEffect(() => { loadMore(true); }, [loadMore]);

  useEffect(() => {
    if (!hasMore || loading) return;
    const el = bodyRef.current; if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 320) loadMore();
  }, [chats, hasMore, loading, selecting, loadMore]);

  useEffect(() => {
    const el = bodyRef.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!hasMore || busyRef.current) return;
      if (el.scrollHeight <= el.clientHeight + 320) loadMore();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasMore, loadMore]);

  function switchTab(next) {
    if (next === tabRef.current) return;
    setTab(next); tabRef.current = next;
    setSelected(new Set()); setSelecting(false);
    loadMore(true);
  }

  function onScroll() {
    const el = bodyRef.current; if (!el || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 320) loadMore();
  }

  function toggleSel(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
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
    notify(counted(archived ? words.archived : words.restored, ids.length));
    onChatsChanged?.();
  }

  async function bulkDelete() {
    if (!selected.size || busy) return;
    if (!await askConfirm({
      title: counted(words.confirm, selected.size),
      message: t('This cannot be undone.'), confirm: t('Delete'), danger: true
    })) return;
    setBusy(true);
    const ids = [...selected];
    for (const id of ids) { try { await api.del('/api/chats/' + id); } catch {} }
    setChats(cs => cs.filter(c => !selected.has(c.id)));
    setSelected(new Set());
    setBusy(false);
    notify(counted(words.deleted, ids.length));
    onChatsChanged?.();
  }

  function selectAll() {
    setSelected(prev => prev.size === chats.length ? new Set() : new Set(chats.map(c => c.id)));
  }

  return (
    <LibraryPage
      title={t(words.title)}
      onSearch={onSearch}
      scrollRef={bodyRef} onScroll={onScroll}
      tabs={[{ id: 'all', label: t('Active') }, { id: 'archived', label: t('Archived') }]} tabValue={tab} onTab={switchTab}
      actions={
        <button className="lib-pill" aria-pressed={selecting} onClick={() => { setSelecting(v => !v); setSelected(new Set()); }}>
          {selecting ? t('Done') : t('Select')}
        </button>
      }>
      {selecting && (
        <div className="co-bulkbar">
          <button className="co-bulk-link" onClick={selectAll}>{selected.size === chats.length && chats.length ? t('Clear selection') : t('Select all')}</button>
          <span className="co-bulk-count">{t('{n} selected', { n: selected.size })}</span>
          <div className="co-bulk-actions">
            <button className="btn ghost" disabled={!selected.size || busy} onClick={() => bulkArchive(tab !== 'archived')}>{tab === 'archived' ? t('Unarchive') : t('Archive')}</button>
            <button className="btn ghost danger" disabled={!selected.size || busy} onClick={bulkDelete}>{t("Delete")}</button>
          </div>
        </div>
      )}
      {chats.length === 0 && !loading && (
        <LibraryEmpty icon={code ? <Laptop /> : <Chat />} line={t(tab === 'archived' ? words.noneArchived : words.none)} />
      )}
      <div className="co-grid">
        {showSkeleton && chats.length === 0 && Array.from({ length: 9 }).map((_, i) => (
          <div key={'skel' + i} className="co-card co-card-skel" aria-hidden="true">
            <span className="skeleton" style={{ width: (38 + ((i * 29) % 40)) + '%' }} />
          </div>
        ))}
        {chats.map((c, i) => (
          <button key={c.id} className={'co-card' + (selecting && selected.has(c.id) ? ' selected' : '')} style={{ animationDelay: (i % 18) * 22 + 'ms' }}
            aria-pressed={selecting ? selected.has(c.id) : undefined} onClick={() => clickCard(c)}>
            {selecting && <span className={'co-check' + (selected.has(c.id) ? ' on' : '')}>{selected.has(c.id) && <Check strokeWidth="2.4" />}</span>}
            <div className="co-title">{c.starred ? '★ ' : ''}{c.ended ? '🔒 ' : ''}{c.title && c.title !== 'New chat' ? c.title : t(words.untitled)}</div>
            <div className="co-time">{fmtRelative(c.updated_at)}</div>
          </button>
        ))}
      </div>
      {showSkeleton && chats.length > 0 && <div className="co-loading"><span className="skeleton" style={{ width: 120, height: 12 }} /></div>}
      {!hasMore && chats.length > 0 && <div className="co-end">{t("That's all of them.")}</div>}
    </LibraryPage>
  );
}