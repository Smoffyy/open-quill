import '../../../styles/models.css';
import { useMemo } from 'react';
import { useAdmin } from '../store.jsx';
import { Btn, Empty } from '../ui.jsx';
import { Cube, Plus } from '../../ui/icons.jsx';
import { t } from '../../../i18n.jsx';
import { Skel, SkelTable } from '../../ui/Skeleton.jsx';
import Catalog from '../models/Catalog.jsx';
import Inspector from '../models/Inspector.jsx';

export default function ModelsSection() {
  const { catalog, setSection } = useAdmin();
  const { models, selection, ready, createModel } = catalog;
  const chosen = useMemo(() => models.filter(m => selection.includes(m.id)), [models, selection]);

  if (!ready) return <Skel when><SkelTable cols={4} rows={7} /></Skel>;

  if (!models.length) {
    return (
      <Empty icon={Cube} title={t('The catalog is empty')}
        actions={<>
          <Btn kind="primary" onClick={createModel}><Plus /> {t('Add model')}</Btn>
          <Btn onClick={() => setSection('providers')}>{t('Set up a connection')}</Btn>
        </>}>
        {t('A model binds one provider model id to a system prompt, a set of abilities, and a price. Members pick from these in the chat.')}
      </Empty>
    );
  }

  return (
    <div className={'mc' + (chosen.length ? ' picking' : '')}>
      <Catalog />
      <Inspector models={chosen} />
    </div>
  );
}