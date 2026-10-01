import { useAdmin } from './store.jsx';
import { Btn } from './ui.jsx';
import { t } from '../../i18n.jsx';

// Model edits are staged, so the panel always says whether what admins see and
// what members are running have diverged. The top bar and the overview show the
// same control with the same label, because they are the same control.
export function PublishState() {
  const { catalog, revertAll } = useAdmin();
  const { draft, publishing, publish, reverting } = catalog;
  const settled = !draft.dirty && draft.published;
  const busy = publishing || reverting;
  return (
    <div className="cp-publish">
      <span className="cp-state">
        <span className={'cp-dot' + (draft.dirty ? ' pending' : draft.published ? ' live' : '')} />
        {draft.dirty ? t('Unpublished changes') : draft.published ? t('Live') : t('Not published')}
      </span>
      {draft.published && (
        <Btn kind="quiet" disabled={busy || settled} onClick={revertAll}
          title={settled ? t('Nothing to revert') : t('Discard every unpublished change')}>
          {reverting ? t('Reverting…') : t('Revert all')}
        </Btn>
      )}
      <Btn kind="primary" disabled={busy || settled} onClick={publish}
        title={settled ? t('Everything is published') : t('Send catalog changes to every client')}>
        {publishing ? t('Publishing…') : t('Publish')}
      </Btn>
    </div>
  );
}
