import { useState, useMemo } from 'react';
import { Btn, IconBtn, PointMenu, MenuItem, Switch, clampToViewport } from '../admin/ui.jsx';
import { KwargControl } from '../composer/ModelDropdown.jsx';
import { legacyKwarg } from '../admin/models/tabs/Controls.jsx';
import { ModelMark } from '../ui/Weave.jsx';
import { ChevDown, Plus, X, Sliders, Cube, Check } from '../ui/icons.jsx';
import { t } from '../../i18n.jsx';
import { resolveKwargValues, kwargVisible } from '../../lib/kwargs.js';
import { folderOf } from '../../lib/modelcatalog.js';
import { MAX_LANES, laneKey, laneRow, kwargDefsOf, usesPromptToken, groupModels } from '../../lib/playground.js';
import { LaneName, SOURCE_LABEL } from './Reply.jsx';

const MENU_W = 300;
const MENU_H = 380;

function openAt(e, w = MENU_W, h = MENU_H) {
  const r = e.currentTarget.getBoundingClientRect();
  return { at: clampToViewport(r.left, r.bottom + 4, w, h), el: e.currentTarget };
}

function ModelItem({ m, on, edited, onPick }) {
  return (
    <MenuItem active={on} onClick={onPick} className="pg-pick-item">
      {m.static_icon ? <ModelMark src={m.static_icon} className="pg-lane-icon" /> : <span className="pg-lane-icon blank" aria-hidden="true"><Cube /></span>}
      <span className="pg-pick-two">
        <b>{m.display_name || t('Untitled')}</b>
        <small className="mono">{m.kind === 'router' ? t('router') : (m.internal_name || t('no model id'))}</small>
      </span>
      {edited && <span className="mc-flag">{t('edited')}</span>}
      {on && <Check />}
    </MenuItem>
  );
}

export function SubjectPicker({ models, subject, changed, onPick }) {
  const [menu, setMenu] = useState(null);
  const groups = useMemo(() => groupModels(models, folderOf), [models]);
  return (
    <>
      <button type="button" className="pg-subject" aria-haspopup="menu" aria-expanded={!!menu}
        data-tip={t('Model under test')} onClick={(e) => setMenu(menu ? null : openAt(e))}>
        {subject?.static_icon ? <ModelMark src={subject.static_icon} className="pg-lane-icon" /> : <span className="pg-lane-icon blank" aria-hidden="true"><Cube /></span>}
        <span className="pg-subject-name">{subject ? (subject.display_name || t('Untitled')) : t('Choose a model')}</span>
        {subject && changed.has(subject.id) && <span className="mc-flag">{t('edited')}</span>}
        <ChevDown />
      </button>
      {menu && (
        <PointMenu at={menu.at} width={MENU_W} anchorEl={menu.el} onClose={() => setMenu(null)}>
          <div className="pg-menu-scroll">
            {groups.map(g => (
              <div key={g.label || '-'}>
                {g.label && <div className="cp-menu-empty">{g.label}</div>}
                {g.items.map(m => (
                  <ModelItem key={m.id} m={m} on={m.id === subject?.id} edited={changed.has(m.id)}
                    onPick={() => { setMenu(null); onPick(m.id); }} />
                ))}
              </div>
            ))}
          </div>
        </PointMenu>
      )}
    </>
  );
}

function LaneOptions({ lane, row, onChange }) {
  const defs = kwargDefsOf(row, legacyKwarg);
  const values = resolveKwargValues(defs, lane.kwargValues, true);
  const token = usesPromptToken(row);
  const shown = defs.filter(d => d.visible !== false && kwargVisible(defs, values, d));
  return (
    <div className="pg-opts">
      <div className="cp-menu-empty">{t('Run options')}</div>
      {shown.map(d => (
        <KwargControl key={d.id} def={d} value={values[d.id]} isAdmin
          onSet={(id, v) => onChange({ kwargValues: { ...lane.kwargValues, [id]: v } })} />
      ))}
      <div className="pg-opt-row">
        <span>
          <b>{t('Run tools')}</b>
          <small>{t('Calculator, web search, reference files, skills, past-chat search, consult and MCP tools run for real. Sandbox, memory, to-do list and other chat-only tools stay off.')}</small>
        </span>
        <Switch on={lane.tools !== false} label={t('Run tools')} onToggle={() => onChange({ tools: lane.tools === false })} />
      </div>
      {token && (
        <div className="pg-opt-row">
          <span>
            <b>{t('Extended thinking')}</b>
            <small>{t('Sends the extended-mode trigger instead of the standard one.')}</small>
          </span>
          <Switch on={!!lane.extended} label={t('Extended thinking')} onToggle={() => onChange({ extended: !lane.extended })} />
        </div>
      )}
      <p className="pg-opt-note">{t('These are the choices a member makes in the composer. They apply to this column only and are not saved to the model.')}</p>
    </div>
  );
}

function LaneHead({ lane, row, index, wins, live, changes, onChange, onRemove, onReview }) {
  const [menu, setMenu] = useState(null);
  const subject = index === 0;
  const hasOpts = !!row;
  const n = subject ? changes : 0;
  return (
    <div className={'pg-lane' + (subject ? ' subject' : '')}>
      <div className="pg-lane-main">
        {row
          ? <LaneName name={row.display_name} icon={row.static_icon} source={lane.source} />
          : <span className="pg-dim">{lane.source === 'live' ? t('Not released yet') : t('Model removed')}</span>}
        {wins > 0 && <span className="pg-wins" data-tip={t('{n} preferred', { n: wins })}><Check aria-hidden="true" />{wins}<span className="sr-only">{t('{n} preferred', { n: wins })}</span></span>}
      </div>
      <div className="pg-lane-acts">
        {subject && n > 0 && (
          <Btn size="sm" kind="quiet" className="pg-unreleased" onClick={onReview}
            data-tip={t('Review and release the changes to this model')}>
            {t('{n} unreleased', { n })}
          </Btn>
        )}
        {!subject && (
          <div className="pg-src-seg" role="group" aria-label={t('Version')}>
            {['draft', 'live'].map(s => (
              <button key={s} type="button" aria-pressed={lane.source === s}
                disabled={s === 'live' && !live}
                data-tip={s === 'live' && !live ? t('Not released yet') : undefined}
                onClick={() => onChange({ source: s })}>{t(SOURCE_LABEL[s])}</button>
            ))}
          </div>
        )}
        {hasOpts && (
          <IconBtn kind="quiet" label={t('Run options')} aria-haspopup="dialog" aria-expanded={!!menu}
            onClick={(e) => setMenu(menu ? null : openAt(e, 320, 420))}><Sliders /></IconBtn>
        )}
        {!subject && <IconBtn kind="quiet" label={t('Remove column')} onClick={onRemove}><X /></IconBtn>}
      </div>
      {menu && (
        <PointMenu at={menu.at} width={320} anchorEl={menu.el} onClose={() => setMenu(null)}>
          <LaneOptions lane={lane} row={row} onChange={onChange} />
        </PointMenu>
      )}
    </div>
  );
}

export function LaneBar({ lanes, models, live, wins, changes, onLanes, onAdd, onReview }) {
  const [menu, setMenu] = useState(null);
  const subjectId = lanes[0]?.modelId;
  const keys = new Set(lanes.map(laneKey));
  const full = lanes.length >= MAX_LANES;
  const others = models.filter(m => m.id !== subjectId);
  const patch = (id, p) => onLanes(lanes.map(l => (l.id === id ? { ...l, ...p } : l)));

  return (
    <div className="pg-lanes">
      <div className="pg-lane-grid">
        {lanes.map((l, i) => (
          <LaneHead key={l.id} lane={l} index={i} row={laneRow(l, models, live)} live={!!live[l.modelId]}
            wins={wins[laneKey(l)] || 0} changes={changes}
            onChange={(p) => {
              const next = { ...l, ...p };
              if (p.source && keys.has(laneKey(next)) && laneKey(next) !== laneKey(l)) return;
              patch(l.id, p);
            }}
            onRemove={() => onLanes(lanes.filter(x => x.id !== l.id))}
            onReview={onReview} />
        ))}
      </div>
      <Btn size="sm" kind="quiet" disabled={full} aria-haspopup="menu" aria-expanded={!!menu}
        data-tip={full ? t('Up to {n} columns', { n: MAX_LANES }) : t('Run the same input against another version or model')}
        onClick={(e) => setMenu(menu ? null : openAt(e))}>
        <Plus /> {t('Compare')}
      </Btn>
      {menu && (
        <PointMenu at={menu.at} width={MENU_W} anchorEl={menu.el} onClose={() => setMenu(null)}>
          <div className="pg-menu-scroll">
            <MenuItem disabled={!live[subjectId] || keys.has(subjectId + ':live')}
              onClick={() => { setMenu(null); onAdd(subjectId, 'live'); }}>
              <span className="pg-pick-two">
                <b>{t('Live release')}</b>
                <small>{!live[subjectId] ? t('This model has not been released yet') : changes ? t('What members get right now, without your unreleased changes') : t('Same as the draft until you change something')}</small>
              </span>
            </MenuItem>
            {others.length > 0 && <div className="cp-menu-empty">{t('Other models')}</div>}
            {others.map(m => (
              <ModelItem key={m.id} m={m} on={keys.has(m.id + ':draft')}
                onPick={() => { setMenu(null); if (!keys.has(m.id + ':draft')) onAdd(m.id, 'draft'); }} />
            ))}
          </div>
        </PointMenu>
      )}
    </div>
  );
}