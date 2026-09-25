import { useState } from 'react';
import { getUserFont, setUserFont, currentPreset } from '../../lib/prefs.js';
import { palettesFor, themeValue } from '../../lib/palettes.js';
import { t, tk } from '../../i18n.jsx';
import { SetRow, SwitchRow, SegSlide, SelectRow, RangeRow } from '../ui/controls.jsx';
import { resolveReveal, revealSpeedMs } from '../../lib/reveal.js';

// No zero stop: "no reveal at all" is the Instant *style*, so offering it here
// too would be the same state reachable two ways. A pref already stored as 0
// still works and surfaces as its own chip below.
const REVEAL_STOPS = [
  { v: 15, label: tk('Fast') },
  { v: 40, label: tk('Normal') },
  { v: 70, label: tk('Relaxed') },
];

// Adding a style is one entry here plus one in REVEAL_STYLES; removing one is
// safe on its own, since resolveReveal falls a retired value back to the default.
const REVEAL_STYLE_OPTS = [
  { v: 'instant', label: tk('Instant'), note: tk('Text appears the moment it arrives.') },
  { v: 'modern', label: tk('Modern'), note: tk('Words fade in as they arrive and your message rises to the top.') },
  { v: 'legacy', label: tk('Legacy'), note: tk('Letters type out one after another.') },
];

const FONT_OPTIONS = [
  { v: 'literata', label: 'Literata', font: "'Literata Variable', serif" },
  { v: 'newsreader', label: 'Newsreader', font: "'Newsreader Variable', serif" },
  { v: 'sans', label: 'Open Sans', font: "'Open Sans', sans-serif" }
];

const clampInt = (v, lo, hi, def) => Math.max(lo, Math.min(hi, parseInt(v) || def));

export default function InterfaceTab({ prefs, setPref, cfg }) {
  const preset = currentPreset();
  const [userFont, setUserFontState] = useState(getUserFont());
  const rv = revealSpeedMs(prefs.revealMs);
  const revealAvailable = cfg?.uiPreset !== 'openai';
  const style = resolveReveal(prefs, 'anthropic');
  const styleOpt = REVEAL_STYLE_OPTS.find(o => o.v === style) || REVEAL_STYLE_OPTS[0];
  const cursorStyle = prefs.cursorStyle === 'circle' ? 'circle' : 'block';
  const knownStop = REVEAL_STOPS.some(o => o.v === rv);

  return (
    <>
      <div className="hint">{t("How this app looks on your device. These are your own preferences; the layout itself is set by an administrator.")}</div>
      <div className="me-section-h">{t("Appearance")}</div>
      <SetRow label={t("Theme")} desc={t("Follow your system, or pick a palette. Colours only, the layout never changes.")}>
        <SelectRow label={t("Theme")} value={themeValue(prefs.theme, preset)} onPick={(v) => setPref('theme', v)}
          options={[{ v: 'system', label: t('System') }].concat(palettesFor(preset).map(p => ({ v: p.id, label: p.label })))} />
      </SetRow>
      <SetRow label={t("Chat font")} desc={t("Overrides the theme's default font, on this device only.")}>
        <SelectRow label={t("Chat font")} value={userFont}
          onPick={(v) => { setUserFontState(v); setUserFont(v); }}
          options={[{ v: 'default', label: t('Theme default') }, ...FONT_OPTIONS]} />
      </SetRow>
      <SetRow label={t("Message density")} desc={t("Vertical spacing between messages.")}>
        <SegSlide label={t("Message density")} value={prefs.density || 'comfortable'} onPick={(v) => setPref('density', v)}
          options={[{ v: 'comfortable', label: t('Comfortable') }, { v: 'compact', label: t('Compact') }]} />
      </SetRow>
      <SetRow label={t("Reading width")} desc={t("How wide the conversation column runs. Wide suits tables and code.")}>
        <SegSlide label={t("Reading width")} value={prefs.readWidth === 'wide' ? 'wide' : 'normal'} onPick={(v) => setPref('readWidth', v)}
          options={[{ v: 'normal', label: t('Comfortable') }, { v: 'wide', label: t('Wide') }]} />
      </SetRow>
      <SwitchRow label={t("OLED screen protection")} desc={t("Nudges the interface a few pixels and eases brightness to limit burn-in.")}
        on={prefs.oledShift} onToggle={() => setPref('oledShift', !prefs.oledShift)} />

      <div className="me-section-h">{t("Streaming text")}</div>
      {revealAvailable && (
        <SetRow label={t("Text reveal")} desc={t(styleOpt.note)}>
          <SegSlide label={t("Text reveal")} value={style} onPick={(v) => setPref('revealStyle', v)}
            options={REVEAL_STYLE_OPTS.map(o => ({ v: o.v, label: t(o.label) }))} />
        </SetRow>
      )}
      {revealAvailable && style === 'legacy' && (
        <SetRow label={t("Reveal speed")} desc={t("How quickly text appears once it has arrived, not how fast the model replies.")}>
          <SegSlide label={t("Reveal speed")} value={knownStop ? rv : -1} onPick={(v) => setPref('revealMs', v)}
            options={REVEAL_STOPS.map(o => ({ v: o.v, label: t(o.label) })).concat(knownStop ? [] : [{ v: -1, label: rv + ' ms' }])} />
        </SetRow>
      )}
      <SwitchRow label={t("Streaming cursor")} desc={t("Show a soft cursor at the write position as text streams in.")}
        on={prefs.streamCursor} onToggle={() => setPref('streamCursor', !prefs.streamCursor)} />
      {!!prefs.streamCursor && (
        <SetRow label={t("Cursor style")}>
          <SegSlide label={t("Cursor style")} value={cursorStyle} onPick={(v) => setPref('cursorStyle', v)}
            options={[{ v: 'block', label: t('Block') }, { v: 'circle', label: t('Circle') }]} />
        </SetRow>
      )}
      {!!prefs.streamCursor && cursorStyle === 'block' && (
        <SetRow label={t("Blink speed")} desc={t("Idle blink rate. It stays solid while text streams, like a terminal.")}>
          <RangeRow label={t("Blink speed")} value={clampInt(prefs.cursorBlinkMs, 150, 2000, 500)} min="150" max="2000" step="50" def={500}
            format={(v) => v + ' ms'} onChange={(v) => setPref('cursorBlinkMs', v)} />
        </SetRow>
      )}
      {!!prefs.streamCursor && cursorStyle === 'circle' && (
        <SetRow label={t("Pulse speed")} desc={t("How quickly the circle grows and shrinks.")}>
          <RangeRow label={t("Pulse speed")} value={clampInt(prefs.cursorPulseMs, 300, 4000, 1000)} min="300" max="4000" step="100" def={1000}
            format={(v) => v + ' ms'} onChange={(v) => setPref('cursorPulseMs', v)} />
        </SetRow>
      )}

      <div className="me-section-h">{t("Navigation")}</div>
      <div className="sec-note">{t("Tools for moving around a long conversation. Turn any off for a bare view.")}</div>
      <SwitchRow label={t("Conversation map")} desc={t("A rail down the right edge with one mark per turn. Click a mark to jump.")}
        on={prefs.threadRail !== false} onToggle={() => setPref('threadRail', prefs.threadRail === false)} />
      <SwitchRow label={t("Find in conversation")} desc={t("Search the open chat from the header. Off gives Ctrl+F back to the browser.")}
        on={prefs.threadFind !== false} onToggle={() => setPref('threadFind', prefs.threadFind === false)} />
      <SwitchRow label={t("Branch map")} desc={t("A header button showing the whole conversation, every branch included.")}
        on={prefs.branchMap !== false} onToggle={() => setPref('branchMap', prefs.branchMap === false)} />
      <SwitchRow label={t("Contents")} desc={t("A header button listing the headings in the assistant's replies. Click one to jump.")}
        on={prefs.threadOutline !== false} onToggle={() => setPref('threadOutline', prefs.threadOutline === false)} />
      <SwitchRow label={t("Message shortcuts")} desc={t("J and K move between messages; C copies, E edits, R retries, Y branches.")}
        on={prefs.msgKeys !== false} onToggle={() => setPref('msgKeys', prefs.msgKeys === false)} />
    </>
  );
}
