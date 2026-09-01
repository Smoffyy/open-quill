import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { t, tk } from '../../i18n.jsx';
import { useTheme } from '../../lib/theme/store.jsx';
import { docEditCount } from '../../lib/theme/ops.js';
import { comboFromEvent, comboLabel } from '../../lib/keybinds.js';
import Overlay from './Overlay.jsx';
import Stage, { STAGES, STAGE_BY_ID, openStage, closeStage } from './Stage.jsx';
import Inspector from './Inspector.jsx';
import { LayersPanel, LibraryPanel, TokensPanel, ContentPanel } from './Panels.jsx';
import ThemesPanel, { useThemes } from './ThemesPanel.jsx';
import { Saved, Confirm } from './controls.jsx';
import { toast } from '../../toast.js';
import { Panel, Palette, Box, TextIcon, Sparkles, Retry, X, Eye, Check, Keyboard, Refresh, Download } from '../icons.jsx';
import '../../styles/builder.css';

const TABS = [
  { id: 'layers', label: tk('Layers'), Icon: Panel },
  { id: 'library', label: tk('Elements'), Icon: Box },
  { id: 'tokens', label: tk('Styles'), Icon: Palette },
  { id: 'content', label: tk('Content'), Icon: TextIcon },
  { id: 'themes', label: tk('Themes'), Icon: Sparkles }
];

/* Shortcuts go through the app's own combo layer, so `mod` resolves to Command
   on macOS and Control everywhere else, and the labels print ⌘Z or Ctrl+Z to
   match. Redo is bound three ways because the platforms genuinely disagree:
   ⇧⌘Z on macOS, and both Ctrl+Shift+Z and Ctrl+Y on Windows and Linux. */
/* The tools an admin picks between. "All" is the default because it reads the
   drag rather than making you declare it first: an item that lives in a known
   flow reorders, anything else moves, and the handles resize. The single-purpose
   tools exist for when that guess is not what you want. */
const TOOLS = [
  { id: 'all', label: tk('All tools'), hint: tk('Click to select, drag to move or reorder, handles to resize'), key: 'a', glyph: '✥' },
  { id: 'select', label: tk('Select'), hint: tk('Click to select. Dragging does nothing.'), key: 'v', glyph: '⌖' },
  { id: 'move', label: tk('Move'), hint: tk('Drag any element to reposition it. Shift locks to one axis.'), key: 'm', glyph: '✜' },
  { id: 'resize', label: tk('Resize'), hint: tk('Drag the handles on the selected element.'), key: 'r', glyph: '⤡' }
];

const KEYS = {
  undo: ['mod+z'],
  redo: ['mod+shift+z', 'mod+y'],
  interact: ['e'],
  published: ['p'],
  clear: ['Escape'],
  panels: ['mod+\\'],
  device: ['1', '2', '3']
};

const SHORTCUT_HELP = [
  { keys: KEYS.undo, label: tk('Undo') },
  { keys: KEYS.redo, label: tk('Redo') },
  { keys: KEYS.interact, label: tk('Select or interact') },
  { keys: KEYS.published, label: tk('Preview what members see') },
  { keys: KEYS.device, label: tk('Desktop, tablet, mobile') },
  { keys: KEYS.panels, label: tk('Show or hide the panels') },
  { keys: KEYS.clear, label: tk('Deselect') },
  { keys: ['a', 'v', 'm', 'r'], label: tk('All, select, move, resize') },
  { keys: ['← ↑ ↓ →'], label: tk('Nudge the selection'), plain: true }
];

// Drawn rather than lettered: a screen outline reads the same in every language
// and at every font size.
const DEVICES = [
  { id: 'desktop', label: tk('Desktop'), w: 17, h: 11 },
  { id: 'tablet', label: tk('Tablet'), w: 12, h: 14 },
  { id: 'mobile', label: tk('Mobile'), w: 8, h: 14 }
];

/* Build mode is chrome around the running app rather than a copy of it. The
   preview in the middle is the real interface with the real data, which is the
   only way an admin can trust that what they are designing is what ships. */

export default function BuildMode() {
  const { build, setBuild, theme, live, undo, redo, depth, saveState, asMember, setAsMember, reload, setPreviewBp,
    revertSession, markSessionBaseline, replaceDoc } = useTheme();
  const themes = useThemes();
  const [tab, setTab] = useState('layers');
  const [selection, setSelection] = useState(null);
  const [device, setDevice] = useState('desktop');
  const [tool, setTool] = useState('all');
  const [stage, setStage] = useState('');
  const [interact, setInteract] = useState(false);
  const [ask, setAsk] = useState(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const select = useCallback((next) => {
    setSelection(next);
    if (next) setRightOpen(true);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (!build) {
      root.removeAttribute('data-build-device');
      root.removeAttribute('data-build-docks');
      root.removeAttribute('data-build-tool');
      return undefined;
    }
    root.setAttribute('data-build-device', device);
    root.setAttribute('data-build-tool', tool);
    setPreviewBp(device === 'desktop' ? '' : device);
    root.setAttribute('data-build-docks', (leftOpen ? 'l' : '') + (rightOpen ? 'r' : '') || 'none');
    return () => {
      root.removeAttribute('data-build-device');
      root.removeAttribute('data-build-docks');
      root.removeAttribute('data-build-tool');
    };
  }, [build, device, tool, leftOpen, rightOpen, setPreviewBp]);

  useEffect(() => {
    if (!build) return undefined;
    const onKey = (e) => {
      // A shortcut never fires out of a field the admin is typing into, except
      // Escape, which has to be able to get them out of one.
      const typing = !!e.target.closest?.('input, textarea, select, [contenteditable="true"]');
      const combo = comboFromEvent(e);
      if (!combo) return;
      const hit = (list) => list.includes(combo);
      const run = (fn) => { e.preventDefault(); fn(); };

      if (hit(KEYS.clear)) {
        if (typing) return;
        if (selection) run(() => setSelection(null));
        return;
      }
      if (typing) return;

      if (hit(KEYS.undo)) run(undo);
      else if (hit(KEYS.redo)) run(redo);
      else if (hit(KEYS.interact)) run(() => setInteract(v => !v));
      else if (hit(KEYS.published)) run(() => setAsMember(v => !v));
      else if (hit(KEYS.panels)) run(() => { setLeftOpen(o => !o); setRightOpen(o => !o); });
      else if (hit(KEYS.device)) run(() => setDevice(DEVICES[KEYS.device.indexOf(combo)].id));
      else {
        const pick = TOOLS.find(x => x.key === combo);
        if (pick) run(() => setTool(pick.id));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [build, undo, redo, selection, setAsMember]);

  /* The counters for a theme that is not the published one come from the list,
     which the server computes against both stores. Refreshing it whenever an
     edit lands is what keeps the banner in step with the canvas. */
  const themesReload = themes.reload;
  useEffect(() => {
    if (saveState === 'saved') themesReload();
  }, [saveState, themesReload]);

  if (!build) return null;

  const active = themes.list.themes.find(x => x.id === themes.list.activeId);
  const self = themes.list.themes.find(x => x.id === theme?.id);
  /* Two different things can be unpublished, and saying so plainly is the
     difference between an admin knowing where they stand and guessing: this
     theme's own settings can have moved since the last publish, and members can
     still be on a different theme entirely. Comparing the documents the session
     already holds keeps the first one honest between saves, instead of trailing
     whatever the last list fetch said. */
  const sameTheme = !!theme && theme.id === live?.id;
  const docDirty = sameTheme
    ? JSON.stringify(theme.doc) !== JSON.stringify(live?.doc)
    : !!self?.dirty;
  const memberTheme = themes.list.themes.find(x => x.id === themes.list.publishedActiveId);
  const activeDirty = !!theme && !!themes.list.publishedActiveId && theme.id !== themes.list.publishedActiveId;
  const dirty = docDirty || activeDirty;
  const edits = self?.changed ?? docEditCount(theme?.doc);
  const dirtySession = depth.undo > 0 || depth.redo > 0;

  const publish = () => setAsk({
    title: t('Publish this interface?'),
    message: t('Everyone on this workspace will see “{name}” the next time their app reloads. The version you are replacing is kept so you can roll back.', { name: active?.name || theme?.name || '' }),
    confirmLabel: t('Publish'),
    onConfirm: async () => {
      const r = await themes.publish();
      if (r) { toast(t('Published to everyone.')); markSessionBaseline(); reload(); }
    }
  });

  /* Undo is a session's memory and can legitimately run out; the published
     document never does. This is the floor an admin can always get back to. */
  const backToPublished = () => setAsk({
    title: t('Discard every unpublished change?'),
    message: t('“{name}” goes back to exactly what members are running. A version is saved first, and it lands as one undo step.', { name: active?.name || theme?.name || '' }),
    confirmLabel: t('Discard changes'),
    danger: true,
    onConfirm: async () => {
      const r = await themes.reset(theme.id, 'published');
      if (!r?.doc) return;
      replaceDoc(r.doc);
      markSessionBaseline();
      setSelection(null);
      toast(t('Back to the published interface.'));
    }
  });

  const revert = () => setAsk({
    title: t('Revert this session?'),
    message: t('Every change you have made since opening build mode goes back to how it was. It lands as one undo step, so you can put it back.'),
    confirmLabel: t('Revert'),
    danger: true,
    onConfirm: () => { revertSession(); setSelection(null); toast(t('Reverted to where this session started.')); }
  });

  const showStage = (id) => {
    setSelection(null);
    setStage(openStage(id) ? id : '');
  };

  const rename = async (name) => {
    const next = String(name || '').trim();
    setRenaming(null);
    if (!next || next === (active?.name || theme?.name)) return;
    await themes.rename(theme.id, next);
    reload();
  };

  return createPortal(
    <div id="oq-builder" className="bx">
      <header className="bx-top">
        <div className="bx-top-left">
          <button type="button" className={'bx-icon' + (leftOpen ? ' on' : '')} onClick={() => setLeftOpen(o => !o)}
            title={t('Toggle panels') + ' · ' + comboLabel(KEYS.panels[0])} aria-label={t('Toggle panels')}><Panel /></button>
          <span className="bx-brand">{t('Build mode')}</span>
          {renaming === null ? (
            <span className="bx-theme-chip" role="button" tabIndex={0}
              title={t('Theme being edited. Double-click to rename.')}
              onDoubleClick={() => setRenaming(active?.name || theme?.name || '')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRenaming(active?.name || theme?.name || ''); } }}>
              {active?.name || theme?.name || t('Untitled')}
            </span>
          ) : (
            <input className="bx-theme-rename" autoFocus value={renaming}
              aria-label={t('Theme name')}
              onChange={(e) => setRenaming(e.target.value)}
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') rename(e.currentTarget.value);
                else if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); }
              }} />
          )}
        </div>

        <div className="bx-top-mid">
          <div className="bx-tools" role="group" aria-label={t('Tools')}>
            {TOOLS.map(x => (
              <button key={x.id} type="button" className={'bx-tool' + (tool === x.id ? ' on' : '')}
                aria-pressed={tool === x.id} onClick={() => setTool(x.id)}
                title={t(x.label) + ' · ' + comboLabel(x.key) + ' — ' + t(x.hint)}>
                <span aria-hidden="true">{x.glyph}</span>
                <span className="sr-only">{t(x.label)}</span>
              </button>
            ))}
          </div>
          <label className="bx-stage-pick" title={t(STAGE_BY_ID[stage]?.hint || 'Put a window, a menu or a sample conversation on screen so it can be styled')}>
            <span className="sr-only">{t('Show')}</span>
            <select value={stage} onChange={(e) => showStage(e.target.value)}>
              {STAGES.map(x => <option key={x.id} value={x.id}>{t(x.label)}</option>)}
            </select>
          </label>
          <div className="bx-devices" role="group" aria-label={t('Preview size')}
            title={t("Narrows the canvas and applies this theme's rules for that size. The app's own breakpoints still follow your real window.")}>
            {DEVICES.map(d => (
              <button key={d.id} type="button" className={'bx-dev' + (device === d.id ? ' on' : '')}
                title={t(d.label)} aria-label={t(d.label)} aria-pressed={device === d.id}
                onClick={() => setDevice(d.id)}>
                <span className="bx-dev-screen" style={{ width: d.w, height: d.h }} />
              </button>
            ))}
          </div>
          <div className="bx-undo">
            <button type="button" className="bx-icon" disabled={!depth.undo} onClick={undo}
              title={t('Undo') + ' · ' + comboLabel(KEYS.undo[0])} aria-label={t('Undo')}><Retry /></button>
            <button type="button" className="bx-icon flip" disabled={!depth.redo} onClick={redo}
              title={t('Redo') + ' · ' + comboLabel(KEYS.redo[0])} aria-label={t('Redo')}><Retry /></button>
            <button type="button" className="bx-icon" disabled={!depth.baseline || !dirtySession} onClick={revert}
              title={t('Revert everything from this session')} aria-label={t('Revert everything from this session')}>
              <Refresh />
            </button>
            <button type="button" className="bx-icon" disabled={!docDirty || themes.busy} onClick={backToPublished}
              title={t('Discard every unpublished change and go back to what members are running')}
              aria-label={t('Discard every unpublished change')}>
              <Download />
            </button>
          </div>
          <button type="button" className={'bx-toggle' + (interact ? ' on' : '')} onClick={() => setInteract(v => !v)}
            title={t('Let clicks reach the app so you can open menus and navigate') + ' · ' + comboLabel(KEYS.interact[0])}>
            {interact ? t('Interacting') : t('Selecting')}
          </button>
          <button type="button" className={'bx-toggle' + (asMember ? ' on' : '')} onClick={() => setAsMember(v => !v)}
            title={t('See exactly what members are running right now') + ' · ' + comboLabel(KEYS.published[0])}>
            <Eye /> {asMember ? t('Viewing published') : t('View published')}
          </button>
        </div>

        <div className="bx-top-right">
          <Saved state={saveState} />
          <span className={'bx-state' + (dirty ? ' pending' : ' live')}
            title={activeDirty ? t('Members are still on “{name}”. Publishing switches them to this one.', { name: memberTheme?.name || themes.list.publishedActiveId }) : undefined}>
            {!dirty
              ? t('Everything published')
              : !docDirty
                ? t('Not published to members yet')
                : edits === 1 ? t('1 unpublished change')
                  : t('{n} unpublished changes', { n: edits })}
          </span>
          <button type="button" className="bx-btn primary" disabled={!dirty || themes.busy} onClick={publish}>
            {themes.busy ? t('Publishing…') : t('Publish')}
          </button>
          <button type="button" className={'bx-icon' + (keysOpen ? ' on' : '')} onClick={() => setKeysOpen(o => !o)}
            title={t('Keyboard shortcuts')} aria-label={t('Keyboard shortcuts')} aria-expanded={keysOpen}><Keyboard /></button>
          <button type="button" className={'bx-icon' + (rightOpen ? ' on' : '')} onClick={() => setRightOpen(o => !o)}
            title={t('Toggle inspector')} aria-label={t('Toggle inspector')}><Panel /></button>
          <button type="button" className="bx-icon" onClick={() => { closeStage(); setBuild(false); }} title={t('Leave build mode')} aria-label={t('Leave build mode')}>
            <X />
          </button>
        </div>
      </header>

      {keysOpen && (
        <div className="bx-keys" role="dialog" aria-label={t('Keyboard shortcuts')}>
          <div className="bx-keys-head">
            <b>{t('Keyboard shortcuts')}</b>
            <button type="button" className="bx-icon" onClick={() => setKeysOpen(false)} aria-label={t('Close')}><X /></button>
          </div>
          <dl className="bx-keys-list">
            {SHORTCUT_HELP.map(row => (
              <div key={row.label}>
                <dt>{t(row.label)}</dt>
                <dd>{row.keys.map(k => <kbd key={k}>{row.plain ? k : comboLabel(k)}</kbd>)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {asMember && (
        <div className="bx-preview-note" role="status">
          <Check /> {t('This is the published interface. Turn the preview off to keep editing your draft.')}
        </div>
      )}

      {leftOpen && (
        <div className="bx-dock left">
          <nav className="bx-dock-tabs" role="tablist" aria-label={t('Builder panels')}>
            {TABS.map(x => (
              <button key={x.id} type="button" role="tab" aria-selected={tab === x.id}
                className={'bx-dock-tab' + (tab === x.id ? ' on' : '')} onClick={() => setTab(x.id)} title={t(x.label)}>
                <x.Icon />
                <span>{t(x.label)}</span>
              </button>
            ))}
          </nav>
          <div className="bx-dock-body">
            {tab === 'layers' && <LayersPanel selection={selection} onSelect={select} />}
            {tab === 'library' && <LibraryPanel onSelect={select} />}
            {tab === 'tokens' && <TokensPanel />}
            {tab === 'content' && <ContentPanel />}
            {tab === 'themes' && <ThemesPanel compact />}
          </div>
        </div>
      )}

      {rightOpen && <Inspector selection={selection} onSelect={select} />}

      {!asMember && <Stage id={stage} />}
      {!asMember && <Overlay selection={selection} onSelect={select} interact={interact} tool={tool} />}

      {ask && <Confirm {...ask} onClose={() => setAsk(null)} />}
    </div>, document.body);
}
