import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import CodeMenu, { MenuItem, MenuLabel, MenuSep } from './CodeMenu.jsx';
import { KwargControl, Badges } from '../composer/ModelDropdown.jsx';
import { Switch } from '../ui/controls.jsx';
import Tip from '../ui/Tip.jsx';
import ContextRing from '../chat/ContextRing.jsx';
import { Plus, Mic, Enter, X, FileText, Laptop, Info, Check } from '../ui/icons.jsx';
import { useAttachments } from '../../lib/attachments.js';
import { useDictation } from '../../lib/dictation.js';
import { resolveKwargValues, kwargVisible, kwargChip, gateSourceIds } from '../../lib/kwargs.js';
import { api } from '../../lib/api.js';
import { toast } from '../../lib/toast.js';
import { t } from '../../i18n.jsx';

function useDigits(open, count, pick) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > count) return;
      e.preventDefault();
      pick(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, count, pick]);
}

function ModelRow({ m, checked, kbd, nested, isAdmin, onPick }) {
  const noCode = m.codeAllowed === false;
  const down = m.unavailable && !isAdmin;
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} disabled={noCode || down}
      className={'cx-mi cx-model' + (nested ? ' nested' : '') + (m.unavailable || noCode ? ' unavail' : '')} onClick={onPick}
      data-tip={noCode ? t('{name} is not available in Code.', { name: m.displayName }) : m.unavailable ? t('{name} is currently unavailable.', { name: m.displayName }) : m.description || undefined}>
      <span className="cx-mi-main">
        <span className="cx-mi-label">
          {m.displayName}
          <Badges m={m} />
          {noCode ? <span className="cx-mi-tag"><Info />{t('Not available in Code')}</span>
            : m.unavailable && <span className="cx-mi-tag"><Info />{t('Currently unavailable')}</span>}
        </span>
      </span>
      {checked && <Check className="cx-mi-check" />}
      {kbd && <kbd className="cx-mi-kbd">{kbd}</kbd>}
    </button>
  );
}

export default function CodeComposer({
  value, onChange, onSend, onStop, streaming, stopping, ended, empty, placeholder, autoFocus, focusKey, panel,
  models, modelsReady = true, currentId, onSelect, kwargValues, onSetKwarg, reasoningEffort, extended, onToggleExtended, isAdmin,
  plan, onPlan, chatId, revision, liveTokens, voiceMic, sttEngine, draftId, attachCombo = ''
}) {
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const addRef = useRef(null);
  const modeRef = useRef(null);
  const modelRef = useRef(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const [menu, setMenu] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);
  const { files, dragActive, pickFiles, onPaste, removeFile, clearFiles } = useAttachments({ visionSupported: true, draftId });
  const { dictating, transcribing, toggleDictation } = useDictation({ sttEngine, valueRef, onChange });
  const setOpen = (id) => (v) => setMenu(m => (v ? id : (m === id ? null : m)));

  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [value]);
  useEffect(() => { if (autoFocus || focusKey) taRef.current?.focus(); }, [autoFocus, focusKey]);
  useEffect(() => {
    const h = () => fileRef.current?.click();
    window.addEventListener('oq-attach-files', h);
    return () => window.removeEventListener('oq-attach-files', h);
  }, []);

  const current = models.find(m => m.id === currentId);
  const list = models.filter(m => m.kind !== 'router' || isAdmin);
  const kwDefs = Array.isArray(current?.kwargs) ? current.kwargs : [];
  const selected = { ...(reasoningEffort ? { effort: reasoningEffort } : {}), ...(kwargValues || {}) };
  const kwActive = resolveKwargValues(kwDefs, selected, isAdmin);
  const gates = gateSourceIds(kwDefs, kwActive);
  const chips = kwDefs.filter(d => !d.parentId && kwargVisible(kwDefs, kwActive, d) && !gates.has(d.id))
    .map(d => kwargChip(d, kwActive[d.id])).filter(Boolean).slice(0, 2);
  const shownKwargs = menu === 'model' ? kwDefs.filter(d => kwargVisible(kwDefs, kwActive, d)) : [];
  const shownIds = new Set(shownKwargs.map(d => d.id));
  const main = list.filter(m => !m.inMoreModels);
  const groups = [];
  for (const m of list) {
    if (!m.inMoreModels) continue;
    const label = (m.moreModelsLabel || '').trim() || t('More models');
    let g = groups.find(x => x.label === label);
    if (!g) { g = { label, items: [] }; groups.push(g); }
    g.items.push(m);
  }
  const choose = (m) => { if (m && m.codeAllowed !== false) { onSelect(m.id); setMenu(null); setOpenGroup(null); } };
  const pickModel = (i) => choose(main[i]);
  const pickMode = (i) => { onPlan(i === 1); setMenu(null); };
  useDigits(menu === 'model', Math.min(9, main.length), pickModel);
  useDigits(menu === 'mode', 2, pickMode);

  const hasText = !!value.trim();
  const canSend = (hasText || files.length > 0) && !uploading && !ended;

  async function send() {
    if (!canSend || streaming) return;
    let attachments = [];
    if (files.length) {
      setUploading(true);
      try { const r = await api.uploadFiles(files.map(f => f.file)); attachments = r.files || []; }
      catch (e) { setUploading(false); toast(e?.message || t('The upload failed.')); return; }
      setUploading(false);
      clearFiles();
    }
    onSend(attachments);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
    else if (e.key === 'Escape' && streaming) { e.preventDefault(); onStop(); }
  }

  return (
    <div className={'cx-dock' + (dragActive ? ' dragging' : '')}>
      {panel}
      {empty && (
        <div className="cx-chips">
          <Tip label={t('Runs on this server, in a private folder for each session')}>
            <span className="cx-chip static"><Laptop /><span>{t('Local')}</span></span>
          </Tip>
          <button type="button" className="cx-chip" onClick={() => fileRef.current?.click()}><Plus /><span>{t('Add files…')}</span></button>
        </div>
      )}
      <div className={'cx-box' + (streaming ? ' busy' : '')} onClick={(e) => { if (e.target === e.currentTarget) taRef.current?.focus(); }}>
        {files.length > 0 && (
          <div className="cx-files-row">
            {files.map(f => (
              <span key={f.id} className="cx-file-chip" data-tip={f.name}>
                {f.preview ? <img src={f.preview} alt="" aria-hidden="true" /> : <FileText />}
                <span className="cx-file-name">{f.name}</span>
                <button type="button" onClick={() => removeFile(f.id)} aria-label={t('Remove {name}', { name: f.name })}><X /></button>
              </span>
            ))}
          </div>
        )}
        <div className="cx-input-row">
          <textarea id="oq-composer" ref={taRef} className="cx-input" rows={1} value={value} spellCheck
            placeholder={ended ? t('This session has ended.') : (placeholder || t('Describe a task or ask a question'))}
            aria-label={t('Message')} disabled={ended}
            onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} />
          <div className="cx-send-slot">
            {streaming ? (
              <Tip label={stopping ? t('Stopping…') : t('Stop')} keys="Esc">
                <button type="button" className="cx-send stop" onClick={onStop} disabled={stopping} aria-label={t('Stop')}><span className="cx-stop" aria-hidden="true" /></button>
              </Tip>
            ) : (
              <Tip label={t('Send')} keys="Enter">
                <button type="button" className={'cx-send' + (canSend ? ' ready' : '')} onClick={send} disabled={!canSend} aria-label={t('Send')}>
                  {uploading ? <span className="btn-spin" aria-hidden="true" /> : <Enter />}
                </button>
              </Tip>
            )}
          </div>
        </div>
      </div>
      <div className="cx-toolbar">
        <div className="cx-tools-left">
          <Tip label={t('Add')}>
            <button type="button" ref={addRef} className={'cx-tbtn icon' + (menu === 'add' ? ' on' : '')} aria-label={t('Add')} aria-haspopup="menu"
              aria-expanded={menu === 'add'} onClick={() => setMenu(m => (m === 'add' ? null : 'add'))}><Plus /></button>
          </Tip>
          <CodeMenu open={menu === 'add'} setOpen={setOpen('add')} anchorRef={addRef} label={t('Add')}>
            <MenuItem icon={<FileText />} kbd={attachCombo || null} onClick={() => { setMenu(null); fileRef.current?.click(); }}>{t('Add files or photos')}</MenuItem>
          </CodeMenu>
          {voiceMic && (
            <Tip label={dictating ? t('Stop dictation') : transcribing ? t('Transcribing…') : t('Dictate')}>
              <button type="button" className={'cx-tbtn icon' + (dictating ? ' on rec' : '')} onClick={toggleDictation} disabled={transcribing}
                aria-label={dictating ? t('Stop dictation') : t('Dictate')} aria-pressed={dictating}><Mic /></button>
            </Tip>
          )}
          <button type="button" ref={modeRef} className={'cx-tbtn' + (menu === 'mode' ? ' on' : '') + (plan ? ' plan' : '')} aria-haspopup="menu"
            aria-expanded={menu === 'mode'} onClick={() => setMenu(m => (m === 'mode' ? null : 'mode'))}>{plan ? t('Plan') : t('Auto')}</button>
          <CodeMenu open={menu === 'mode'} setOpen={setOpen('mode')} anchorRef={modeRef} label={t('Mode')} className="cx-mode-menu">
            <MenuLabel>{t('Mode')}</MenuLabel>
            <MenuItem checked={!plan} kbd="1" desc={t('Creates, edits and runs files on its own')} onClick={() => pickMode(0)}>{t('Auto')}</MenuItem>
            <MenuItem checked={plan} kbd="2" desc={t('Explores and writes a plan before making changes')} onClick={() => pickMode(1)}>{t('Plan')}</MenuItem>
          </CodeMenu>
        </div>
        <div className="cx-tools-right">
          <button type="button" ref={modelRef} className={'cx-tbtn strong' + (menu === 'model' ? ' on' : '')} aria-haspopup="menu"
            aria-label={t('Model: {name}', { name: current?.displayName || '' })}
            aria-expanded={menu === 'model'} onClick={() => setMenu(m => (m === 'model' ? null : 'model'))}>
            {current?.displayName || t('Model')}
            {chips.length
              ? chips.map((c, i) => <span key={c + i} className="cx-ext">{t(c)}</span>)
              : extended && current?.hasReasoning && <span className="cx-ext">{t('Extended')}</span>}
          </button>
          <CodeMenu open={menu === 'model'} setOpen={setOpen('model')} anchorRef={modelRef} align="right" label={t('Model')} className="cx-model-menu">
            {modelsReady && main.length === 0 && groups.length === 0 && <div className="cx-mempty">{t('No models available')}</div>}
            {main.map((m, i) => (
              <ModelRow key={m.id} m={m} checked={m.id === currentId} kbd={m.id === currentId || i > 8 || m.codeAllowed === false ? null : String(i + 1)}
                isAdmin={isAdmin} onPick={() => choose(m)} />
            ))}
            {groups.map(g => (
              <React.Fragment key={g.label}>
                <MenuItem sub onClick={() => setOpenGroup(o => (o === g.label ? null : g.label))}>{g.label}</MenuItem>
                {openGroup === g.label && g.items.map(m => (
                  <ModelRow key={m.id} m={m} nested checked={m.id === currentId} isAdmin={isAdmin} onPick={() => choose(m)} />
                ))}
              </React.Fragment>
            ))}
            {shownKwargs.length > 0 ? (
              <>
                <MenuSep />
                <div className="cx-kwargs">
                  {shownKwargs.map(d => (
                    <KwargControl key={d.id} def={d} value={kwActive[d.id]} isAdmin={isAdmin} onSet={onSetKwarg}
                      gated={!!(d.showIf && d.showIf.id && shownIds.has(d.showIf.id))} />
                  ))}
                </div>
              </>
            ) : current?.hasReasoning ? (
              <>
                <MenuSep />
                <div className="cx-kwargs">
                  <div className="toggle-row" onClick={onToggleExtended}>
                    <div className="tr-main">
                      <div className="mo-name">{t('Extended')}</div>
                      <div className="mo-desc">{t('Always uses deep reasoning')}</div>
                    </div>
                    <Switch on={!!extended} label={t('Extended')} onToggle={onToggleExtended} />
                  </div>
                </div>
              </>
            ) : null}
          </CodeMenu>
          <ContextRing chatId={chatId} modelId={currentId} revision={revision} streaming={streaming} live={liveTokens} />
        </div>
      </div>
      <input ref={fileRef} type="file" multiple hidden onChange={pickFiles} />
      {dragActive && <div className="cx-drop">{t('Drop files to add them to the workspace')}</div>}
    </div>
  );
}