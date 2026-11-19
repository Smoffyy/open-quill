import '../../../styles/evals.css';
import { useState, useEffect } from 'react';
import { api } from '../../../lib/api.js';
import { Dialog, Btn, Field, Fields, Area, Select, Note, Badge, Input } from '../ui.jsx';
import { Shield } from '../../ui/icons.jsx';
import { Skel, SkelLines } from '../../ui/Skeleton.jsx';
import { t, fmtDateTime } from '../../../i18n.jsx';

export const VERDICT_TONE = { __proto__: null, pass: 'good', fail: 'bad', na: undefined };
export const verdictLabel = (v) => (v === 'pass' ? t('Pass') : v === 'fail' ? t('Fail') : t('Not applicable'));

export function ReviewDialog({ chatId, messageId, onClose }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.get('/api/admin/review/chats/' + encodeURIComponent(chatId) + (messageId ? '?message=' + encodeURIComponent(messageId) : ''))
      .then(d => { if (alive) setView(d); })
      .catch(e => { if (alive) setError(e.message || t('Could not open the conversation.')); });
    return () => { alive = false; };
  }, [chatId, messageId]);

  useEffect(() => {
    if (!view || !messageId) return;
    document.getElementById('review-' + messageId)?.scrollIntoView({ block: 'center' });
  }, [view, messageId]);

  return (
    <Dialog title={view?.chat.title || t('Conversation')} size="wide" onClose={onClose} foot={<Btn onClick={onClose}>{t('Close')}</Btn>}>
      <Note icon={<Shield />}>{t('Read-only. Opening a member’s conversation is recorded in the Event log.')}</Note>
      {error && <Note tone="bad">{error === 'not found' ? t('This conversation is not open for review, or it was deleted.') : error}</Note>}
      <Skel when={!view && !error}><SkelLines count={6} /></Skel>
      {view && (
        <>
          <div className="ev-review-meta">{t('Owner: {email}', { email: view.chat.owner || t('deleted user') })}</div>
          <ol className="ev-review">
            {view.messages.map(m => (
              <li key={m.id} id={'review-' + m.id} className={'ev-review-msg ' + m.role + (m.id === messageId ? ' focus' : '')}>
                <div className="ev-review-head">
                  <b>{m.role === 'user' ? t('Member') : (m.model || t('Assistant'))}</b>
                  <span className="dim">{fmtDateTime(m.createdAt)}</span>
                </div>
                <div className="ev-review-body">{m.content}</div>
                {m.attachments.length > 0 && <div className="ev-review-att dim">{t('Attached: {names}', { names: m.attachments.join(', ') })}</div>}
                {m.checks.map((c, i) => (
                  <div key={i} className="ev-review-check">
                    <Badge tone={VERDICT_TONE[c.verdict]}>{verdictLabel(c.verdict)}</Badge>
                    <span><b>{c.criterion}</b>{c.explanation ? ': ' + c.explanation : ''}</span>
                  </div>
                ))}
              </li>
            ))}
          </ol>
        </>
      )}
    </Dialog>
  );
}

export function AddToCollection({ messageId, kind, onClose, onDone }) {
  const [collections, setCollections] = useState(null);
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.get('/api/admin/evals').then(d => {
      if (!alive) return;
      setCollections(d.collections || []);
      setTarget(d.collections?.[0]?.id || 'new');
    }).catch(() => { if (alive) setCollections([]); });
    return () => { alive = false; };
  }, []);

  async function save() {
    setBusy(true);
    setError('');
    try {
      let id = target;
      if (id === 'new') id = (await api.post('/api/admin/evals', { name: name.trim() || t('Corrections') })).collection.id;
      await api.post('/api/admin/evals/' + id + '/from-message', { messageId, reference, kind });
      onDone?.();
      onClose();
    } catch (e) { setError(e.message || t('Could not add the test case.')); }
    setBusy(false);
  }

  const options = [...(collections || []).map(c => ({ value: c.id, label: c.name })), { value: 'new', label: t('New collection…') }];
  return (
    <Dialog title={t('Add to a test collection')} onClose={onClose}
      foot={<>
        <Btn onClick={onClose}>{t('Cancel')}</Btn>
        <Btn kind="primary" disabled={busy || collections == null} onClick={save}>{busy ? <><span className="btn-spin" aria-hidden="true" />{t('Adding…')}</> : t('Add test case')}</Btn>
      </>}>
      <Note>{t('The conversation up to this reply becomes the test. The reply itself is kept as what the model said then, so later runs can be compared with it.')}</Note>
      <Fields>
        <Field label={t('Collection')}>
          <Select value={target} label={t('Collection')} onChange={setTarget} options={options} />
        </Field>
        {target === 'new' && (
          <Field label={t('Name')}>
            <Input value={name} placeholder={t('Corrections')} onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <Field label={t('Expert correction')} optional hint={t('What a correct answer says. The judge compares every future reply with it.')}>
          <Area rows={5} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </Fields>
      {error && <Note tone="bad">{error}</Note>}
    </Dialog>
  );
}