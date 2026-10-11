import '../../../styles/admin.css';
import '../../../styles/changes.css';
import { useMemo, useState, useId } from 'react';
import { Dialog, Btn, Seg, Empty, fmtAgo } from '../ui.jsx';
import { CheckCircle } from '../../ui/icons.jsx';
import { t } from '../../../i18n.jsx';
import { toast } from '../../../lib/toast.js';
import { groupChanges, isMine, othersIn } from '../../../lib/changeset.js';
import { sectionMeta } from '../nav.jsx';
import { AREA_TITLES } from './labels.js';
import { ChangeRow, fieldLabel } from './ChangeRow.jsx';
import { changeCount } from './count.js';

function groupTitle(g) {
  if (g.key === 'models:order') return t('Catalog');
  if (g.key === 'themes') return t('Themes');
  if (g.key.startsWith('section:')) return t(sectionMeta(g.section).title);
  return g.label || t('Untitled');
}

export default function ChangesPanel({ changes, user, scope, layer, onPublished, onClose }) {
  const publisher = !!user?.canPublish;
  const [who, setWho] = useState(publisher ? 'all' : 'mine');
  const [skip, setSkip] = useState(() => new Set());
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const errorId = useId();
  const me = user?.id;

  const scoped = useMemo(() => (scope ? changes.changes.filter(scope) : changes.changes), [changes.changes, scope]);
  const mineCount = useMemo(() => scoped.filter(c => isMine(c, me)).length, [scoped, me]);
  const shown = useMemo(() => (who === 'mine' ? scoped.filter(c => isMine(c, me)) : scoped), [scoped, who, me]);
  const areas = useMemo(() => groupChanges(shown), [shown]);
  const picked = shown.filter(c => !skip.has(c.key));
  const others = othersIn(picked, me);
  const busy = !!changes.busy;
  const canDiscard = picked.length > 0 && (publisher || picked.every(c => isMine(c, me) && othersIn([c], me).length === 0));

  const toggle = (keys, on) => setSkip(cur => {
    const next = new Set(cur);
    for (const k of keys) { if (on) next.delete(k); else next.add(k); }
    return next;
  });
  const allOn = picked.length === shown.length;

  async function publish() {
    setError('');
    try {
      const r = await changes.publish(picked.map(c => c.key), note);
      toast(t('Published version {v}.', { v: r.version }));
      if (onPublished) onPublished(r);
      onClose();
    } catch (e) {
      setError(e?.message || t('The changes could not be published.'));
    }
  }

  async function discard() {
    setError('');
    try {
      await changes.discard(picked.map(c => c.key));
      setConfirming(false);
      setSkip(new Set());
      toast(t('Changes discarded.'));
    } catch (e) {
      setError(e?.message || t('The changes could not be discarded.'));
    }
  }

  const foot = confirming ? (
    <>
      <div className="ch-confirm">
        <b>{t('Discard {what}?', { what: changeCount(picked.length) })}</b>
        <span>{others.length
          ? t('This includes changes made by {names}. It cannot be undone.', { names: others.join(', ') })
          : t('This cannot be undone.')}</span>
      </div>
      <span className="cp-spacer" />
      <Btn disabled={busy} onClick={() => setConfirming(false)}>{t('Cancel')}</Btn>
      <Btn kind="danger" disabled={busy} onClick={discard}>
        {busy && <span className="btn-spin" aria-hidden="true" />}{busy ? t('Discarding…') : t('Discard')}
      </Btn>
    </>
  ) : (
    <>
      {publisher
        ? <input className="cp-input ch-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)}
          placeholder={t('Release note (optional)')} aria-label={t('Release note')}
          aria-invalid={error ? true : undefined} aria-describedby={errorId} />
        : <span className="ch-confirm"><span>{t('A publisher or the owner ships these to members.')}</span></span>}
      <span className="cp-spacer" />
      <Btn kind={publisher ? 'quiet' : undefined} disabled={busy || !canDiscard}
        data-tip={canDiscard || !picked.length ? undefined : t('Editors can only discard their own changes.')}
        onClick={() => { setError(''); setConfirming(true); }}>{t('Discard')}</Btn>
      {publisher && (
        <Btn kind="primary" disabled={busy || !picked.length} onClick={publish}>
          {changes.busy === 'publish' && <span className="btn-spin" aria-hidden="true" />}
          {changes.busy === 'publish' ? t('Publishing…') : allOn && who === 'all' ? t('Publish all') : t('Publish {what}', { what: changeCount(picked.length) })}
        </Btn>
      )}
    </>
  );

  return (
    <Dialog title={t('Review changes')} size="wide" layer={layer} onClose={onClose}
      foot={<>{foot}<div id={errorId} className="ch-error" role="alert">{error}</div></>}>
      {scoped.length === 0 ? (
        <Empty icon={CheckCircle} title={t('Nothing to publish')}>
          {t('Members are running everything in the draft.')}
        </Empty>
      ) : (
        <div className="ch">
          <div className="ch-bar">
            <Seg label={t('Show')} value={who} onChange={setWho} options={[
              { value: 'all', label: t('All changes'), badge: scoped.length },
              { value: 'mine', label: t('Mine'), badge: mineCount }
            ]} />
            <label className="ch-all">
              <input type="checkbox" checked={allOn && shown.length > 0} disabled={!shown.length}
                onChange={(e) => toggle(shown.map(c => c.key), e.target.checked)} />
              <span>{t('Select all')}</span>
            </label>
          </div>
          {shown.length === 0 && <p className="ch-quiet">{t('You have no unpublished changes.')}</p>}
          {areas.map(area => (
            <section key={area.area} className="ch-area" aria-label={t(AREA_TITLES[area.area])}>
              <h4>{t(AREA_TITLES[area.area])}</h4>
              {area.groups.map(g => {
                const on = g.items.filter(c => !skip.has(c.key)).length;
                return (
                  <div key={g.key} className="ch-group">
                    <label className="ch-group-head">
                      <input type="checkbox" checked={on === g.items.length}
                        ref={(el) => { if (el) el.indeterminate = on > 0 && on < g.items.length; }}
                        onChange={(e) => toggle(g.items.map(c => c.key), e.target.checked)} />
                      <b>{groupTitle(g)}</b>
                      <span>{changeCount(g.items.length)}</span>
                    </label>
                    <ul>
                      {g.items.map(c => (
                        <ChangeRow key={c.key} change={c} checked={!skip.has(c.key)}
                          onToggle={(v) => toggle([c.key], v)} label={fieldLabel(c)} ago={fmtAgo(c.at)} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </section>
          ))}
          {changes.version > 0 && (
            <p className="ch-quiet">
              {t('Members are on version {v}', { v: changes.version })}
              {changes.publishedBy ? ' · ' + t('published by {name}', { name: changes.publishedBy }) : ''}
              {changes.publishedAt ? ' · ' + fmtAgo(changes.publishedAt) : ''}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}