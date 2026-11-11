import { useState, useRef } from 'react';
import { Box, ChevDown, Check } from '../ui/icons.jsx';
import { api } from '../../lib/api.js';
import { notify } from '../../lib/notify.js';
import { useDismiss } from '../../lib/dismiss.js';
import { t } from '../../i18n.jsx';

export default function SaveToProject({ saveUrl, path, projectId, projects }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, () => setOpen(false), ref);
  if (!projects.length) return null;
  const ordered = projectId ? [...projects.filter(p => p.id === projectId), ...projects.filter(p => p.id !== projectId)] : projects;
  async function save(p) {
    setOpen(false);
    try {
      const r = await api.post(saveUrl, { path, projectId: p.id });
      notify(t('Added {name} to {project}', { name: r.path, project: r.projectName }), { kind: 'success', icon: 'check' });
    } catch (e) { notify(e?.message || t('Could not add it to the project.'), { kind: 'warn' }); }
  }
  return (
    <div className="art-copy-wrap" ref={ref}>
      <button type="button" className="art-btn text fold" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        data-tip={t('Add a copy to a project, where every chat in it can read it')} aria-label={t('Add to project')}>
        <Box style={{ width: 14 }} /> <span className="art-btn-label">{t('Add to project')} <ChevDown style={{ width: 12 }} /></span>
      </button>
      {open && (
        <div className="art-menu" role="menu">
          <div className="art-menu-label">{t('Add to project')}</div>
          {ordered.map(p => (
            <button key={p.id} type="button" role="menuitem" className="art-menu-item" onClick={() => save(p)}>
              {p.name}{p.id === projectId && <Check style={{ width: 13 }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}