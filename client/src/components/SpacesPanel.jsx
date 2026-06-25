import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api.js';
import Markdown from './Markdown.jsx';
import { Plus, Chevron, Users, Trash, Send, Gear, Check, Logout } from './icons.jsx';

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24); if (d < 7) return d + 'd ago';
  return new Date(ts).toLocaleDateString();
}
function initials(name) { return (name || '?').trim()[0]?.toUpperCase() || '?'; }

function InviteSearch({ spaceId, onInvited }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  useEffect(() => {
    if (!q.trim() || q.trim().length < 2) { setResults([]); return; }
    let on = true;
    const t = setTimeout(async () => {
      try { const r = await api.get('/api/users/search?q=' + encodeURIComponent(q.trim())); if (on) setResults(r); } catch {}
    }, 220);
    return () => { on = false; clearTimeout(t); };
  }, [q]);
  async function invite(u) {
    setBusy(true);
    try { await api.post('/api/spaces/' + spaceId + '/invite', { userId: u.id }); onInvited?.(); setQ(''); setResults([]); setOpen(false); }
    catch (e) { alert(e.message || 'Could not invite that user.'); }
    setBusy(false);
  }
  return (
    <div className="spc-invite" ref={ref}>
      <input className="spc-invite-input" placeholder="Search by name or email to invite…" value={q}
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      {open && q.trim().length >= 2 && (
        <div className="spc-invite-results">
          {busy && <div className="spc-invite-empty">Inviting…</div>}
          {!busy && results.length === 0 && <div className="spc-invite-empty">No matching users.</div>}
          {!busy && results.map(u => (
            <button key={u.id} className="spc-invite-row" onClick={() => invite(u)}>
              <span className="spc-avatar small">{initials(u.displayName)}</span>
              <span>
                <div className="spc-invite-name">{u.displayName}</div>
                <div className="spc-invite-email">{u.email}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MembersPanel({ space, user, models, onChanged, onClose }) {
  const isOwner = space.ownerId === user.id || user.isAdmin;
  const [name, setName] = useState(space.name);
  const [sys, setSys] = useState(space.systemPrompt || '');
  const [modelId, setModelId] = useState(space.modelId || '');
  useEffect(() => { setName(space.name); setSys(space.systemPrompt || ''); setModelId(space.modelId || ''); }, [space.id]);

  async function saveSettings() {
    await api.patch('/api/spaces/' + space.id, { name, systemPrompt: sys, modelId });
    onChanged?.();
  }
  async function removeMember(uid) {
    if (!confirm('Remove this member from the space?')) return;
    await api.del('/api/spaces/' + space.id + '/members/' + uid);
    onChanged?.();
  }
  async function setMemberRole(uid, role) {
    try { await api.patch('/api/spaces/' + space.id + '/members/' + uid, { role }); onChanged?.(); } catch {}
  }
  async function leave() {
    if (!confirm('Leave this space?')) return;
    await api.post('/api/spaces/' + space.id + '/leave', {});
    onClose?.();
  }
  async function del() {
    if (!confirm('Delete this space for everyone? This cannot be undone.')) return;
    await api.del('/api/spaces/' + space.id);
    onClose?.();
  }

  return (
    <div className="spc-settings">
      {isOwner && (
        <>
          <div className="field">
            <label>Space name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </div>
          <div className="field">
            <label>Assistant model</label>
            <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
              <option value="">Default model</option>
              {models.map(m => <option key={m.id} value={m.id}>{m.displayName}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Custom instructions for the assistant in this space</label>
            <textarea value={sys} onChange={(e) => setSys(e.target.value)}
              placeholder="e.g. Only jump in to answer technical questions about our project; otherwise stay quiet." />
          </div>
          <div className="btn-row">
            <button className="btn primary" onClick={saveSettings}>Save settings</button>
          </div>
          <hr />
          <div className="field"><label>Invite someone</label>
            <InviteSearch spaceId={space.id} onInvited={onChanged} />
          </div>
        </>
      )}
      <div className="field">
        <label>Members ({space.members.length})</label>
        <div className="spc-member-list">
          {space.members.map(m => (
            <div key={m.userId} className="spc-member-row">
              <span className="spc-avatar small">{initials(m.displayName)}</span>
              <span className="spc-member-name">{m.displayName}{m.userId === user.id ? ' (you)' : ''}{m.role === 'owner' ? ' · Owner' : ''}</span>
              {isOwner && m.role !== 'owner' && m.status === 'accepted' ? (
                <div className="seg spc-role-seg">
                  <button className={m.role !== 'viewer' ? 'on' : ''} onClick={() => setMemberRole(m.userId, 'editor')}>Editor</button>
                  <button className={m.role === 'viewer' ? 'on' : ''} onClick={() => setMemberRole(m.userId, 'viewer')}>Viewer</button>
                </div>
              ) : (m.role !== 'owner' && <span className={'spc-status spc-status-' + m.status}>{m.status === 'accepted' ? (m.role === 'viewer' ? 'viewer' : 'editor') : m.status}</span>)}
              {isOwner && m.role !== 'owner' && (
                <button className="row-ctrl" title="Remove" onClick={() => removeMember(m.userId)}><Trash style={{ width: 13 }} /></button>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="btn-row">
        {!isOwner && <button className="btn danger" onClick={leave}><Logout style={{ width: 14 }} /> Leave space</button>}
        {isOwner && <button className="btn danger" onClick={del}><Trash style={{ width: 14 }} /> Delete space</button>}
      </div>
    </div>
  );
}

function SpaceChat({ space, user, models, onChanged, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [peopleTyping, setPeopleTyping] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState(null);
  const bodyRef = useRef(null);
  const taRef = useRef(null);
  const pollRef = useRef(null);
  const typingSent = useRef(0);
  const typingStop = useRef(null);

  const myRole = (space.members.find(m => m.userId === user.id) || {}).role;
  const viewOnly = myRole === 'viewer';
  const aiName = (() => { const mm = models?.find(x => x.id === space.modelId); return mm?.displayName || 'Assistant'; })();
  const mentionNames = [aiName, ...space.members.filter(m => m.userId !== user.id).map(m => m.displayName)];

  const load = useCallback(async () => {
    try { setMessages(await api.get('/api/spaces/' + space.id + '/messages')); } catch {}
  }, [space.id]);

  useEffect(() => { load(); pollRef.current = setInterval(load, 4000); return () => clearInterval(pollRef.current); }, [load]);

  useEffect(() => {
    const h = (e) => {
      const m = e.detail;
      if (!m || m.spaceId !== space.id) return;
      if (m.type === 'space_message') { setMessages(cs => cs.some(x => x.id === m.message.id) ? cs : [...cs, m.message]); setPeopleTyping(p => { const n = { ...p }; delete n[m.message.userId]; return n; }); }
      if (m.type === 'space_typing') setTyping(!!m.typing);
      if (m.type === 'space_user_typing') setPeopleTyping(p => {
        const n = { ...p };
        if (m.typing) n[m.userId] = m.name; else delete n[m.userId];
        return n;
      });
    };
    window.addEventListener('oq-space', h);
    return () => window.removeEventListener('oq-space', h);
  }, [space.id]);

  useEffect(() => { const el = bodyRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages, typing, peopleTyping]);

  function sendTyping(on) {
    const nowT = Date.now();
    if (on && nowT - typingSent.current < 2500) return;
    typingSent.current = on ? nowT : 0;
    api.post('/api/spaces/' + space.id + '/typing', { typing: on }).catch(() => {});
  }
  function onInputChange(v) {
    setInput(v);
    if (!viewOnly) { sendTyping(true); clearTimeout(typingStop.current); typingStop.current = setTimeout(() => sendTyping(false), 3000); }
    const caret = taRef.current?.selectionStart ?? v.length;
    const upto = v.slice(0, caret);
    const mm = upto.match(/@([\w .-]*)$/);
    if (mm) {
      const q = mm[1].toLowerCase();
      const matches = mentionNames.filter(n => n.toLowerCase().includes(q)).slice(0, 5);
      setMention(matches.length ? { matches, start: caret - mm[0].length, caret } : null);
    } else setMention(null);
  }
  function pickMention(name) {
    const before = input.slice(0, mention.start);
    const after = input.slice(mention.caret);
    const next = before + '@' + name + ' ' + after;
    setInput(next); setMention(null);
    setTimeout(() => taRef.current?.focus(), 0);
  }

  async function send() {
    const text = input.trim();
    if (!text || sending || viewOnly) return;
    setInput(''); setMention(null); setSending(true);
    clearTimeout(typingStop.current); sendTyping(false);
    try {
      const m = await api.post('/api/spaces/' + space.id + '/messages', { content: text });
      setMessages(cs => cs.some(x => x.id === m.id) ? cs : [...cs, m]);
    } catch (e) { alert(e.message || 'Could not send message.'); }
    setSending(false);
  }
  const typingNames = Object.values(peopleTyping);

  return (
    <div className="spc-chat">
      <div className="spc-chat-head">
        <div className="spc-chat-title"><Users style={{ width: 17 }} /> {space.name}</div>
        <div className="spc-chat-sub">{space.members.filter(m => m.status === 'accepted').length} member(s)</div>
        <button className="icon-btn" onClick={() => setSettingsOpen(o => !o)} title="Space settings"><Gear style={{ width: 17 }} /></button>
      </div>
      {settingsOpen ? (
        <div className="spc-chat-body"><MembersPanel space={space} user={user} models={models} onChanged={onChanged} onClose={onClose} /></div>
      ) : (
        <>
          <div className="spc-chat-body" ref={bodyRef}>
            {messages.length === 0 && <div className="spc-empty-msgs">No messages yet — say hello!</div>}
            {messages.map(m => (
              <div key={m.id} className={'spc-msg' + (m.role === 'assistant' ? ' assistant' : (m.userId === user.id ? ' mine' : ''))}>
                <span className="spc-avatar small">{m.role === 'assistant' ? '✦' : initials(m.authorName)}</span>
                <div className="spc-msg-body">
                  <div className="spc-msg-head"><span className="spc-msg-name">{m.role === 'assistant' ? (m.authorName || 'Assistant') : m.authorName}</span><span className="spc-msg-time">{timeAgo(m.createdAt)}</span></div>
                  <div className="spc-msg-text"><Markdown>{m.content}</Markdown></div>
                </div>
              </div>
            ))}
            {typing && <div className="spc-typing"><span className="spc-avatar small">✦</span> {aiName} is thinking…</div>}
            {typingNames.length > 0 && <div className="spc-typing">{typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.slice(0, 2).join(', ')}${typingNames.length > 2 ? ' and others' : ''} are typing…`}</div>}
          </div>
          {viewOnly ? (
            <div className="spc-viewonly">You have view-only access to this space.</div>
          ) : (
            <div className="spc-composer">
              {mention && (
                <div className="spc-mention-menu">
                  {mention.matches.map(n => (
                    <button key={n} onMouseDown={(e) => { e.preventDefault(); pickMention(n); }}>{n === aiName ? '✦ ' : '@'}{n}</button>
                  ))}
                </div>
              )}
              <textarea ref={taRef} value={input} placeholder={'Message ' + space.name + '… (use @ to mention)'}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={(e) => { if (mention && e.key === 'Enter') { e.preventDefault(); pickMention(mention.matches[0]); return; } if (e.key === 'Escape') setMention(null); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
              <button className="send" disabled={!input.trim() || sending} onClick={send}><Send style={{ width: 15 }} /></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InviteCard({ space, onRespond }) {
  return (
    <div className="spc-invite-card">
      <div className="spc-avatar"><Users style={{ width: 20 }} /></div>
      <h3>{space.name}</h3>
      <p>You've been invited to join this space, where you can chat alongside other people and the assistant.</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => onRespond(space.id, true)}><Check style={{ width: 14 }} /> Accept</button>
        <button className="btn ghost" onClick={() => onRespond(space.id, false)}>Decline</button>
      </div>
    </div>
  );
}

export default function SpacesPanel({ user, onClose }) {
  const [spaces, setSpaces] = useState([]);
  const [models, setModels] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    try { setSpaces(await api.get('/api/spaces')); } catch {}
  }, []);
  useEffect(() => { load(); api.get('/api/models').then(setModels).catch(() => {}); }, [load]);

  useEffect(() => {
    const h = (e) => {
      const m = e.detail;
      if (!m) return;
      if (m.type === 'space_invite' || m.type === 'space_updated' || m.type === 'space_deleted' || m.type === 'space_removed' || m.type === 'space_message') load();
    };
    window.addEventListener('oq-space', h);
    return () => window.removeEventListener('oq-space', h);
  }, [load]);

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape' && !creating) onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose, creating]);

  async function createSpace() {
    const name = newName.trim();
    if (!name) return;
    const s = await api.post('/api/spaces', { name });
    setNewName(''); setCreating(false);
    await load();
    setActiveId(s.id);
  }
  async function respond(id, accept) {
    await api.post('/api/spaces/' + id + '/respond', { accept });
    await load();
    if (accept) setActiveId(id);
  }

  const invites = spaces.filter(s => s.myStatus === 'invited');
  const accepted = spaces.filter(s => s.myStatus === 'accepted').sort((a, b) => b.updatedAt - a.updatedAt);
  const active = spaces.find(s => s.id === activeId) || null;

  return (
    <div className="admin-page">
      <nav className="admin-rail">
        <div className="ar-brand">Spaces</div>
        <button className="ar-tab" onClick={() => setCreating(c => !c)}><Plus /> New space</button>
        {creating && (
          <div className="spc-create-row">
            <input autoFocus value={newName} placeholder="Space name" onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createSpace(); if (e.key === 'Escape') setCreating(false); }} />
            <button className="btn primary" onClick={createSpace}>Create</button>
          </div>
        )}
        {invites.length > 0 && <div className="section-label">Invites <span className="folder-count">{invites.length}</span></div>}
        {invites.map(s => (
          <button key={s.id} className={'ar-tab' + (s.id === activeId ? ' active' : '')} onClick={() => setActiveId(s.id)}>
            <Users /> {s.name}
          </button>
        ))}
        <div className="section-label">Your spaces</div>
        {accepted.length === 0 && <div className="chats-empty">No spaces yet</div>}
        {accepted.map(s => (
          <button key={s.id} className={'ar-tab' + (s.id === activeId ? ' active' : '')} onClick={() => setActiveId(s.id)}>
            <Users /> {s.name}
          </button>
        ))}
        <button className="ar-back" onClick={onClose}><Chevron style={{ transform: 'rotate(90deg)', width: 16 }} /> Back to chat</button>
      </nav>
      <div className="admin-content">
        {!active && (
          <div className="admin-empty">
            <div className="ae-icon"><Users style={{ width: 30 }} /></div>
            <h2>Chat together with Spaces</h2>
            <p>Create a space to chat with other users and the assistant together, or pick one on the left. Invited people must accept before they can see messages.</p>
            <div className="ae-actions">
              <button className="btn primary" onClick={() => setCreating(true)}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> Create a space</button>
            </div>
          </div>
        )}
        {active && active.myStatus === 'invited' && <div className="admin-body"><InviteCard space={active} onRespond={respond} /></div>}
        {active && active.myStatus === 'accepted' && (
          <SpaceChat space={active} user={user} models={models} onChanged={load} onClose={() => { setActiveId(null); load(); }} />
        )}
      </div>
    </div>
  );
}
