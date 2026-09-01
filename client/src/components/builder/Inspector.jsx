import { useState, useMemo } from 'react';
import { t } from '../../i18n.jsx';
import { useTheme } from '../../lib/theme/store.jsx';
import { ELEMENT_INDEX, ORDER_GROUPS, NODE_INDEX, PLACEHOLDERS } from '../../lib/theme/schema.js';
import { setPath, getPath, stylePath, resetElement, setHidden, elementEditCount, findNode, updateNode, removeNode, duplicateNode } from '../../lib/theme/ops.js';
import { ANIMATIONS, EASINGS } from '../../lib/theme/css.js';
import { Group, Field, Text, Area, Select, Toggle, Num, Color, Seg, BoxSides, parseValue } from './controls.jsx';
import { findElementNode } from './Overlay.jsx';
import { Trash, Copy, Refresh } from '../icons.jsx';

const FONT_STACKS = [
  { value: 'var(--font-serif)', label: 'Heading font' },
  { value: 'var(--font-sans)', label: 'Body font' },
  { value: "'Newsreader Variable', serif", label: 'Newsreader' },
  { value: "'Source Serif 4 Variable', serif", label: 'Source Serif' },
  { value: "'Open Sans', sans-serif", label: 'Open Sans' },
  { value: 'ui-monospace, monospace', label: 'Monospace' },
  { value: 'system-ui, sans-serif', label: 'System' }
];

const DISPLAYS = [
  { value: 'flex', label: t('Row/Column') }, { value: 'grid', label: t('Grid') },
  { value: 'block', label: t('Block') }, { value: 'inline-flex', label: t('Inline row') }, { value: 'none', label: t('Hidden') }
];

const JUSTIFY = [
  { value: 'flex-start', label: '⇤', title: t('Start') },
  { value: 'center', label: '↔', title: t('Center') },
  { value: 'flex-end', label: '⇥', title: t('End') },
  { value: 'space-between', label: '⇹', title: t('Space between') }
];

const ALIGN = [
  { value: 'flex-start', label: '⤒', title: t('Top') },
  { value: 'center', label: '↕', title: t('Middle') },
  { value: 'flex-end', label: '⤓', title: t('Bottom') },
  { value: 'stretch', label: '⇕', title: t('Stretch') }
];

const TEXT_ALIGN = [
  { value: 'left', label: '⯇', title: t('Left') },
  { value: 'center', label: '≡', title: t('Center') },
  { value: 'right', label: '⯈', title: t('Right') }
];

const STATES = [
  { id: 'hover', label: t('Hover') }, { id: 'active', label: t('Pressed') },
  { id: 'focus', label: t('Focus') }, { id: 'disabled', label: t('Disabled') }, { id: 'selected', label: t('Selected') }
];

const BREAKPOINTS = [
  { id: 'tablet', label: t('Tablet'), hint: t('1024px and below') },
  { id: 'mobile', label: t('Mobile'), hint: t('640px and below') }
];

// The style keys each panel owns. States and breakpoints reuse the same panels
// with a narrower set, which is what keeps five state tabs from feeling like
// five separate inspectors.
const STATE_PANELS = ['color', 'border', 'effects'];

function findOrderItem(id) {
  for (const g of ORDER_GROUPS) {
    const hit = g.items.find(i => i.id === id);
    if (hit) return { ...hit, group: g };
  }
  return null;
}

/* What the element is actually rendering right now, read off the live DOM. It
   is shown in the controls so an admin edits from the real numbers instead of
   from an empty box, but it is never written to the document: an untouched
   property has to stay untouched, or "reset" would mean nothing. */
const COMPUTED_KEYS = [
  'display', 'position', 'top', 'left', 'flexDirection', 'justifyContent', 'alignItems', 'flexWrap', 'flexGrow', 'gap', 'gridTemplateColumns',
  'width', 'minWidth', 'maxWidth', 'height', 'minHeight',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight',
  'textTransform', 'textAlign', 'textDecorationLine',
  'color', 'backgroundColor', 'backgroundImage', 'opacity',
  'borderRadius', 'borderWidth', 'borderStyle', 'borderColor',
  'boxShadow', 'backdropFilter', 'filter', 'transform', 'transition', 'cursor'
];

// Values a control is better off leaving blank than parroting back.
const EMPTY_COMPUTED = new Set(['none', 'normal', 'auto', 'rgba(0, 0, 0, 0)', 'matrix(1, 0, 0, 1, 0, 0)', '0s', 'all 0s ease 0s']);

function useComputed(selection, doc) {
  return useMemo(() => {
    void doc;
    if (!selection) return {};
    const node = selection.kind === 'node'
      ? document.querySelector(`[data-oq-node="${CSS.escape(selection.id)}"]`)
      : findElementNode(selection);
    if (!node) return {};
    const cs = getComputedStyle(node);
    const out = {};
    for (const key of COMPUTED_KEYS) {
      const v = cs[key];
      if (v == null || v === '' || EMPTY_COMPUTED.has(v)) continue;
      out[key] = String(v);
    }
    // The inspector calls it textDecoration; the browser reports the long name.
    if (out.textDecorationLine) out.textDecoration = out.textDecorationLine;
    return out;
  }, [selection, doc]);
}

function sidesOf(style, prefix) {
  const cap = (s) => prefix + s[0].toUpperCase() + s.slice(1);
  const one = style?.[prefix];
  if (one && !style[cap('top')] && !style[cap('right')]) return { top: one, right: one, bottom: one, left: one };
  return { top: style?.[cap('top')] ?? '', right: style?.[cap('right')] ?? '', bottom: style?.[cap('bottom')] ?? '', left: style?.[cap('left')] ?? '' };
}

export default function Inspector({ selection, onSelect }) {
  const { doc, apply } = useTheme();
  const [tab, setTab] = useState('design');
  const [state, setState] = useState('');
  const [bp, setBp] = useState('');
  const [open, setOpen] = useState({ general: true, layout: true, size: true, spacing: true, type: true, color: true });

  const computed = useComputed(selection, doc);
  const node = selection?.kind === 'node' ? findNode(doc, selection.id) : null;
  const meta = selection?.kind === 'element' ? ELEMENT_INDEX.get(selection.id) : null;
  const itemMeta = selection?.kind === 'item' ? findOrderItem(selection.id) : null;

  if (!selection) {
    return (
      <aside className="bx-inspector">
        <div className="bx-empty">
          <b>{t('Nothing selected')}</b>
          <p>{t('Click any part of the interface to style it, or pick one from the Layers list.')}</p>
        </div>
      </aside>
    );
  }

  if (node) return <NodeInspector slot={node.slot} node={node.node} onSelect={onSelect} />;

  const id = selection.id;
  const cfg = doc.elements?.[id] || null;
  const caps = new Set(meta?.caps || ['layout', 'size', 'spacing', 'color', 'border', 'effects', 'motion', 'states', 'responsive']);
  const label = meta ? t(meta.label) : itemMeta ? t(itemMeta.label) : id;
  const edits = elementEditCount(cfg);

  const path = stylePath(id, { state: tab === 'states' ? state : '', breakpoint: tab === 'responsive' ? bp : '' });
  const style = getPath(doc, path) || {};
  const scoped = (tab === 'states' && state) || (tab === 'responsive' && bp);

  // Naming the property being written is what lets a slider drag collapse into a
  // single undo step instead of one per pixel.
  const stroke = (key) => path.join('.') + '.' + key;
  const set = (key, value) => apply(d => setPath(d, [...path, key], value), { coalesce: stroke(key) });
  const setSides = (prefix) => (v) => apply(d => {
    const cap = (s) => prefix + s[0].toUpperCase() + s.slice(1);
    setPath(d, [...path, prefix], '');
    for (const s of ['top', 'right', 'bottom', 'left']) setPath(d, [...path, cap(s)], v[s]);
    return d;
  }, { coalesce: stroke(prefix) });
  const has = (key) => style[key] != null && style[key] !== '';
  // Only the element's own tab shows live values; a hover or breakpoint override
  // has no separate computed form to read.
  const base = (key) => (scoped ? '' : computed[key] || '');
  const baseSides = (prefix) => (scoped ? undefined : sidesOf(computed, prefix));
  const clear = (key) => () => set(key, '');
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const showPanel = (name) => {
    if (!scoped) return caps.has(name) || name === 'general';
    return STATE_PANELS.includes(name) || (tab === 'responsive' && ['layout', 'size', 'spacing', 'type'].includes(name));
  };

  return (
    <aside className="bx-inspector">
      <header className="bx-insp-head">
        <div className="bx-insp-title">
          <b>{label}</b>
          <span>{meta ? t(meta.sel) : itemMeta ? t('Layout position') : ''}</span>
        </div>
        <div className="bx-insp-acts">
          {edits > 0 && (
            <button type="button" className="bx-icon" title={t('Reset this element')} aria-label={t('Reset this element')}
              onClick={() => apply(d => resetElement(d, id))}><Refresh /></button>
          )}
        </div>
      </header>

      <nav className="bx-tabs" role="tablist" aria-label={t('Inspector sections')}>
        {[['design', t('Design')], ['states', t('States')], ['responsive', t('Responsive')], ['content', t('Content')]].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k}
            className={'bx-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>

      {tab === 'states' && (
        <div className="bx-subtabs">
          {STATES.map(s => (
            <button key={s.id} type="button" className={'bx-subtab' + (state === s.id ? ' on' : '')}
              onClick={() => setState(state === s.id ? '' : s.id)}>{s.label}</button>
          ))}
        </div>
      )}
      {tab === 'responsive' && (
        <div className="bx-subtabs">
          {BREAKPOINTS.map(b => (
            <button key={b.id} type="button" title={b.hint} className={'bx-subtab' + (bp === b.id ? ' on' : '')}
              onClick={() => setBp(bp === b.id ? '' : b.id)}>{b.label}</button>
          ))}
        </div>
      )}

      <div className="bx-insp-body">
        {tab === 'states' && !state && <p className="bx-hint pad">{t('Pick a state to style how this element looks when a user hovers, presses, focuses or disables it.')}</p>}
        {tab === 'responsive' && !bp && <p className="bx-hint pad">{t('Pick a screen size to override how this element behaves there. Anything left untouched keeps its desktop value.')}</p>}

        {tab === 'content' ? (
          <ContentPanel id={id} meta={meta} cfg={cfg} />
        ) : (tab === 'design' || (tab === 'states' && state) || (tab === 'responsive' && bp)) && (
          <>
            {showPanel('general') && !scoped && (
              <Group title={t('General')} open={open.general} onToggle={() => toggle('general')}>
                <Field label={t('Visible')}>
                  <Toggle on={!cfg?.hidden} label={t('Visible')} onChange={(v) => apply(d => setHidden(d, id, !v))} />
                </Field>
                {itemMeta && (
                  <p className="bx-hint">{t('Drag this item on the canvas, or in the Layers list, to change where it sits.')}</p>
                )}
                {(has('left') || has('top')) && (
                  <button type="button" className="bx-btn sm"
                    onClick={() => apply(d => {
                      for (const k of ['left', 'top', 'position']) setPath(d, [...path, k], '');
                      return d;
                    })}>
                    {t('Put back in place')}
                  </button>
                )}
              </Group>
            )}

            {tab === 'responsive' && bp && (
              <Group title={t('Visibility')} open onToggle={() => {}}>
                <Field label={t('Hide at this size')}>
                  <Toggle on={!!cfg?.responsive?.[bp]?.hidden} label={t('Hide at this size')}
                    onChange={(v) => apply(d => setHidden(d, id, v, bp))} />
                </Field>
              </Group>
            )}

            {showPanel('layout') && (
              <Group title={t('Layout')} open={open.layout} onToggle={() => toggle('layout')}>
                <Field label={t('Arrangement')} set={has('display')} onReset={clear('display')}>
                  <Select value={style.display} base={base('display')} onChange={(v) => set('display', v)} options={DISPLAYS} />
                </Field>
                <Field label={t('Direction')} set={has('flexDirection')} onReset={clear('flexDirection')}>
                  <Seg value={style.flexDirection} base={base('flexDirection')} onChange={(v) => set('flexDirection', v)} label={t('Direction')}
                    options={[{ value: 'row', label: '→' }, { value: 'column', label: '↓' }, { value: 'row-reverse', label: '←' }, { value: 'column-reverse', label: '↑' }]} />
                </Field>
                <Field label={t('Horizontal')} set={has('justifyContent')} onReset={clear('justifyContent')}>
                  <Seg value={style.justifyContent} base={base('justifyContent')} onChange={(v) => set('justifyContent', v)} label={t('Horizontal')} options={JUSTIFY} />
                </Field>
                <Field label={t('Vertical')} set={has('alignItems')} onReset={clear('alignItems')}>
                  <Seg value={style.alignItems} base={base('alignItems')} onChange={(v) => set('alignItems', v)} label={t('Vertical')} options={ALIGN} />
                </Field>
                <Field label={t('Gap')} set={has('gap')} onReset={clear('gap')}>
                  <Num value={style.gap} base={base('gap')} onChange={(v) => set('gap', v)} min={0} max={64} units={['px', 'rem']} />
                </Field>
                <Field label={t('Wrap')} set={has('flexWrap')} onReset={clear('flexWrap')}>
                  <Seg value={style.flexWrap} base={base('flexWrap')} onChange={(v) => set('flexWrap', v)} label={t('Wrap')}
                    options={[{ value: 'nowrap', label: t('No') }, { value: 'wrap', label: t('Yes') }]} />
                </Field>
                <Field label={t('Grow')} set={has('flexGrow')} onReset={clear('flexGrow')}>
                  <Num value={style.flexGrow} base={base('flexGrow')} onChange={(v) => set('flexGrow', v)} min={0} max={5} step={1} units={['none']} unit="none" />
                </Field>
                <Field label={t('Columns')} set={has('gridTemplateColumns')} onReset={clear('gridTemplateColumns')} wide>
                  <Text value={style.gridTemplateColumns} base={base('gridTemplateColumns')} onChange={(v) => set('gridTemplateColumns', v)} placeholder="repeat(3, 1fr)" mono />
                </Field>
                <Field label={t('Position')} set={has('position')} onReset={clear('position')} wide>
                  <Select value={style.position} base={base('position')} onChange={(v) => set('position', v)}
                    options={[
                      { value: 'static', label: t('In the flow') },
                      { value: 'relative', label: t('Nudged from its place') },
                      { value: 'absolute', label: t('Free, inside its parent') },
                      { value: 'fixed', label: t('Free, against the window') }
                    ]} />
                </Field>
                <Field label={t('Offset X')} set={has('left')} onReset={clear('left')}>
                  <Num value={style.left} base={base('left')} onChange={(v) => set('left', v)} min={-400} max={400} units={['px', '%', 'rem']} />
                </Field>
                <Field label={t('Offset Y')} set={has('top')} onReset={clear('top')}>
                  <Num value={style.top} base={base('top')} onChange={(v) => set('top', v)} min={-400} max={400} units={['px', '%', 'rem']} />
                </Field>
              </Group>
            )}

            {showPanel('size') && (
              <Group title={t('Size')} open={open.size} onToggle={() => toggle('size')}>
                <Field label={t('Width')} set={has('width')} onReset={clear('width')}>
                  <Num value={style.width} base={base('width')} onChange={(v) => set('width', v)} min={0} max={1200} units={['px', '%', 'rem', 'vw']} />
                </Field>
                <Field label={t('Min width')} set={has('minWidth')} onReset={clear('minWidth')}>
                  <Num value={style.minWidth} base={base('minWidth')} onChange={(v) => set('minWidth', v)} min={0} max={1200} units={['px', '%', 'rem']} />
                </Field>
                <Field label={t('Max width')} set={has('maxWidth')} onReset={clear('maxWidth')}>
                  <Num value={style.maxWidth} base={base('maxWidth')} onChange={(v) => set('maxWidth', v)} min={0} max={1600} units={['px', '%', 'rem']} />
                </Field>
                <Field label={t('Height')} set={has('height')} onReset={clear('height')}>
                  <Num value={style.height} base={base('height')} onChange={(v) => set('height', v)} min={0} max={900} units={['px', '%', 'rem', 'vh']} />
                </Field>
                <Field label={t('Min height')} set={has('minHeight')} onReset={clear('minHeight')}>
                  <Num value={style.minHeight} base={base('minHeight')} onChange={(v) => set('minHeight', v)} min={0} max={900} units={['px', '%', 'rem']} />
                </Field>
              </Group>
            )}

            {showPanel('spacing') && (
              <Group title={t('Spacing')} open={open.spacing} onToggle={() => toggle('spacing')}>
                <BoxSides label={t('Padding')} value={sidesOf(style, 'padding')} base={baseSides('padding')} onChange={setSides('padding')} max={80} />
                <BoxSides label={t('Margin')} value={sidesOf(style, 'margin')} base={baseSides('margin')} onChange={setSides('margin')} max={80} />
              </Group>
            )}

            {showPanel('type') && (
              <Group title={t('Typography')} open={open.type} onToggle={() => toggle('type')}>
                <Field label={t('Font')} set={has('fontFamily')} onReset={clear('fontFamily')} wide>
                  <Select value={style.fontFamily} base={base('fontFamily')} onChange={(v) => set('fontFamily', v)}
                    options={FONT_STACKS.map(f => ({ value: f.value, label: t(f.label) }))} />
                </Field>
                <Field label={t('Size')} set={has('fontSize')} onReset={clear('fontSize')}>
                  <Num value={style.fontSize} base={base('fontSize')} onChange={(v) => set('fontSize', v)} min={8} max={72} units={['px', 'rem', 'em']} />
                </Field>
                <Field label={t('Weight')} set={has('fontWeight')} onReset={clear('fontWeight')}>
                  <Num value={style.fontWeight} base={base('fontWeight')} onChange={(v) => set('fontWeight', v)} min={100} max={900} step={5} units={['none']} unit="none" />
                </Field>
                <Field label={t('Letter spacing')} set={has('letterSpacing')} onReset={clear('letterSpacing')}>
                  <Num value={style.letterSpacing} base={base('letterSpacing')} onChange={(v) => set('letterSpacing', v)} min={-3} max={12} step={0.1} units={['px', 'em']} />
                </Field>
                <Field label={t('Line height')} set={has('lineHeight')} onReset={clear('lineHeight')}>
                  <Num value={style.lineHeight} base={base('lineHeight')} onChange={(v) => set('lineHeight', v)} min={0.8} max={3} step={0.05} units={['none', 'px']} unit="none" />
                </Field>
                <Field label={t('Case')} set={has('textTransform')} onReset={clear('textTransform')}>
                  <Seg value={style.textTransform} base={base('textTransform')} onChange={(v) => set('textTransform', v)} label={t('Case')}
                    options={[{ value: 'none', label: 'Aa' }, { value: 'uppercase', label: 'AA' }, { value: 'lowercase', label: 'aa' }, { value: 'capitalize', label: 'Ab' }]} />
                </Field>
                <Field label={t('Align')} set={has('textAlign')} onReset={clear('textAlign')}>
                  <Seg value={style.textAlign} base={base('textAlign')} onChange={(v) => set('textAlign', v)} label={t('Align')} options={TEXT_ALIGN} />
                </Field>
                <Field label={t('Underline')} set={has('textDecoration')} onReset={clear('textDecoration')}>
                  <Seg value={style.textDecoration} base={base('textDecoration')} onChange={(v) => set('textDecoration', v)} label={t('Underline')}
                    options={[{ value: 'none', label: t('None') }, { value: 'underline', label: t('Yes') }]} />
                </Field>
              </Group>
            )}

            {showPanel('color') && (
              <Group title={t('Colors')} open={open.color} onToggle={() => toggle('color')}>
                <Field label={t('Text')} set={has('color')} onReset={clear('color')} wide>
                  <Color value={style.color} inherited={base('color')} onChange={(v) => set('color', v)} />
                </Field>
                <Field label={t('Background')} set={has('backgroundColor')} onReset={clear('backgroundColor')} wide>
                  <Color value={style.backgroundColor} inherited={base('backgroundColor')} onChange={(v) => set('backgroundColor', v)} />
                </Field>
                <Field label={t('Gradient')} set={has('backgroundImage')} onReset={clear('backgroundImage')} wide>
                  <Text value={style.backgroundImage} base={base('backgroundImage')} onChange={(v) => set('backgroundImage', v)}
                    placeholder="linear-gradient(180deg, #333, #111)" mono />
                </Field>
                <Field label={t('Opacity')} set={has('opacity')} onReset={clear('opacity')}>
                  <Num value={style.opacity} base={base('opacity')} onChange={(v) => set('opacity', v)} min={0} max={1} step={0.05} units={['none']} unit="none" />
                </Field>
              </Group>
            )}

            {showPanel('border') && (
              <Group title={t('Borders')} open={open.border} onToggle={() => toggle('border')}>
                <Field label={t('Radius')} set={has('borderRadius')} onReset={clear('borderRadius')}>
                  <Num value={style.borderRadius} base={base('borderRadius')} onChange={(v) => set('borderRadius', v)} min={0} max={48} units={['px', '%', 'rem']} />
                </Field>
                <Field label={t('Width')} set={has('borderWidth')} onReset={clear('borderWidth')}>
                  <Num value={style.borderWidth} base={base('borderWidth')} onChange={(v) => set('borderWidth', v)} min={0} max={12} units={['px']} />
                </Field>
                <Field label={t('Style')} set={has('borderStyle')} onReset={clear('borderStyle')}>
                  <Select value={style.borderStyle} base={base('borderStyle')} onChange={(v) => set('borderStyle', v)}
                    options={[{ value: 'solid', label: t('Solid') }, { value: 'dashed', label: t('Dashed') }, { value: 'dotted', label: t('Dotted') }, { value: 'none', label: t('None') }]} />
                </Field>
                <Field label={t('Color')} set={has('borderColor')} onReset={clear('borderColor')} wide>
                  <Color value={style.borderColor} inherited={base('borderColor')} onChange={(v) => set('borderColor', v)} />
                </Field>
              </Group>
            )}

            {showPanel('effects') && (
              <Group title={t('Effects')} open={open.effects} onToggle={() => toggle('effects')}>
                <Field label={t('Shadow')} set={has('boxShadow')} onReset={clear('boxShadow')} wide>
                  <Select value={style.boxShadow} base={base('boxShadow')} onChange={(v) => set('boxShadow', v)}
                    options={[
                      { value: 'none', label: t('None') },
                      { value: 'var(--oq-shadow-sm)', label: t('Small') },
                      { value: 'var(--oq-shadow-md)', label: t('Medium') },
                      { value: 'var(--oq-shadow-lg)', label: t('Large') },
                      { value: 'inset 0 0 0 1px rgba(255,255,255,.1)', label: t('Inner hairline') }
                    ]} />
                </Field>
                <Field label={t('Blur behind')} set={has('backdropFilter')} onReset={clear('backdropFilter')} wide>
                  <Text value={style.backdropFilter} base={base('backdropFilter')} onChange={(v) => set('backdropFilter', v)} placeholder="blur(12px)" mono />
                </Field>
                <Field label={t('Filter')} set={has('filter')} onReset={clear('filter')} wide>
                  <Text value={style.filter} base={base('filter')} onChange={(v) => set('filter', v)} placeholder="saturate(1.2)" mono />
                </Field>
                <Field label={t('Transform')} set={has('transform')} onReset={clear('transform')} wide>
                  <Text value={style.transform} base={base('transform')} onChange={(v) => set('transform', v)} placeholder="scale(1.02)" mono />
                </Field>
              </Group>
            )}

            {showPanel('motion') && !scoped && (
              <Group title={t('Animation')} open={open.motion} onToggle={() => toggle('motion')}
                hint={t('Entrance animation plays when the element first appears. Transition speed controls how state changes ease.')}>
                <Field label={t('Entrance')} set={!!cfg?.animation?.name} onReset={() => apply(d => setPath(d, ['elements', id, 'animation'], ''))} wide>
                  <Select value={cfg?.animation?.name} placeholder={t('None')}
                    onChange={(v) => apply(d => setPath(d, ['elements', id, 'animation'], v && v !== 'none'
                      ? { name: v, duration: cfg?.animation?.duration || 260, easing: cfg?.animation?.easing || 'ease', delay: cfg?.animation?.delay || 0 } : ''))}
                    options={ANIMATIONS.filter(a => a.id !== 'none').map(a => ({ value: a.id, label: t(a.label) }))} />
                </Field>
                {cfg?.animation?.name && (
                  <>
                    <Field label={t('Duration')}>
                      <Num value={String(cfg.animation.duration || 260)} unit="none" units={['none']} min={0} max={2000} step={20}
                        onChange={(v) => apply(d => setPath(d, ['elements', id, 'animation', 'duration'], Number(v) || 0), { coalesce: id + '.animation.duration' })} />
                    </Field>
                    <Field label={t('Delay')}>
                      <Num value={String(cfg.animation.delay || 0)} unit="none" units={['none']} min={0} max={2000} step={20}
                        onChange={(v) => apply(d => setPath(d, ['elements', id, 'animation', 'delay'], Number(v) || 0), { coalesce: id + '.animation.delay' })} />
                    </Field>
                    <Field label={t('Easing')} wide>
                      <Select value={cfg.animation.easing} placeholder="ease"
                        onChange={(v) => apply(d => setPath(d, ['elements', id, 'animation', 'easing'], v))}
                        options={EASINGS.map(e => ({ value: e.id, label: t(e.label) }))} />
                    </Field>
                  </>
                )}
                <Field label={t('Transition')} set={has('transition')} onReset={clear('transition')} wide>
                  <Text value={style.transition} base={base('transition')} onChange={(v) => set('transition', v)} placeholder="all .18s ease" mono />
                </Field>
                <Field label={t('Cursor')} set={has('cursor')} onReset={clear('cursor')}>
                  <Select value={style.cursor} base={base('cursor')} onChange={(v) => set('cursor', v)}
                    options={[{ value: 'pointer', label: t('Pointer') }, { value: 'default', label: t('Arrow') }, { value: 'not-allowed', label: t('Blocked') }, { value: 'text', label: t('Text') }]} />
                </Field>
              </Group>
            )}

            <Advanced style={style} onSet={set} />
          </>
        )}
      </div>
    </aside>
  );
}

/* ---------- content ---------- */

function ContentPanel({ id, meta, cfg }) {
  const { apply } = useTheme();
  const keys = meta?.content || [];

  if (!keys.length) {
    return (
      <div className="bx-pad">
        <p className="bx-hint">{t('This element has no editable text of its own. Interface labels live under Content in the left panel.')}</p>
      </div>
    );
  }

  return (
    <Group title={t('Text')} open onToggle={() => {}}
      hint={t('Use a placeholder such as {{user.name}} to show live data instead of fixed text.')}>
      {keys.map(k => (
        <Field key={k.key} label={t(k.label)} wide
          set={!!cfg?.content?.[k.key]}
          onReset={() => apply(d => setPath(d, ['elements', id, 'content', k.key], ''))}>
          {k.type === 'textarea'
            ? <Area value={cfg?.content?.[k.key]} onChange={(v) => apply(d => setPath(d, ['elements', id, 'content', k.key], v), { coalesce: id + '.content.' + k.key })} />
            : <Text value={cfg?.content?.[k.key]} onChange={(v) => apply(d => setPath(d, ['elements', id, 'content', k.key], v), { coalesce: id + '.content.' + k.key })} />}
        </Field>
      ))}
      <PlaceholderChips onPick={(tok) => {
        const k = keys[0];
        apply(d => setPath(d, ['elements', id, 'content', k.key], String(getPath(d, ['elements', id, 'content', k.key]) || '') + tok));
      }} />
    </Group>
  );
}

export function PlaceholderChips({ onPick }) {
  return (
    <div className="bx-placeholders">
      <span className="bx-ph-label">{t('Insert')}</span>
      {PLACEHOLDERS.map(p => (
        <button key={p.token} type="button" className="bx-ph" title={t(p.label)} onClick={() => onPick(p.token)}>
          {p.token}
        </button>
      ))}
    </div>
  );
}

/* ---------- advanced ---------- */

function Advanced({ style, onSet }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [val, setVal] = useState('');
  const known = new Set(['display', 'position', 'top', 'left', 'flexDirection', 'justifyContent', 'alignItems', 'gap', 'flexWrap', 'flexGrow', 'gridTemplateColumns',
    'width', 'minWidth', 'maxWidth', 'height', 'minHeight', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight',
    'textTransform', 'textAlign', 'textDecoration', 'color', 'backgroundColor', 'backgroundImage', 'opacity',
    'borderRadius', 'borderWidth', 'borderStyle', 'borderColor', 'boxShadow', 'backdropFilter', 'filter', 'transform',
    'transition', 'cursor', 'padding', 'margin',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'order']);
  const extra = Object.keys(style).filter(k => !known.has(k));

  return (
    <Group title={t('Advanced')} open={open} onToggle={() => setOpen(o => !o)} count={extra.length}
      hint={t('Set any supported CSS property directly. Values are checked before they are saved.')}>
      {extra.map(k => (
        <Field key={k} label={k} set onReset={() => onSet(k, '')} wide>
          <Text value={style[k]} onChange={(v) => onSet(k, v)} mono />
        </Field>
      ))}
      <div className="bx-adv-add">
        <input className="bx-input mono" placeholder="borderTop" value={key} onChange={(e) => setKey(e.target.value)} />
        <input className="bx-input mono" placeholder="1px solid #333" value={val} onChange={(e) => setVal(e.target.value)} />
        <button type="button" className="bx-btn" disabled={!key.trim() || !val.trim()}
          onClick={() => { onSet(key.trim(), val.trim()); setKey(''); setVal(''); }}>{t('Add')}</button>
      </div>
    </Group>
  );
}

/* ---------- inserted nodes ---------- */

function NodeInspector({ slot, node, onSelect }) {
  const { apply } = useTheme();
  const type = NODE_INDEX.get(node.type);
  const setProp = (k, v) => apply(d => updateNode(d, slot, node.id, { props: { ...node.props, [k]: v } }), { coalesce: node.id + '.props.' + k });
  const setStyle = (k, v) => apply(d => {
    const style = { ...(node.style || {}) };
    if (v === '' || v == null) delete style[k]; else style[k] = v;
    return updateNode(d, slot, node.id, { style });
  }, { coalesce: node.id + '.style.' + k });
  const st = node.style || {};

  return (
    <aside className="bx-inspector">
      <header className="bx-insp-head">
        <div className="bx-insp-title">
          <b>{t(type?.label || node.type)}</b>
          <span>{t('Added element')}</span>
        </div>
        <div className="bx-insp-acts">
          <button type="button" className="bx-icon" title={t('Duplicate')} aria-label={t('Duplicate')}
            onClick={() => apply(d => duplicateNode(d, slot, node.id))}><Copy /></button>
          <button type="button" className="bx-icon danger" title={t('Delete')} aria-label={t('Delete')}
            onClick={() => { apply(d => removeNode(d, slot, node.id)); onSelect(null); }}><Trash /></button>
        </div>
      </header>
      <div className="bx-insp-body">
        <Group title={t('Content')} open onToggle={() => {}}>
          {(type?.props || []).map(p => (
            <Field key={p.key} label={t(p.label)} wide>
              {p.type === 'textarea'
                ? <Area value={node.props?.[p.key]} onChange={(v) => setProp(p.key, v)} placeholder={p.def} />
                : <Text value={node.props?.[p.key]} onChange={(v) => setProp(p.key, v)} placeholder={p.def} />}
            </Field>
          ))}
          {(type?.props || []).some(p => p.key === 'text') && (
            <PlaceholderChips onPick={(tok) => setProp('text', String(node.props?.text || '') + tok)} />
          )}
        </Group>
        <Group title={t('Spacing')} open onToggle={() => {}}>
          <BoxSides label={t('Padding')} value={sidesOf(st, 'padding')} onChange={(v) => {
            setStyle('padding', '');
            for (const s of ['top', 'right', 'bottom', 'left']) setStyle('padding' + s[0].toUpperCase() + s.slice(1), v[s]);
          }} />
          <BoxSides label={t('Margin')} value={sidesOf(st, 'margin')} onChange={(v) => {
            setStyle('margin', '');
            for (const s of ['top', 'right', 'bottom', 'left']) setStyle('margin' + s[0].toUpperCase() + s.slice(1), v[s]);
          }} />
        </Group>
        <Group title={t('Typography')} open onToggle={() => {}}>
          <Field label={t('Size')}><Num value={st.fontSize} onChange={(v) => setStyle('fontSize', v)} min={8} max={64} units={['px', 'rem']} /></Field>
          <Field label={t('Weight')}><Num value={st.fontWeight} onChange={(v) => setStyle('fontWeight', v)} min={100} max={900} step={50} units={['none']} unit="none" /></Field>
          <Field label={t('Align')}><Seg value={st.textAlign} onChange={(v) => setStyle('textAlign', v)} label={t('Align')} options={TEXT_ALIGN} /></Field>
        </Group>
        <Group title={t('Colors')} open onToggle={() => {}}>
          <Field label={t('Text')} wide><Color value={st.color} onChange={(v) => setStyle('color', v)} /></Field>
          <Field label={t('Background')} wide><Color value={st.backgroundColor} onChange={(v) => setStyle('backgroundColor', v)} /></Field>
        </Group>
        <Group title={t('Borders')} open onToggle={() => {}}>
          <Field label={t('Radius')}><Num value={st.borderRadius} onChange={(v) => setStyle('borderRadius', v)} min={0} max={40} units={['px']} /></Field>
          <Field label={t('Width')}><Num value={st.borderWidth} onChange={(v) => setStyle('borderWidth', v)} min={0} max={8} units={['px']} /></Field>
          <Field label={t('Color')} wide><Color value={st.borderColor} onChange={(v) => setStyle('borderColor', v)} /></Field>
        </Group>
      </div>
    </aside>
  );
}

export { parseValue };
