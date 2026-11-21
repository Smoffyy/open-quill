import { useState, useEffect, useRef } from 'react';
import { api } from '../../lib/api.js';
import { focusUnlessTouch } from '../../lib/touch.js';
import { t, tk, tp } from '../../i18n.jsx';
import Dialog from '../ui/Dialog.jsx';
import CloseButton from '../ui/CloseButton.jsx';
import { SelectRow } from '../ui/controls.jsx';
import { Users, Trash, Logout, Plus } from '../ui/icons.jsx';
import { Skel, SkelRows } from '../ui/Skeleton.jsx';

const LEVEL_LABELS = { view: tk('Can view'), edit: tk('Can edit'), manage: tk('Can edit and share'), owner: tk('Owner') };
const SEARCH_DELAY_MS = 200;
const trail = (path) => path.map(g => g.name).join(' › ');
const reasonText = (r) => (r.type === 'direct' ? t('Shared with them directly') : t('Through {path}', { path: trail(r.path) }));

function Who({ group, name, sub }) {
  return (
    <span className="share-who">
      <strong>{group && <Users aria-hidden="true" />}{name}</strong>
      {sub && <span>{sub}</span>}
    </span>
  );
}

export default function ShareDialog({ type, id, title, onClose, onLeft }) {
  const [info, setInfo] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState({ people: [], groups: [] });
  const [level, setLevel] = useState('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `/api/shares/${type}/${id}`;
  const canShare = !!info?.canShare;
  const inputRef = useRef(null);

  useEffect(() => { if (canShare) focusUnlessTouch(inputRef.current); }, [canShare]);

  useEffect(() => {
    let alive = true;
    api.get(base).then(d => { if (alive) setInfo(d); }).catch(e => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [base]);

  useEffect(() => {
    if (!canShare) return undefined;
    const timer = setTimeout(() => {
      api.get('/api/directory?q=' + encodeURIComponent(q.trim()))
        .then(d => setFound({ people: d.people || [], groups: d.groups || [] }))
        .catch(() => setFound({ people: [], groups: [] }));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [q, canShare]);

  async function send(method, body) {
    setBusy(true);
    setError('');
    try {
      const next = await api[method](base, body);
      if (next.left) {
        onLeft?.();
        onClose();
        return false;
      }
      setInfo(next);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const levels = info?.levels || ['view'];
  const options = levels.map(v => ({ v, label: t(LEVEL_LABELS[v]) }));
  const taken = new Set((info?.grants || []).map(g => g.principalType + ':' + g.principalId));
  const results = [
    ...found.groups.map(g => ({ type: 'group', id: g.id, name: g.name, sub: tp(g.members, '{n} member', '{n} members') })),
    ...found.people.map(p => ({ type: 'user', id: p.id, name: p.name, sub: p.email }))
  ].filter(r => !taken.has(r.type + ':' + r.id));

  return (
    <Dialog className="share-modal" labelledBy="share-title" onClose={onClose}>
      <div className="share-head">
        <h3 id="share-title">{info && !canShare ? t('Access to “{name}”', { name: title || t('Untitled') }) : t('Share “{name}”', { name: title || t('Untitled') })}</h3>
        <CloseButton plain className="modal-close" onClick={onClose} />
      </div>
      <p className="share-error" role="alert">{error}</p>
      {!info ? <Skel when><SkelRows count={4} /></Skel> : (
        <>
          {canShare && (
            <div className="share-find">
              <input ref={inputRef} className="share-input" type="search" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={t('Find people or groups')} aria-label={t('Find people or groups')} />
              {levels.length > 1 && <SelectRow value={level} options={options} onPick={setLevel} label={t('Access to give')} />}
            </div>
          )}
          {canShare && results.length > 0 && (
            <div className="share-list share-results">
              {results.map(r => (
                <div key={r.type + ':' + r.id} className="share-row">
                  <Who group={r.type === 'group'} name={r.name} sub={r.sub} />
                  <button className="btn share-add" disabled={busy} onClick={async () => { if (await send('put', { principalType: r.type, principalId: r.id, level })) setQ(''); }}>
                    <Plus aria-hidden="true" /> {t('Add')}
                  </button>
                </div>
              ))}
            </div>
          )}
          <section className="share-section" aria-labelledby="share-who-title">
            <h4 id="share-who-title">{t('Who has access')}</h4>
            <div className="share-list">
              {info.owner && (
                <div className="share-row">
                  <Who name={info.owner.name} sub={info.owner.email} />
                  <span className="share-level">{t('Owner')}</span>
                </div>
              )}
              {info.grants.map(g => (
                <div key={g.principalType + ':' + g.principalId} className="share-row">
                  <Who group={g.principalType === 'group'} name={g.name || t('Removed account')} sub={g.principalType === 'group' ? t('Group') : g.email} />
                  {canShare && levels.length > 1
                    ? <SelectRow value={g.level} options={options} label={t('Access for {who}', { who: g.name })}
                        onPick={(v) => send('put', { principalType: g.principalType, principalId: g.principalId, level: v })} />
                    : <span className="share-level">{t(LEVEL_LABELS[g.level])}</span>}
                  <button className="action-btn" disabled={busy}
                    onClick={() => send('del', { principalType: g.principalType, principalId: g.principalId })}
                    aria-label={canShare ? t('Remove access for {who}', { who: g.name }) : t('Leave')}
                    data-tip={canShare ? t('Remove access') : t('Leave')}>
                    {canShare ? <Trash /> : <Logout />}
                  </button>
                </div>
              ))}
            </div>
          </section>
          {!canShare && <p className="share-note">{t('Your access: {level}', { level: t(LEVEL_LABELS[info.level]) })}</p>}
          {canShare && info.people.length > 0 && (
            <details className="share-section share-people">
              <summary>{t('Everyone with access ({n})', { n: info.people.length })}</summary>
              <div className="share-list">
                {info.people.map(p => (
                  <div key={p.id} className="share-row">
                    <Who name={p.name} sub={p.reasons.map(reasonText).join(' · ')} />
                    <span className="share-level">{t(LEVEL_LABELS[p.level])}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </Dialog>
  );
}