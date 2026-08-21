import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../i18n.jsx';
import { SetRow, SegSlide } from './settingsui.jsx';
import { Download, Upload } from './icons.jsx';
import {
  KEYBIND_ACTIONS, KEYBIND_GROUPS, KEYBIND_PREF, KEYBIND_PRESETS,
  activePresetId, comboFromEvent, comboKeys, customKeybinds, exportKeybinds,
  importKeybinds, isReservedCombo, isValidCombo, keybindConflicts, presetBinds, resolveKeybinds,
} from '../lib/keybinds.js';

function Keys({ combo }) {
  const keys = comboKeys(combo);
  if (!keys.length) return <span className="kb-none">{t('Not set')}</span>;
  return <span className="kbd-row">{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</span>;
}

export default function KeybindsPanel({ prefs, setPref }) {
  const [recording, setRecording] = useState('');
  const [msg, setMsg] = useState('');
  const importRef = useRef(null);
  const binds = useMemo(() => resolveKeybinds(prefs), [prefs]);
  const custom = useMemo(() => customKeybinds(prefs), [prefs]);
  const conflicts = useMemo(() => keybindConflicts(binds), [binds]);
  const preset = useMemo(() => activePresetId(prefs), [prefs]);
  const dirty = Object.keys(custom).length;
  const byCombo = useMemo(() => {
    const m = new Map();
    for (const a of KEYBIND_ACTIONS) {
      if (!m.has(binds[a.id])) m.set(binds[a.id], []);
      m.get(binds[a.id]).push(a);
    }
    return m;
  }, [binds]);

  function assign(id, combo) {
    const action = KEYBIND_ACTIONS.find(a => a.id === id);
    if (!action || action.fixed) return;
    const next = { ...custom };
    if (!combo || combo === action.def) delete next[id];
    else next[id] = combo;
    setPref(KEYBIND_PREF, next);
  }

  useEffect(() => {
    if (!recording) return;
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(''); return; }
      const combo = comboFromEvent(e);
      if (!combo || !isValidCombo(combo)) return;
      assign(recording, combo);
      setRecording('');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, custom]);

  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(''), 2600);
    return () => clearTimeout(id);
  }, [msg]);

  function doExport() {
    const blob = new Blob([JSON.stringify(exportKeybinds(prefs), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'open-quill-keybinds.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function doImport(file) {
    try {
      const parsed = importKeybinds(JSON.parse(await file.text()));
      if (!parsed) { setMsg(t('That file did not contain any shortcuts.')); return; }
      setPref(KEYBIND_PREF, parsed);
      setMsg(t('Imported {n} shortcut(s).', { n: Object.keys(parsed).length }));
    } catch { setMsg(t('That file could not be read.')); }
  }

  return (
    <>
      <h2>{t('Keybinds')}</h2>
      <div className="hint">{t('Override any shortcut. Click Change, then press the combination you want. Press Esc to cancel.')}</div>
      <SetRow label={t('Preset')} desc={t('Replaces every override at once. Individual keys stay editable.')}>
        <SegSlide label={t('Preset')} value={preset || 'custom'}
          onPick={(v) => { if (v !== 'custom') setPref(KEYBIND_PREF, presetBinds(v)); }}
          options={KEYBIND_PRESETS.map(p => ({ v: p.id, label: t(p.label) })).concat(preset ? [] : [{ v: 'custom', label: t('Custom') }])} />
      </SetRow>
      <div className="kb-panel">
        {KEYBIND_GROUPS.map(group => {
          const rows = KEYBIND_ACTIONS.filter(a => a.group === group);
          if (!rows.length) return null;
          return (
            <div className="kb-group" key={group}>
              <div className="kb-group-title">{t(group)}</div>
              {rows.map(a => {
                const combo = binds[a.id];
                const listening = recording === a.id;
                const disabled = a.pref && prefs?.[a.pref] === false;
                const clash = !disabled && conflicts.has(combo)
                  ? (byCombo.get(combo) || []).filter(x => x.id !== a.id).map(x => t(x.label)).join(', ')
                  : '';
                return (
                  <div className={'kb-row' + (disabled ? ' off' : '')} key={a.id}>
                    <div className="kb-info">
                      <span className="kb-label">{t(a.label)}</span>
                      {disabled && <span className="kb-note">{t('Turned off in Chat settings')}</span>}
                      {!!clash && <span className="kb-note warn">{t('Also bound to')} {clash}</span>}
                      {!disabled && !clash && isReservedCombo(combo) && <span className="kb-note warn">{t('Your browser may claim this one')}</span>}
                    </div>
                    <div className="kb-controls">
                      {listening ? <span className="kb-listening">{t('Press keys…')}</span> : <Keys combo={combo} />}
                      {a.fixed ? (
                        <span className="kb-locked">{t('Fixed')}</span>
                      ) : (
                        <>
                          <button className="btn ghost sm" onClick={() => setRecording(listening ? '' : a.id)}>
                            {listening ? t('Cancel') : t('Change')}
                          </button>
                          <button className="btn ghost sm" disabled={!custom[a.id]} onClick={() => assign(a.id, '')}>{t('Reset')}</button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="field row">
        <div>
          <label>{t('Back up your shortcuts')}</label>
          <div className="muted-note">{t('Save your overrides as a file, or load a set from another device.')}</div>
          {!!msg && <div className="muted-note">{msg}</div>}
        </div>
        <button className="btn ghost" onClick={doExport}><Download style={{ width: 14, verticalAlign: '-2px' }} /> {t('Export')}</button>
        <button className="btn ghost" onClick={() => importRef.current?.click()}><Upload style={{ width: 14, verticalAlign: '-2px' }} /> {t('Import')}</button>
        <input ref={importRef} type="file" accept="application/json" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
      </div>
      <div className="field row">
        <div>
          <label>{t('Restore defaults')}</label>
          <div className="muted-note">{dirty ? t('{n} shortcut(s) currently overridden.', { n: dirty }) : t('Every shortcut is at its default.')}</div>
        </div>
        <button className="btn ghost" disabled={!dirty} onClick={() => setPref(KEYBIND_PREF, {})}>{t('Reset all')}</button>
      </div>
    </>
  );
}
