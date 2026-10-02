import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { Btn, IconBtn, Area, Empty } from '../admin/ui.jsx';
import { Retry, Trash, Pencil, Stop, Flask } from '../ui/icons.jsx';
import { t, tk } from '../../i18n.jsx';
import Reply from './Reply.jsx';

const ROLES = [
  { value: 'user', label: tk('User') },
  { value: 'system', label: tk('System') },
  { value: 'assistant', label: tk('Assistant') }
];

const STICK_PX = 80;

function Message({ turn, busy, onEdit, onRole, onDrop }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const save = () => { onEdit(draft); setEditing(false); };
  return (
    <div className={'pg-turn pg-msg r-' + turn.role}>
      <div className="pg-turn-bar">
        <button type="button" className={'pg-role r-' + turn.role} disabled={busy}
          title={t('Change role')} onClick={() => onRole(ROLES[(ROLES.findIndex(r => r.value === turn.role) + 1) % ROLES.length].value)}>
          {t(ROLES.find(r => r.value === turn.role)?.label || turn.role)}
        </button>
        <span className="cp-spacer" />
        {!editing && (
          <IconBtn kind="quiet" label={t('Edit message')} disabled={busy}
            onClick={() => { setDraft(turn.content); setEditing(true); }}><Pencil /></IconBtn>
        )}
        <IconBtn kind="quiet" label={t('Delete message')} disabled={busy} onClick={onDrop}><Trash /></IconBtn>
      </div>
      {editing ? (
        <div className="pg-edit">
          <Area rows={4} value={draft} autoFocus aria-label={t('Message text')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }} />
          <div className="cp-acts end">
            <Btn size="sm" onClick={() => setEditing(false)}>{t('Cancel')}</Btn>
            <Btn size="sm" kind="primary" onClick={save}>{t('Save')}</Btn>
          </div>
        </div>
      ) : (
        <div className="pg-msg-text">{turn.content || <span className="pg-dim">{t('Empty message')}</span>}</div>
      )}
    </div>
  );
}

function Answer({ turn, busy, anyBusy, preset, onPrefer, onRerun, onRerunReply, onEditReply, onRequest, onDrop }) {
  const compare = turn.replies.length > 1;
  return (
    <div className="pg-turn pg-answer">
      <div className="pg-turn-bar">
        <span className="pg-role r-assistant static">{compare ? t('Replies') : t('Assistant')}</span>
        <span className="cp-spacer" />
        <IconBtn kind="quiet" label={compare ? t('Run all columns again') : t('Run again')} disabled={anyBusy} onClick={onRerun}><Retry /></IconBtn>
        <IconBtn kind="quiet" label={t('Delete reply')} disabled={busy} onClick={onDrop}><Trash /></IconBtn>
      </div>
      <div className={'pg-grid' + (compare ? '' : ' solo')}>
        {turn.replies.map((r, i) => (
          <Reply key={r.key + i} reply={r} compare={compare} preset={preset}
            preferred={compare && turn.chosen && (turn.pick || 0) === i}
            onPrefer={compare ? () => onPrefer(i) : null}
            onRerun={anyBusy ? null : () => onRerunReply(i)}
            onEdit={busy ? null : (text) => onEditReply(i, text)}
            onRequest={() => onRequest(i)} />
        ))}
      </div>
      {compare && !turn.chosen && !busy && (
        <p className="pg-hint">{t('The conversation continues from the first column until you prefer another.')}</p>
      )}
    </div>
  );
}

export default function Conversation({
  thread, busy, preset, input, setInput, role, setRole, canRun, probes,
  onSubmit, onStop, onEditTurn, onRoleTurn, onDropTurn, onRerunTurn, onRerunReply, onPrefer, onEditReply, onRequest
}) {
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const stick = useRef(true);
  const running = busy.size > 0;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [thread]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [input]);

  const label = role === 'user' ? t('Run') : t('Add message');

  return (
    <div className="pg-convo">
      <div className="pg-scroll" ref={scrollRef}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX; }}>
        <div className="pg-thread">
          {!thread.length && (
            <Empty icon={Flask} title={t('Start a test conversation')}>
              {t('Messages go through the same system prompt, variables and sampling a member gets, minus tools. Every message is editable, so rewrite a reply and run again to see how the model reacts.')}
            </Empty>
          )}
          {!thread.length && (
            <div className="pg-probes">
              {probes.map(p => (
                <button key={p.label} type="button" className="pg-probe"
                  onClick={() => { setRole('user'); setInput(t(p.text)); inputRef.current?.focus(); }}>
                  <b>{t(p.label)}</b>
                  <span>{t(p.text)}</span>
                </button>
              ))}
            </div>
          )}
          {thread.map((turn) => (Array.isArray(turn.replies) ? (
            <Answer key={turn.id} turn={turn} busy={busy.has(turn.id)} anyBusy={running} preset={preset}
              onPrefer={(i) => onPrefer(turn.id, i)}
              onRerun={() => onRerunTurn(turn.id)}
              onRerunReply={(i) => onRerunReply(turn.id, i)}
              onEditReply={(i, text) => onEditReply(turn.id, i, text)}
              onRequest={(i) => onRequest(turn.replies, i)}
              onDrop={() => onDropTurn(turn.id)} />
          ) : (
            <Message key={turn.id} turn={turn} busy={running}
              onEdit={(text) => onEditTurn(turn.id, text)}
              onRole={(r) => onRoleTurn(turn.id, r)}
              onDrop={() => onDropTurn(turn.id)} />
          )))}
        </div>
      </div>
      <form className="pg-composer" onSubmit={(e) => { e.preventDefault(); if (!running) onSubmit(); }}>
        <div className="pg-composer-box">
          <textarea ref={inputRef} value={input} rows={2} aria-label={t('Message')}
            placeholder={role === 'user' ? t('Message the model') : role === 'system' ? t('Add a system message') : t('Write an assistant reply to steer the conversation')}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (!running) onSubmit(); }
            }} />
          <div className="pg-composer-bar">
            <div className="pg-role-pick" role="radiogroup" aria-label={t('Role')}>
              {ROLES.map(r => (
                <button key={r.value} type="button" role="radio" aria-checked={role === r.value}
                  onClick={() => setRole(r.value)}>{t(r.label)}</button>
              ))}
            </div>
            <span className="cp-spacer" />
            <kbd className="pg-kbd">{t('Ctrl+Enter')}</kbd>
            {running
              ? <Btn key="stop" kind="danger" onClick={onStop}><Stop /> {t('Stop')}</Btn>
              : <Btn key="run" kind="primary" type="submit"disabled={!canRun || (role !== 'user' && !input.trim())}>{label}</Btn>}
          </div>
        </div>
      </form>
    </div>
  );
}