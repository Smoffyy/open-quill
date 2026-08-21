import { useState } from 'react';
import { api } from '../api.js';
import { toast } from '../toast.js';
import { Check, Trash, Sparkles } from './icons.jsx';
import { t } from '../i18n.jsx';
import { tk } from '../i18n.jsx';

export const STYLE_PRESETS = [
  { id: 'normal', name: tk('Normal'), desc: tk('Default responses') },
  { id: 'concise', name: tk('Concise'), desc: tk('Shorter, direct answers') },
  { id: 'explanatory', name: tk('Explanatory'), desc: tk('Teaches as it answers') },
  { id: 'formal', name: tk('Formal'), desc: tk('Polished and professional') }
];

export function styleNameFor(styleId, styles = []) {
  const s = STYLE_PRESETS.find(p => p.id === styleId) || styles.find(x => x.id === styleId);
  return s ? s.name : 'Normal';
}

export default function StyleSubmenu({ styles = [], styleId = 'normal', onSelect, onSaveStyles, currentId }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [sample, setSample] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);

  async function generate() {
    if (!sample.trim() || genBusy) return;
    setGenBusy(true);
    try {
      const r = await api.post('/api/styles/generate', { sample, modelId: currentId });
      setPrompt(r.prompt || '');
      toast(t('Style generated from your sample, review and save.'));
    } catch (e) { toast(e.message || t('Could not generate the style.')); }
    setGenBusy(false);
  }

  async function saveStyle() {
    if (!name.trim() || !prompt.trim() || saveBusy) return;
    setSaveBusy(true);
    const id = 'st-' + Math.random().toString(36).slice(2, 10);
    const next = [...styles, { id, name: name.trim(), prompt: prompt.trim() }];
    try {
      await onSaveStyles?.(next);
      onSelect?.(id);
      setCreating(false);
      setName(''); setPrompt(''); setSample('');
      toast(t('Style saved and selected.'));
    } catch (e) { toast(e.message || t('Could not save the style.')); }
    setSaveBusy(false);
  }

  async function removeStyle(e, id) {
    e.stopPropagation();
    try {
      await onSaveStyles?.(styles.filter(x => x.id !== id));
      if (styleId === id) onSelect?.('normal', true);
    } catch (err) { toast(err.message || t('Could not delete the style.')); }
  }

  if (creating) {
    return (
      <div className="style-create">
        <div className="style-menu-label">{t("New style")}</div>
        <input placeholder={t("Style name")} value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
        <textarea placeholder={t("Describe how the assistant should write (tone, length, formatting…)")} rows={4} value={prompt} maxLength={4000} onChange={(e) => setPrompt(e.target.value)} />
        <div className="style-gen">
          <textarea placeholder={t("Or paste a writing sample to generate the style from…")} rows={3} value={sample} maxLength={12000} onChange={(e) => setSample(e.target.value)} />
          <button className="style-gen-btn" disabled={!sample.trim() || genBusy} onClick={generate}>
            <Sparkles style={{ width: 13 }} /> {genBusy ? t('Generating…') : t('Generate from sample')}
          </button>
        </div>
        <div className="style-create-actions">
          <button className="style-cancel" onClick={() => setCreating(false)}>{t("Cancel")}</button>
          <button className="style-save" disabled={!name.trim() || !prompt.trim() || saveBusy} onClick={saveStyle}>{saveBusy ? t('Saving…') : t('Save style')}</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="style-menu-label">{t("Response style")}</div>
      {STYLE_PRESETS.map(p => (
        <button key={p.id} className={'style-item' + (p.id === styleId ? ' active' : '')} onClick={() => onSelect?.(p.id)}>
          <span className="style-item-name">{p.name}</span>
          <span className="style-item-desc">{p.desc}</span>
          {p.id === styleId && <Check style={{ width: 14 }} />}
        </button>
      ))}
      {styles.length > 0 && <div className="style-menu-label">{t("Your styles")}</div>}
      {styles.map(x => (
        <button key={x.id} className={'style-item' + (x.id === styleId ? ' active' : '')} onClick={() => onSelect?.(x.id)}>
          <span className="style-item-name">{x.name}</span>
          <span className="style-del" title={t("Delete style")} onClick={(e) => removeStyle(e, x.id)}><Trash style={{ width: 13 }} /></span>
          {x.id === styleId && <Check style={{ width: 14 }} />}
        </button>
      ))}
      <button className="style-item create" onClick={() => setCreating(true)}>{t("+ Create a style")}</button>
    </>
  );
}
