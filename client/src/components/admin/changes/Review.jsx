import { useAdmin } from '../store.jsx';
import { Btn } from '../ui.jsx';
import { t } from '../../../i18n.jsx';
import { sectionMeta } from '../nav.jsx';
import { changeCount } from './count.js';
import ChangesPanel from './ChangesPanel.jsx';

const initialOf = (name) => (String(name || '').trim()[0] || '?');

export function Faces({ people, small, where = false }) {
  if (!people?.length) return null;
  const shown = people.slice(0, 4);
  const rest = people.length - shown.length;
  const names = people.map(p => p.name).join(', ');
  return (
    <span className="cp-who" role="img" aria-label={t('Also here: {names}', { names })}>
      {shown.map(p => (
        <span key={p.id} className={'cp-who-face' + (small ? ' sm' : '')} aria-hidden="true"
          title={where && p.section ? p.name + ' · ' + t(sectionMeta(p.section).title) : p.name}>
          {initialOf(p.name)}
        </span>
      ))}
      {rest > 0 && <span className={'cp-who-face' + (small ? ' sm' : '')} aria-hidden="true" title={names}>+{rest}</span>}
    </span>
  );
}

export function ReviewButton() {
  const { changes, setReviewing } = useAdmin();
  const n = changes.changes.length;
  return (
    <Btn kind={n ? 'primary' : undefined} className="cp-review" disabled={!changes.ready} onClick={() => setReviewing(true)}
      title={n ? changeCount(n) : t('Members are running everything in the draft.')}>
      {t('Review changes')}
      {n > 0 && <span className="cp-review-n" aria-hidden="true">{n}</span>}
      {n > 0 && <span className="sr-only">{changeCount(n)}</span>}
    </Btn>
  );
}

export function ReviewDialog() {
  const { changes, user, reviewing, setReviewing } = useAdmin();
  if (!reviewing) return null;
  return <ChangesPanel changes={changes} user={user} onClose={() => setReviewing(false)} />;
}