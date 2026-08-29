import { useState, useEffect } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Block, Fields, Field, Input, Area, Btn, Table, Switch, Empty, Dialog, Note } from '../ui.jsx';
import { Plus, Trash, Pencil } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

const BLANK = { name: '', description: '', content: '', enabled: true };

export default function SkillsSection() {
  const { confirm } = useAdmin();
  const [skills, setSkills] = useState(null);
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try { const d = await api.get('/api/admin/skills'); setSkills(d.skills || []); }
      catch { setSkills([]); }
    })();
  }, []);

  async function save() {
    setError('');
    try {
      if (draft.id) {
        const r = await api.patch('/api/admin/skills/' + draft.id, draft);
        setSkills(list => list.map(x => (x.id === draft.id ? r.skill : x)));
      } else {
        const r = await api.post('/api/admin/skills', draft);
        setSkills(list => [...list, r.skill]);
      }
      setDraft(null);
    } catch (e) { setError(e.message || t('Could not save that skill.')); }
  }

  async function toggle(sk) {
    try {
      const r = await api.patch('/api/admin/skills/' + sk.id, { enabled: !sk.enabled });
      setSkills(list => list.map(x => (x.id === sk.id ? r.skill : x)));
    } catch {}
  }

  function del(sk) {
    confirm({
      title: t('Delete skill'),
      message: t('Models will stop being offered “{name}”. Chats that already used it are unaffected.', { name: sk.name }),
      confirm: t('Delete skill'),
      onConfirm: async () => {
        try { await api.del('/api/admin/skills/' + sk.id); setSkills(list => list.filter(x => x.id !== sk.id)); } catch {}
      }
    });
  }

  const valid = draft && draft.name.trim() && draft.description.trim();

  return (
    <>
      <Block
        sub={t('Every enabled skill is listed in the system prompt as a name and a description. When a task matches one, the model calls skill_view to read it in full and follows it. Offered to any model with tool calling.')}
        actions={<Btn kind="primary" size="sm" onClick={() => { setDraft({ ...BLANK }); setError(''); }}>
          <Plus /> {t('New skill')}
        </Btn>}>
        {skills == null && <Empty title={t('Loading')} />}
        {skills != null && skills.length === 0 && (
          <Empty title={t('No skills defined')}>
            {t('A skill is a written procedure the model pulls in on demand, so the instructions cost nothing until they are needed.')}
          </Empty>
        )}
        {skills != null && skills.length > 0 && (
          <Table head={[
            { label: t('Name'), mono: true, fit: true },
            { label: t('Loads when') },
            { label: t('Lines'), num: true, fit: true },
            { label: t('Enabled'), fit: true },
            { label: '', fit: true }
          ]}>
            {skills.map(sk => (
              <tr key={sk.id}>
                <td className="mono">{sk.name}</td>
                <td className="dim">{sk.description || t('no description')}</td>
                <td className="num mono">{(sk.content || '').split('\n').length}</td>
                <td className="fit">
                  <Switch on={sk.enabled} label={t('Enabled')} onToggle={() => toggle(sk)} />
                </td>
                <td className="acts">
                  <Btn size="sm" title={t('Edit')} aria-label={t('Edit')} onClick={() => { setDraft({ ...sk }); setError(''); }}><Pencil /></Btn>
                  {' '}
                  <Btn size="sm" kind="danger" title={t('Delete')} aria-label={t('Delete')} onClick={() => del(sk)}><Trash /></Btn>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Block>

      {draft && (
        <Dialog title={draft.id ? t('Edit skill') : t('New skill')} onClose={() => setDraft(null)}
          foot={<>
            <Btn onClick={() => setDraft(null)}>{t('Cancel')}</Btn>
            <Btn kind="primary" disabled={!valid} onClick={save}>{t('Save skill')}</Btn>
          </>}>
          <Fields>
            <Field label={t('Name')} hint={t('Lowercase letters, digits, and hyphens. This is the identifier the model loads.')}>
              <Input mono value={draft.name} placeholder="brand-voice"
                onChange={(e) => setDraft(d => ({ ...d, name: e.target.value }))} />
            </Field>
            <Field label={t('Loads when')}
              hint={t('The only thing the model sees before loading, so describe the trigger, not the content.')}>
              <Input value={draft.description}
                placeholder={t('Writing any customer-facing marketing copy.')}
                onChange={(e) => setDraft(d => ({ ...d, description: e.target.value }))} />
            </Field>
            <Field label={t('Instructions')} hint={t('Markdown. Returned in full when the model loads the skill.')}>
              <Area mono rows={14} spellCheck={false} value={draft.content}
                placeholder={'# Brand voice\n\nAlways…'}
                onChange={(e) => setDraft(d => ({ ...d, content: e.target.value }))} />
            </Field>
          </Fields>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Switch on={draft.enabled} label={t('Enabled')} onToggle={() => setDraft(d => ({ ...d, enabled: !d.enabled }))} />
            <span>{t('Offer this skill to models')}</span>
          </div>
          {error && <div style={{ marginTop: 12 }}><Note tone="bad">{error}</Note></div>}
        </Dialog>
      )}
    </>
  );
}
