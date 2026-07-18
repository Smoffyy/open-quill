import React, { useState, useEffect } from 'react';
import { api } from '../../../api.js';
import { Plus, Trash, Pencil, Bulb } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

export default function SkillsSection() {
  const [skills, setSkills] = useState([]);
  const [edit, setEdit] = useState(null);

  useEffect(() => {
    (async () => { try { const d = await api.get('/api/admin/skills'); setSkills(d.skills || []); } catch {} })();
  }, []);

  async function save(sk) {
    try {
      if (sk.id) { const r = await api.patch('/api/admin/skills/' + sk.id, sk); setSkills(list => list.map(x => x.id === sk.id ? r.skill : x)); }
      else { const r = await api.post('/api/admin/skills', sk); setSkills(list => [...list, r.skill]); }
      setEdit(null);
    } catch (e) { alert(e.message || 'Could not save skill.'); }
  }
  async function remove(id) { try { await api.del('/api/admin/skills/' + id); setSkills(list => list.filter(x => x.id !== id)); } catch {} }
  async function toggle(sk) { try { const r = await api.patch('/api/admin/skills/' + sk.id, { enabled: !sk.enabled }); setSkills(list => list.map(x => x.id === sk.id ? r.skill : x)); } catch {} }

  return (
    <>
      <div className="admin-section-head">
        <div><div className="muted-note">Skills are markdown instruction files listed in the system prompt. When a task matches a skill's description, the model loads it with <code>skill_view</code> and follows it. Offered to any model with tool calling.</div></div>
        <button className="btn primary" onClick={() => setEdit({ name: '', description: '', content: '', enabled: true })}><Plus style={{ width: 15 }} /> New skill</button>
      </div>
      {edit && (
        <div className="fn-editor">
          <div className="field"><label>{t("Skill name")}</label>
            <input value={edit.name} onChange={(e) => setEdit(x => ({ ...x, name: e.target.value }))} placeholder={t("brand-voice")} />
            <div className="muted-note">{t("Lowercase letters, digits, hyphens. This is the name the model loads.")}</div>
          </div>
          <div className="field"><label>{t("Description")}</label>
            <input value={edit.description} onChange={(e) => setEdit(x => ({ ...x, description: e.target.value }))} placeholder={t("How to write copy in our brand voice. Load before writing any marketing text.")} />
            <div className="muted-note">{t("Shown in the system prompt, tell the model exactly WHEN to load this skill.")}</div>
          </div>
          <div className="field"><label>{t("Content")}</label>
            <textarea className="code-area" rows={14} value={edit.content} onChange={(e) => setEdit(x => ({ ...x, content: e.target.value }))} spellCheck={false} placeholder={'# Brand voice\n\nAlways…'} />
            <div className="muted-note">{t("Markdown works well. The full content is returned to the model when it loads the skill.")}</div>
          </div>
          <div className="med-toggle-card">
            <label className="inline-toggle"><span>Enabled</span><div className={'switch' + (edit.enabled ? ' on' : '')} onClick={() => setEdit(x => ({ ...x, enabled: !x.enabled }))} /></label>
          </div>
          <div className="editor-actions">
            <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn primary" onClick={() => save(edit)}>Save skill</button>
          </div>
        </div>
      )}
      <div className="fn-list">
        {skills.length === 0 && !edit && <div className="muted-note">{t("No skills yet.")}</div>}
        {skills.map(sk => (
          <div key={sk.id} className="fn-card">
            <div className="fn-card-main">
              <div className="fn-card-title"><Bulb style={{ width: 15 }} /> <code>{sk.name}</code> <span className="muted-note" style={{ display: 'inline' }}>{(sk.content || '').split('\n').length} lines</span></div>
              <div className="fn-card-desc">{sk.description || 'No description.'}</div>
            </div>
            <div className="fn-card-actions">
              <div className={'switch' + (sk.enabled ? ' on' : '')} title={t("Enabled")} onClick={() => toggle(sk)} />
              <button className="icon-btn" onClick={() => setEdit({ ...sk })}><Pencil style={{ width: 15 }} /></button>
              <button className="icon-btn" onClick={() => remove(sk.id)}><Trash style={{ width: 15 }} /></button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
