import { useState, useEffect, useId, useMemo } from 'react';
import { useAdmin } from '../store.jsx';
import { Btn, IconBtn, Tabs, Empty, PointMenu, MenuItem, clampToViewport } from '../ui.jsx';
import { Faces } from '../changes/Review.jsx';
import { X, Cube, ChevDown, Check } from '../../ui/icons.jsx';
import { ModelMark } from '../../ui/Weave.jsx';
import { t, tk } from '../../../i18n.jsx';
import { tabsFor, tabChanges } from '../../../lib/modelcatalog.js';
import { EditorProvider } from './bind.jsx';
import General from './tabs/General.jsx';
import Prompts from './tabs/Prompts.jsx';
import Tools from './tabs/Tools.jsx';
import Reasoning from './tabs/Reasoning.jsx';
import Context from './tabs/Context.jsx';
import Sampling from './tabs/Sampling.jsx';
import Controls from './tabs/Controls.jsx';
import Appearance from './tabs/Appearance.jsx';
import Routing from './tabs/Routing.jsx';

const TAB_KEY = 'oq-models-tab';
const ADDED_KEY = 'oq-models-added-tabs';
const NAMES_SHOWN = 3;
const MENU_W = 280;
const MENU_H = 160;

const TABS = [
  ['general', tk('General'), General],
  ['prompts', tk('Prompts'), Prompts],
  ['tools', tk('Tools'), Tools],
  ['reasoning', tk('Reasoning'), Reasoning],
  ['context', tk('Context'), Context],
  ['sampling', tk('Sampling'), Sampling],
  ['controls', tk('Request controls'), Controls],
  ['appearance', tk('Appearance'), Appearance],
  ['routing', tk('Routing'), Routing]
];

const OPTIONAL_NOTE = {
  __proto__: null,
  reasoning: tk('Thought display, think tags and prompt tokens'),
  controls: tk('Extra request fields and picker controls')
};

function readAdded() {
  try {
    const v = JSON.parse(localStorage.getItem(ADDED_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

function firstTab() {
  try {
    const v = localStorage.getItem(TAB_KEY);
    if (TABS.some(([id]) => id === v)) return v;
  } catch {}
  return 'general';
}

function Title({ models, changed }) {
  if (models.length === 1) {
    const m = models[0];
    return (
      <div className="mc-title">
        {m.static_icon
          ? <ModelMark src={m.static_icon} className="mc-title-icon" />
          : <span className="mc-row-icon blank" aria-hidden="true"><Cube /></span>}
        <div>
          <b>{m.display_name || t('Untitled')}</b>
          <span className="mc-title-sub">
            <span className="mono">{m.kind === 'router' ? t('router') : (m.internal_name || t('no model id'))}</span>
            {changed.has(m.id) && <span className="mc-flag" title={t('Changed since the last release')}>{t('edited')}</span>}
          </span>
        </div>
      </div>
    );
  }
  const names = models.slice(0, NAMES_SHOWN).map(m => m.display_name || t('Untitled')).join(', ');
  const more = models.length - NAMES_SHOWN;
  return (
    <div className="mc-title">
      <span className="mc-count">{models.length}</span>
      <div>
        <b>{t('{n} models selected', { n: models.length })}</b>
        <span className="mc-title-sub">{more > 0 ? t('{names} and {n} more', { names, n: more }) : names}</span>
      </div>
    </div>
  );
}

export default function Inspector({ models, onDismiss }) {
  const { catalog, present } = useAdmin();
  const { edit, setSelection, draft } = catalog;
  const [tab, setTab] = useState(firstTab);
  const [added, setAdded] = useState(readAdded);
  const [menu, setMenu] = useState(null);
  const panelId = useId();

  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch {} }, [tab]);
  useEffect(() => {
    const known = new Set(catalog.models.map(m => m.id));
    const kept = Object.fromEntries(Object.entries(added).filter(([id, tabs]) => known.has(id) && tabs.length));
    try { localStorage.setItem(ADDED_KEY, JSON.stringify(kept)); } catch {}
  }, [added, catalog.models]);

  const changed = useMemo(() => new Set(draft.changed || []), [draft.changed]);

  if (!models.length) {
    return (
      <section className="mc-inspector idle">
        <Empty icon={Cube} title={t('Select a model')}>
          {t('Click a model to edit it. Tick several, or use Ctrl and Shift, to change them together: every field then shows whether the selection agrees and writes to all of them at once.')}
        </Empty>
      </section>
    );
  }

  const ids = models.map(m => m.id);
  const key = ids.join(',');
  const { shown, optional } = tabsFor(models);
  const extra = optional.filter(id => models.some(m => added[m.id]?.includes(id)));
  const counts = tabChanges(models, draft.live);
  const inUse = (id) => shown.includes(id) || counts[id] > 0;
  const visible = TABS.filter(([id]) => shown.includes(id) || extra.includes(id) || counts[id] > 0);
  const current = visible.some(([id]) => id === tab) ? tab : 'general';
  const View = visible.find(([id]) => id === current)[2];

  function toggle(id) {
    const on = !extra.includes(id);
    setAdded(prev => {
      const next = { ...prev };
      for (const m of models) {
        const tabs = (next[m.id] || []).filter(x => x !== id);
        next[m.id] = on ? [...tabs, id] : tabs;
      }
      return next;
    });
    if (on) setTab(id);
  }

  return (
    <section className="mc-inspector" aria-label={t('Model settings')}>
      <header className="mc-inspector-head">
        <div className="mc-inspector-bar">
          <Title models={models} changed={changed} />
          <Faces people={present.filter(p => p.section === 'models' && ids.includes(p.target))} />
          <IconBtn kind="quiet" label={onDismiss ? t('Hide settings') : t('Clear selection')} onClick={onDismiss || (() => setSelection([]))}><X /></IconBtn>
        </div>
        <div className="mc-tabs-row">
          <Tabs label={t('Model settings')} value={current} onChange={setTab} panelId={panelId}
            items={visible.map(([id, label]) => ({ id, label: t(label), count: counts[id] || 0 }))} />
          {optional.length > 0 && (
            <Btn size="sm" kind="quiet" aria-haspopup="menu" aria-expanded={!!menu}
              onClick={(e) => {
                if (menu) { setMenu(null); return; }
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ at: clampToViewport(r.right - MENU_W, r.bottom + 4, MENU_W, MENU_H), el: e.currentTarget });
              }}>
              {t('More')}<ChevDown />
            </Btn>
          )}
        </div>
      </header>
      <div id={panelId} role="tabpanel" className="mc-inspector-body">
        <EditorProvider models={models} edit={edit}>
          <View key={key} />
        </EditorProvider>
      </div>
      {menu && (
        <PointMenu at={menu.at} width={MENU_W} anchorEl={menu.el} onClose={() => setMenu(null)}>
          <div className="cp-menu-empty">{t('Optional tabs')}</div>
          {optional.map(id => {
            const locked = inUse(id);
            const checked = locked || extra.includes(id);
            return (
              <MenuItem key={id} role="menuitemcheckbox" aria-checked={checked} className="mc-menu-check"
                disabled={locked} title={locked ? t('This selection already uses these settings.') : undefined}
                onClick={() => toggle(id)}>
                <span className="mc-check" aria-hidden="true">{checked && <Check />}</span>
                <span className="mc-menu-two">
                  <b>{t(TABS.find(([x]) => x === id)[1])}</b>
                  <small>{locked ? t('In use') : t(OPTIONAL_NOTE[id])}</small>
                </span>
              </MenuItem>
            );
          })}
        </PointMenu>
      )}
    </section>
  );
}