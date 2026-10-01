import { useState, useEffect } from 'react';
import Markdown from '../chat/Markdown.jsx';
import ReasoningBlock from '../chat/ReasoningBlock.jsx';
import { ModelMark } from '../ui/Weave.jsx';
import { Btn, IconBtn, CopyBtn, Badge, Area, Dialog, KV, Tabs } from '../admin/ui.jsx';
import { Retry, Pencil, Code, Check, Cube } from '../ui/icons.jsx';
import { t, tk } from '../../i18n.jsx';
import { replyStats, statTiles, fmtDuration } from '../../lib/playground.js';

export const SOURCE_LABEL = { __proto__: null, draft: tk('Draft'), live: tk('Live') };

function Waiting({ since, queued, progress }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="pg-waiting" role="status">
      <span className="pg-pulse" aria-hidden="true" />
      <span>{queued ? t('Queued behind another column on the same connection')
        : progress?.total ? t('Reading the prompt, {pct}%', { pct: Math.min(100, Math.round((progress.processed / progress.total) * 100)) })
          : t('Waiting for the first token')}</span>
      {!queued && <span className="pg-waiting-t">{fmtDuration(Math.max(0, now - since))}</span>}
    </div>
  );
}

export function LaneName({ name, icon, source }) {
  return (
    <span className="pg-lane-name">
      {icon ? <ModelMark src={icon} className="pg-lane-icon" /> : <span className="pg-lane-icon blank" aria-hidden="true"><Cube /></span>}
      <b>{name || t('Untitled')}</b>
      <span className={'pg-src ' + source}>{t(SOURCE_LABEL[source] || SOURCE_LABEL.draft)}</span>
    </span>
  );
}

export function Stats({ reply }) {
  const tiles = statTiles(replyStats(reply));
  if (!tiles.length) return null;
  return (
    <div className="pg-stats">
      {tiles.map(s => (
        <span key={s.id} className="pg-stat"><em>{t(s.label)}</em>{s.value}</span>
      ))}
    </div>
  );
}

export default function Reply({ reply, compare, preferred, onPrefer, onRerun, onEdit, onRequest, clamp, preset }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  if (!reply) return <div className="pg-reply idle"><span className="pg-dim">{t('Not run yet')}</span></div>;
  const queued = reply.status === 'queue';
  const running = queued || reply.status === 'run';
  const waiting = running && !reply.content && !reply.reasoning;

  function save() {
    onEdit(draft);
    setEditing(false);
  }

  return (
    <div className={'pg-reply' + (preferred ? ' preferred' : '') + (running ? ' running' : '')}>
      {compare && (
        <div className="pg-reply-head">
          <LaneName name={reply.name} icon={reply.icon} source={reply.source} />
          {onPrefer && (preferred
            ? <Badge tone="good"><Check /> {t('Preferred')}</Badge>
            : <Btn size="sm" kind="quiet" disabled={running} onClick={onPrefer}>{t('Prefer')}</Btn>)}
        </div>
      )}
      {reply.reasoning ? (
        <ReasoningBlock text={reply.reasoning} live={running && !reply.content} preset={preset}
          durationMs={reply.firstAt && reply.endedAt && !running ? reply.endedAt - reply.firstAt : 0} />
      ) : null}
      {waiting && <Waiting since={reply.startedAt} queued={queued} progress={reply.progress} />}
      {editing ? (
        <div className="pg-edit">
          <Area rows={6} value={draft} aria-label={t('Reply text')} autoFocus
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
      ) : reply.content ? (
        <div className={'pg-reply-body' + (clamp && !open ? ' clamp' : '')}>
          <div className="assistant-body pg-md"><Markdown streaming={running}>{reply.content}</Markdown></div>
        </div>
      ) : (!running && !reply.error ? <p className="pg-dim">{t('Empty reply.')}</p> : null)}
      {clamp && reply.content && !editing && reply.content.length > 600 && (
        <button type="button" className="pg-more" onClick={() => setOpen(o => !o)}>{open ? t('Show less') : t('Show all')}</button>
      )}
      {reply.error ? <div className="pg-err" role="alert">{reply.error}</div> : null}
      {!running && (
        <div className="pg-reply-foot">
          <Stats reply={reply} />
          <div className="pg-reply-flags">
            {reply.finish === 'length' && <Badge tone="warn">{t('Hit the token limit')}</Badge>}
            {reply.status === 'stopped' && <Badge>{t('Stopped')}</Badge>}
          </div>
          <div className="pg-reply-acts">
            {reply.content && <CopyBtn text={reply.content} title={t('Copy reply')} />}
            {onEdit && reply.content && (
              <IconBtn kind="quiet" label={t('Edit reply')} onClick={() => { setDraft(reply.content); setEditing(true); }}><Pencil /></IconBtn>
            )}
            {reply.request && onRequest && <IconBtn kind="quiet" label={t('Show request')} onClick={onRequest}><Code /></IconBtn>}
            {onRerun && <IconBtn kind="quiet" label={t('Run again')} onClick={onRerun}><Retry /></IconBtn>}
          </div>
        </div>
      )}
    </div>
  );
}

export function RequestDialog({ replies, at, onClose }) {
  const [tab, setTab] = useState(at || 0);
  const reply = replies[Math.min(tab, replies.length - 1)];
  const req = reply?.request;
  if (!req) return null;
  const json = JSON.stringify(req, null, 2);
  return (
    <Dialog title={t('Request')} size="wide" onClose={onClose}
      foot={<><CopyBtn text={json} title={t('Copy request as JSON')} /><span className="cp-spacer" /><Btn onClick={onClose}>{t('Done')}</Btn></>}>
      {replies.length > 1 && (
        <Tabs label={t('Replies')} value={tab} onChange={setTab}
          items={replies.map((r, i) => ({ id: i, label: r.name + ' · ' + t(SOURCE_LABEL[r.source] || SOURCE_LABEL.draft) }))} />
      )}
      <div className="pg-req">
        <KV items={[
          [t('Version'), t(SOURCE_LABEL[req.source] || SOURCE_LABEL.draft)],
          [t('Model id'), req.model || '–', true],
          [t('Connection'), [req.provider, req.protocol].filter(Boolean).join(' · ') || '–'],
          ...(req.routed ? [[t('Routed to'), req.routed.model + ' · ' + req.routed.via]] : []),
          [t('Sampling'), Object.keys(req.params || {}).length ? JSON.stringify(req.params) : t('Provider defaults'), true],
          [t('Extra fields'), Object.keys(req.kwargs || {}).length ? JSON.stringify(req.kwargs) : t('None'), true]
        ]} />
        <p className="cp-note-line">{t('Tools do not run in the playground, so their instructions are left out of the system prompt, the same as in an incognito chat.')}</p>
        <div className="pg-req-msgs">
          {(req.messages || []).map((m, i) => (
            <div key={i} className="pg-req-msg">
              <div className="pg-req-role"><span className={'pg-role r-' + m.role}>{t(m.role)}</span><span>{t('{n} characters', { n: String(m.content || '').length.toLocaleString() })}</span></div>
              <pre>{m.content}</pre>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
