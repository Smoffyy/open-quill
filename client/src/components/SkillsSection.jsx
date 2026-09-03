import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { toast } from '../toast.js';
import Markdown from './Markdown.jsx';
import { Search, X, ChevDown, Chevron, Plus, Trash, Info, Wand, FileText, Upload, Eye, CodeTag, DotsV, Chat } from './icons.jsx';
import { Switch } from './settingsui.jsx';
import { t, tk } from '../i18n.jsx';
import { useAnchoredMenu, menuStyleOf } from '../lib/anchor.js';

const STARTERS = [
  { name: 'brand-voice', description: tk('Keep every draft in your own voice: tone, vocabulary and the phrases you never use.'), body: '# Brand voice\n\nUse this skill whenever you write anything the user will send or publish.\n\n## Tone\n\n- Plain, direct sentences. No filler openings.\n- Prefer the active voice.\n\n## Never\n\n- Never open with "Great question".\n- Never use em dashes.\n' },
  { name: 'code-review', description: tk('Review a diff for correctness first, then for simplification, with a fixed report shape.'), body: '# Code review\n\nUse this skill when the user asks for a review of a diff, branch or file.\n\n## Order\n\n1. Correctness bugs that would break at runtime.\n2. Reuse: something in the tree already does this.\n3. Simplification.\n\n## Report\n\nOne line per finding: `file:line` then the defect, then the failing input.\n' },
  { name: 'meeting-notes', description: tk('Turn a raw transcript into decisions, owners and open questions.'), body: '# Meeting notes\n\nUse this skill when given a transcript or rough notes.\n\n## Output\n\n**Decisions**: what was actually settled.\n**Owners**: who has the next action, and by when.\n**Open**: what is still unresolved.\n\nLeave out anything that is neither a decision nor an action.\n' },
  { name: 'sql-helper', description: tk('Write and explain SQL against a schema the user pastes, with the query plan in mind.'), body: '# SQL helper\n\nUse this skill when the user asks for a query.\n\n1. Restate the schema you are working against.\n2. Write the query.\n3. Say which index it relies on.\n\nNever return a query that scans a table the user said was large.\n' },
  { name: 'changelog', description: tk('Turn commits into release notes grouped by what the reader can now do.'), body: '# Changelog\n\nUse this skill when asked for release notes.\n\nGroup by **Added / Changed / Fixed**. One line each, written from the reader’s point of view, not the commit’s.\n' },
  { name: 'test-writer', description: tk('Write tests that fail for the right reason before they pass.'), body: '# Test writer\n\nUse this skill when asked to add tests.\n\n- Cover the boundary, not the happy path twice.\n- Assert on behaviour, never on the shape of an internal call.\n- Name the test after the condition it protects.\n' }
];

const BLANK = { name: '', description: '', body: '' };

const shortDate = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });

function useSkills() {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => api.get('/api/skills')
    .then(r => setSkills(r.skills || []))
    .catch(() => setSkills([]))
    .finally(() => setLoading(false)), []);
  useEffect(() => { load(); }, [load]);
  return { skills, loading, load };
}

function AddMenu({ btnRef, onClose, onPick }) {
  const menuRef = useRef(null);
  const pos = useAnchoredMenu(true, () => onClose(), btnRef, menuRef, { align: 'right', gap: 6, minWidth: 224 });
  return createPortal(
    <div className="popover sk-menu" ref={menuRef} role="menu" style={menuStyleOf(pos, { width: 224 })}>
      <button role="menuitem" onClick={() => onPick('generate')}><Wand /> {t('Create with the assistant')}</button>
      <button role="menuitem" onClick={() => onPick('write')}><FileText /> {t('Write skill instructions')}</button>
      <button role="menuitem" onClick={() => onPick('upload')}><Upload /> {t('Upload a skill')}</button>
    </div>, document.body);
}

function RowMenu({ btnRef, onClose, onTry, onRemove, editable }) {
  const menuRef = useRef(null);
  const pos = useAnchoredMenu(true, () => onClose(), btnRef, menuRef, { align: 'right', gap: 6, minWidth: 168 });
  return createPortal(
    <div className="popover sk-menu" ref={menuRef} role="menu" style={menuStyleOf(pos, { width: 168 })}>
      <button role="menuitem" onClick={onTry}><Chat /> {t('Try in chat')}</button>
      {editable && <button role="menuitem" className="danger" onClick={onRemove}><Trash /> {t('Remove')}</button>}
    </div>, document.body);
}

function SkillDetail({ skill, onBack, onChanged, onRemoved, onTry }) {
  const [view, setView] = useState('preview');
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const menuBtn = useRef(null);

  async function toggle(on) {
    if (!skill.editable) { toast(t('Workspace skills are managed in the admin panel.')); return; }
    setBusy(true);
    try { const s = await api.patch('/api/skills/' + skill.id, { enabled: on }); onChanged(s); }
    catch { toast(t('Could not update the skill.')); }
    finally { setBusy(false); }
  }

  async function remove() {
    setMenu(false);
    try { await api.del('/api/skills/' + skill.id); onRemoved(skill); }
    catch { toast(t('Could not remove the skill.')); }
  }

  return (
    <>
      <div className="sk-head">
        <button className="sk-back" onClick={onBack}><Chevron className="sk-back-chev" /> {t('Skills')}</button>
      </div>
      <div className="sk-detail">
        <div className="sk-detail-top">
          <div className="sk-detail-id">
            <div className="sk-detail-name">
              <span className="sk-detail-title">{skill.name}</span>
              <span className="sk-detail-info" title={t('Details')} aria-label={t('Details')}><Info /></span>
            </div>
            <div className="sk-detail-by">{t('by {author}', { author: skill.author || t('You') })}</div>
          </div>
          <div className="sk-detail-acts">
            <Switch on={skill.enabled} onToggle={() => toggle(!skill.enabled)} disabled={busy || !skill.editable}
              label={skill.enabled ? t('Disable skill') : t('Enable skill')} />
            <button className="sk-icon-btn" ref={menuBtn} onClick={() => setMenu(m => !m)}
              aria-haspopup="menu" aria-expanded={menu} aria-label={t('Skill options')}><DotsV /></button>
            {menu && <RowMenu btnRef={menuBtn} editable={skill.editable} onClose={() => setMenu(false)}
              onTry={() => { setMenu(false); onTry(skill); }} onRemove={remove} />}
          </div>
        </div>
        {skill.description && <p className="sk-detail-desc">{skill.description}</p>}
        <div className="sk-doc">
          <div className="sk-doc-toggle">
            <button className={'sk-doc-btn' + (view === 'preview' ? ' on' : '')} onClick={() => setView('preview')}
              aria-label={t('Preview')} title={t('Preview')}><Eye /></button>
            <button className={'sk-doc-btn' + (view === 'source' ? ' on' : '')} onClick={() => setView('source')}
              aria-label={t('Source')} title={t('Source')}><CodeTag /></button>
          </div>
          <div className="sk-doc-body">
            {view === 'preview'
              ? <Markdown>{skill.body || ''}</Markdown>
              : <pre className="sk-source">{(skill.file || '').split('\n').map((line, i) => (
                  <span key={i} className="sk-source-line"><span className="sk-source-no">{i + 1}</span>{line || ' '}</span>
                ))}</pre>}
          </div>
        </div>
      </div>
    </>
  );
}

function SkillEditor({ draft, onDraft, onCancel, onSave, saving }) {
  return (
    <>
      <div className="sk-head">
        <button className="sk-back" onClick={onCancel}><Chevron className="sk-back-chev" /> {t('Skills')}</button>
        <div className="sk-head-acts">
          <button className="sk-btn" onClick={onCancel}>{t('Cancel')}</button>
          <button className="sk-btn primary" onClick={onSave} disabled={saving}>{t('Save skill')}</button>
        </div>
      </div>
      <div className="sk-detail">
        <label className="sk-field">
          <span className="sk-field-label">{t('Name')}</span>
          <input className="sk-input" value={draft.name} placeholder="my-skill" spellCheck={false}
            onChange={(e) => onDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="sk-field">
          <span className="sk-field-label">{t('Description')}</span>
          <input className="sk-input" value={draft.description} placeholder={t('When should the assistant reach for this?')}
            onChange={(e) => onDraft({ ...draft, description: e.target.value })} />
        </label>
        <label className="sk-field">
          <span className="sk-field-label">{t('Instructions')}</span>
          <textarea className="sk-input sk-textarea" value={draft.body} spellCheck={false} rows={16}
            placeholder={'# My skill\n\nUse this skill when…'}
            onChange={(e) => onDraft({ ...draft, body: e.target.value })} />
        </label>
      </div>
    </>
  );
}

function Directory({ installed, onClose, onInstall }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('popular');
  const have = useMemo(() => new Set(installed.map(s => s.name)), [installed]);
  const needle = q.trim().toLowerCase();
  const shown = STARTERS
    .filter(s => !needle || s.name.includes(needle) || t(s.description).toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : 0));

  return createPortal(
    <div className="overlay sk-dir-overlay" onMouseDown={(e) => e.target.classList.contains('sk-dir-overlay') && onClose()}>
      <div className="sk-dir" role="dialog" aria-label={t('Directory')}>
        <div className="sk-dir-head">
          <h2 className="sk-dir-title">{t('Directory')}</h2>
          <button className="sk-icon-btn" onClick={onClose} aria-label={t('Close')}><X /></button>
        </div>
        <div className="sk-dir-body">
          <nav className="sk-dir-nav" aria-label={t('Directory sections')}>
            <button className="sk-dir-tab on"><FileText /> {t('Skills')}</button>
          </nav>
          <div className="sk-dir-main">
            <div className="sk-dir-search">
              <Search />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Search skills…')} aria-label={t('Search skills')} />
            </div>
            <div className="sk-dir-bar">
              <span className="sk-dir-chip">{t('Starters')}</span>
              <button className="sk-pill" onClick={() => setSort(s => (s === 'popular' ? 'name' : 'popular'))}>
                {t('Sort by')} <ChevDown />
              </button>
            </div>
            <ul className="sk-dir-grid">
              {shown.map(s => (
                <li key={s.name}>
                  <div className="sk-card">
                    <div className="sk-card-body">
                      <div className="sk-card-head">
                        <span className="sk-card-name">/{s.name}</span>
                      </div>
                      <span className="sk-card-meta">{t('Starters')}</span>
                      <p className="sk-card-desc">{t(s.description)}</p>
                    </div>
                    <button className="sk-card-add" disabled={have.has(s.name)}
                      aria-label={have.has(s.name) ? t('Already added') : t('Add skill')}
                      title={have.has(s.name) ? t('Already added') : t('Add skill')}
                      onClick={() => onInstall(s)}>{have.has(s.name) ? <Chevron /> : <Plus />}</button>
                  </div>
                </li>
              ))}
            </ul>
            {shown.length === 0 && <div className="sk-empty">{t('Nothing matches that.')}</div>}
          </div>
        </div>
      </div>
    </div>, document.body);
}

export default function SkillsSection({ onTrySkill }) {
  const { skills, loading, load } = useSkills();
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [addMenu, setAddMenu] = useState(false);
  const [dir, setDir] = useState(false);
  const addBtn = useRef(null);
  const fileRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => { if (searchOpen && searchRef.current) searchRef.current.focus(); }, [searchOpen]);

  const open = skills.find(s => s.id === openId) || null;
  const needle = q.trim().toLowerCase();
  const shown = needle
    ? skills.filter(s => s.name.includes(needle) || (s.description || '').toLowerCase().includes(needle))
    : skills;

  async function save() {
    setSaving(true);
    try {
      const saved = editing === 'new'
        ? await api.post('/api/skills', draft)
        : await api.patch('/api/skills/' + editing, draft);
      await load();
      setEditing(null); setOpenId(saved.id);
    } catch (e) { toast(e?.message || t('Could not save the skill.')); }
    finally { setSaving(false); }
  }

  async function install(starter) {
    try {
      await api.post('/api/skills', { name: starter.name, description: t(starter.description), body: starter.body, source: 'directory' });
      await load();
    } catch (e) { toast(e?.message || t('Could not add the skill.')); }
  }

  function pickAdd(kind) {
    setAddMenu(false);
    if (kind === 'upload') { fileRef.current?.click(); return; }
    if (kind === 'generate') { setDir(true); return; }
    setDraft(BLANK); setEditing('new');
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const text = await f.text();
      await api.post('/api/skills', { file: text, name: f.name.replace(/\.(md|markdown|txt)$/i, '') });
      await load();
    } catch (err) { toast(err?.message || t('Could not read that file.')); }
  }

  if (editing) {
    return <SkillEditor draft={draft} onDraft={setDraft} saving={saving}
      onCancel={() => setEditing(null)} onSave={save} />;
  }

  if (open) {
    return <SkillDetail skill={open} onTry={onTrySkill}
      onBack={() => setOpenId(null)}
      onChanged={() => load()}
      onRemoved={() => { setOpenId(null); load(); }} />;
  }

  return (
    <>
      <div className="sk-head">
        <h2 className="sk-title">{t('Skills')}</h2>
        {searchOpen ? (
          <div className="sk-search">
            <Search />
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={t('Search skills')} aria-label={t('Search skills')} />
            <button className="sk-search-x" onClick={() => { setQ(''); setSearchOpen(false); }} aria-label={t('Clear')}><X /></button>
          </div>
        ) : (
          <button className="sk-icon-btn" onClick={() => setSearchOpen(true)} aria-label={t('Search skills')}><Search /></button>
        )}
        <div className="sk-head-acts">
          <button className="sk-btn" onClick={() => setDir(true)}>{t('Browse')}</button>
          <button className="sk-btn" ref={addBtn} onClick={() => setAddMenu(m => !m)}
            aria-haspopup="menu" aria-expanded={addMenu}>{t('Add')} <ChevDown /></button>
          {addMenu && <AddMenu btnRef={addBtn} onClose={() => setAddMenu(false)} onPick={pickAdd} />}
        </div>
      </div>

      <div className="sk-table-wrap">
        {loading ? null : shown.length === 0 ? (
          <div className="sk-empty">{needle ? t('Nothing matches that.') : t('No skills yet.')}</div>
        ) : (
          <table className="sk-table">
            <thead>
              <tr>
                <th>{t('Skill')}</th>
                <th>{t('Last updated')}</th>
                <th>{t('Author')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(s => (
                <tr key={s.id} onClick={() => setOpenId(s.id)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(s.id); } }}
                  className={s.enabled ? '' : 'off'}>
                  <td><div className="sk-cell-name"><span>{s.name}</span></div></td>
                  <td>{s.updated_at ? shortDate(s.updated_at) : '-'}</td>
                  <td>{s.author}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain"
        style={{ display: 'none' }} onChange={onFile} />
      {dir && <Directory installed={skills} onClose={() => setDir(false)} onInstall={install} />}
    </>
  );
}

