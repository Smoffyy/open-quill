import { useState, useRef, useEffect } from 'react';
import { api } from '../api.js';
import { applyPrefs, ACCENT_PRESETS, getUserFont, setUserFont, currentPreset } from '../prefs.js';
import { palettesFor, themeValue } from '../lib/palettes.js';
import { Sun, Gear, Sliders, Info, Chevron, Check, Clock, Download, Upload, Shield, Trash, Brain, Refresh, Keyboard, Search } from './icons.jsx';
import Markdown from './Markdown.jsx';
import KeybindsPanel from './KeybindsPanel.jsx';
import { t, tk, useI18n } from '../i18n.jsx';
import { STATUS_DELAY_DEFAULT, STATUS_DELAY_MAX, statusDelaySecs } from '../lib/status.js';
import { menuStyleOf, useAnchoredMenu } from '../lib/anchor.js';
import { createPortal } from 'react-dom';
import { SetRow, SwitchRow, SegSlide, SelectRow, useSelectMenu } from './settingsui.jsx';
import { legacyRevealStyle, resolveReveal, revealSpeedMs } from '../lib/reveal.js';
import { BRAND_ICON } from '../lib/brand.js';

const NAV_GROUPS = [
  { label: tk('Account'), items: [
    { id: 'general', label: tk('General'), Icon: Gear },
    { id: 'security', label: tk('Security'), Icon: Shield },
  ] },
  { label: tk('Interface'), items: [
    { id: 'appearance', label: tk('Appearance'), Icon: Sun },
    { id: 'chat', label: tk('Chat'), Icon: Sliders },
    { id: 'keybinds', label: tk('Keybinds'), Icon: Keyboard },
  ] },
  { label: tk('Insights'), items: [
    { id: 'memory', label: tk('Memory'), Icon: Brain, needs: 'memoryFeature' },
    { id: 'usage', label: tk('Usage'), Icon: Clock },
  ] },
  { label: tk('About'), items: [
    { id: 'version', label: tk('Version'), Icon: Info },
  ] },
];

const SETTINGS_INDEX = {
  __proto__: null,
  general: [tk('What should we call you?'), tk('Language'), tk('Instructions for the Assistant'), tk('Export everything'), tk('Import')],
  security: [tk('Password'), tk('Two-factor authentication'), tk('Active sessions')],
  appearance: [tk('Theme'), tk('Motion'), tk('Chat font'), tk('Message density'), tk('Accent colour'), tk('OLED screen protection'), tk('Staggered open')],
  chat: [
    tk('Text reveal'), tk('Reveal speed'), tk('Auto-scroll'), tk('Streaming cursor'), tk('Cursor style'),
    tk('Blink speed'), tk('Pulse speed'), tk('Conversation map'), tk('Find in conversation'), tk('Branch map'),
    tk('Message shortcuts'), tk('Web search on by default'), tk('Engine telemetry'), tk('Context gauge'),
    tk('Speed on each reply'), tk('Progress line delay'), tk('Context ledger on open'), tk('Mid-stream steering'),
  ],
  memory: [tk('Use memory in chats'), tk('Update from recent chats'), tk('Forget everything')],
  usage: [tk('Usage window'), tk('By model')],
};

function Marked({ text, needle }) {
  if (!needle) return text;
  const at = text.toLowerCase().indexOf(needle);
  if (at === -1) return text;
  return <>{text.slice(0, at)}<span className="ms-hit">{text.slice(at, at + needle.length)}</span>{text.slice(at + needle.length)}</>;
}

function searchSettings(needle, cfg) {
  const out = [];
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (it.needs && !cfg?.[it.needs]) continue;
      const page = t(it.label);
      const pageHit = page.toLowerCase().includes(needle);
      const hits = (SETTINGS_INDEX[it.id] || []).map(s => t(s)).filter(s => s.toLowerCase().includes(needle));
      if (pageHit || hits.length) out.push({ ...it, page, pageHit, hits });
    }
  }
  return out;
}

function SettingsNav({ tab, setTab, cfg }) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef(null);
  const menuRef = useRef(null);
  const needle = q.trim().toLowerCase();
  const results = needle ? searchSettings(needle, cfg) : [];
  const open = !!needle;
  const pos = useAnchoredMenu(open, () => setQ(''), boxRef, menuRef, { align: 'left', minWidth: 280, gap: 4 });

  useEffect(() => { setCursor(0); }, [q]);

  function pick(id) { setTab(id); setQ(''); }
  function onKey(e) {
    if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); return; }
    if (!results.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => (c + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => (c - 1 + results.length) % results.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[Math.min(cursor, results.length - 1)].id); }
  }

  return (
    <div className="modal-side">
      <h2 className="sr-only">{t('Settings')}</h2>
      <div className="ms-searchbox" ref={boxRef}>
        <div className="ms-search">
          <Search />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            placeholder={t('Search')} aria-label={t('Search settings')} />
        </div>
        {open && createPortal(
          <div className="ms-results" role="listbox" ref={menuRef}
            style={menuStyleOf(pos, { width: 280, maxHeight: Math.min(320, (pos && pos.maxH) || 320), overflow: 'hidden auto' })}>
            {!results.length && <div className="ms-empty">{t('No matching settings')}</div>}
            {results.map((r, i) => (
              <div key={r.id} className="ms-res">
                <button className={'ms-res-page' + (i === cursor ? ' on' : '')} role="option" aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)} onClick={() => pick(r.id)}>
                  <r.Icon />
                  <span className="ms-res-name"><Marked text={r.page} needle={needle} /></span>
                </button>
                {!r.pageHit && r.hits.length === 1 && (
                  <button className="ms-res-sub" onClick={() => pick(r.id)}><Marked text={r.hits[0]} needle={needle} /></button>
                )}
                {r.hits.length > 1 && r.hits.map(h => (
                  <button key={h} className="ms-res-line" onClick={() => pick(r.id)}>
                    <span className="ms-res-name"><Marked text={h} needle={needle} /></span>
                  </button>
                ))}
              </div>
            ))}
          </div>, document.body)}
      </div>
      <div className="ms-nav">
        {NAV_GROUPS.map(g => {
          const items = g.items.filter(i => !i.needs || cfg?.[i.needs]);
          if (!items.length) return null;
          return (
            <div className="ms-sec" key={g.label}>
              <div className="ms-group">{t(g.label)}</div>
              {items.map(({ id, label, Icon }) => (
                <button key={id} className={'modal-tab' + (tab === id ? ' active' : '')} onClick={() => setTab(id)}>
                  <Icon /> {t(label)}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
  { v: 'typewriter', label: tk('Typewriter'), note: tk('Letters type out one after another.') },
];

function Toggle({ prefs, setPref, k, label, desc }) {
  return <SwitchRow label={label} desc={desc} on={!!prefs[k]} onToggle={() => setPref(k, !prefs[k])} />;
}

const ACCENT_NAMES = [tk('Clay'), tk('Blue'), tk('Green'), tk('Violet'), tk('Pink'), tk('Amber'), tk('Teal'), tk('Slate')];

function AccentSelect({ value, onPick }) {
  const { open, setOpen, btnRef, menuRef, pos } = useSelectMenu();
  const opts = ACCENT_PRESETS.map((c, i) => ({ v: c, label: t(ACCENT_NAMES[i] || c) }));
  const hit = opts.find(o => o.v === value);
  const swatch = value || 'var(--accent)';
  return (
    <div className={'set-select' + (open ? ' open' : '')}>
      <button ref={btnRef} type="button" className="set-select-trigger" aria-haspopup="listbox" aria-expanded={open}
        aria-label={t('Accent colour')} onClick={() => setOpen(o => !o)}>
        <span className="accent-dot" style={{ background: swatch }} />
        <span>{hit ? hit.label : (value ? t('Custom') : t('Theme default'))}</span>
        <Chevron style={{ width: 14 }} />
      </button>
      {open && createPortal(
        <div ref={menuRef} className="set-select-menu portal" role="listbox" style={menuStyleOf(pos, { minWidth: 224 })}>
          <button type="button" role="option" aria-selected={!value}
            className={'set-select-opt' + (!value ? ' on' : '')} onClick={() => { onPick(''); setOpen(false); }}>
            <span className="accent-dot" style={{ background: 'var(--accent)' }} />
            <span className="accent-name">{t('Theme default')}</span>
            {!value && <Check />}
          </button>
          {opts.map(o => (
            <button key={o.v} type="button" role="option" aria-selected={o.v === value}
              className={'set-select-opt' + (o.v === value ? ' on' : '')} onClick={() => { onPick(o.v); setOpen(false); }}>
              <span className="accent-dot" style={{ background: o.v }} />
              <span className="accent-name">{o.label}</span>
              {o.v === value && <Check />}
            </button>
          ))}
          <label className="set-select-opt accent-custom">
            <span className="accent-dot" style={{ background: hit || !value ? 'conic-gradient(from 180deg, #d97757, #4f8ff7, #46b07a, #e0a93c, #d97757)' : value }} />
            <span className="accent-name">{t('Custom…')}</span>
            <input type="color" value={value || '#d97757'}
              onChange={(e) => onPick(e.target.value)} />
          </label>
        </div>, document.body)}
    </div>
  );
}

function parseVersion(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const [base, ...restArr] = s.split('-');
  const rest = restArr.join('-');
  let channel = '', build = '';
  if (rest) {
    const mm = rest.match(/^([a-z]+)[.\-_]?(\d+)?$/i);
    if (mm) { channel = mm[1]; build = mm[2] || ''; }
    else channel = rest;
  }
  const year = (base.match(/^(\d{4})/) || [])[1] || '';
  return { full: s, base, channel, build, year };
}

// The server hands back a plain YYYY-MM-DD. Splitting it by hand rather than passing it to
// Date() keeps it off the UTC-parsing path, which would render the day before east of Greenwich.
function formatReleased(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function presetDefaults(isOpenai, fallbackTheme) {
  return {
    revealStyle: 'typewriter', autoscroll: true, theme: fallbackTheme || 'system', accent: '', density: 'comfortable',
    streamCursor: isOpenai, cursorStyle: isOpenai ? 'circle' : 'block',
    cursorBlinkMs: 500, cursorPulseMs: 1000, revealMs: 40, chatStagger: true, themeFade: true,
    oledShift: false, minimalAnims: false,
    threadRail: true, threadFind: true, branchMap: true, msgKeys: true, keybinds: {}
  };
}

export default function SettingsModal({ user, cfg, initialTab, onClose, onUpdated, onDeleted, onExportChats, onImportChats }) {
  const [tab, setTab] = useState(initialTab || 'general');
  const { lang: i18nLang, setLang: setAppLang, langs } = useI18n();
  const [name, setName] = useState(user.displayName);
  const [instructions, setInstructions] = useState(user.instructions || '');
  const instrRef = useRef(user.instructions || '');
  const importRef = useRef(null);
  const [prefs, setPrefs] = useState(() => {
    const applied = document.documentElement.getAttribute('data-theme');
    const fallbackTheme = (applied === 'anthropic' || applied === 'openai' || applied === 'oled') ? 'dark' : (applied || 'system');
    const isOpenai = document.documentElement.getAttribute('data-preset') === 'openai';
    const merged = { ...presetDefaults(isOpenai, fallbackTheme), ...user.prefs };
    // Seed the named style from the pre-split booleans (`typewriter`, and before
    // it `animations`), or someone who had the typewriter off gets it switched
    // back on the next time they open Settings. Nothing writes those keys any
    // more — this read is the only thing that still knows they existed.
    if (user.prefs && user.prefs.revealStyle == null) merged.revealStyle = legacyRevealStyle(user.prefs);
    if (!user.prefs || user.prefs.theme == null) merged.theme = fallbackTheme;
    if (merged.theme === 'oled') merged.theme = 'dark';
    return merged;
  });
  const activePreset = currentPreset();
  const [userFont, setUserFontState] = useState(getUserFont());
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [delErr, setDelErr] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearMsg, setClearMsg] = useState('');
  const saveTimer = useRef(null);
  const [usageData, setUsageData] = useState(null);
  const [usageErr, setUsageErr] = useState('');
  const [usageWindow, setUsageWindow] = useState('all');
  const [sessions, setSessions] = useState(null);
  const [sessionErr, setSessionErr] = useState('');
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  useEffect(() => {
    if (tab !== 'usage') return;
    let alive = true; setUsageErr(''); setUsageData(null);
    const q = usageWindow === 'all' ? '' : '?days=' + usageWindow;
    api.get('/api/me/usage' + q).then(d => { if (alive) setUsageData(d); }).catch(() => { if (alive) setUsageErr(t('Could not load usage.')); });
    return () => { alive = false; };
  }, [tab, usageWindow]);
  function loadSessions() {
    setSessionErr('');
    api.get('/api/me/sessions').then(d => setSessions(d.sessions || [])).catch(() => setSessionErr(t('Could not load sessions.')));
  }
  useEffect(() => { if (tab === 'security') loadSessions(); }, [tab]);
  const [release, setRelease] = useState(null);
  useEffect(() => {
    if (tab !== 'version' || release) return;
    let alive = true;
    api.get('/api/release').then(d => { if (alive) setRelease(d); }).catch(() => { if (alive) setRelease({}); });
    return () => { alive = false; };
  }, [tab, release]);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [twoFa, setTwoFa] = useState(user.twoFactor ? 'on' : 'off');
  const [setup, setSetup] = useState(null);
  const [setupCode, setSetupCode] = useState('');
  const [secErr, setSecErr] = useState('');
  const [recovery, setRecovery] = useState(null);
  const [disablePw, setDisablePw] = useState('');
  async function changePassword() {
    setPwErr(''); setPwMsg('');
    if (pw.next !== pw.confirm) { setPwErr(t('New passwords do not match.')); return; }
    if (pw.next.length < 4) { setPwErr(t('New password must be at least 4 characters.')); return; }
    try { await api.post('/api/me/password', { current: pw.current, next: pw.next }); setPw({ current: '', next: '', confirm: '' }); setPwMsg(t('Password updated. Other sessions were signed out.')); }
    catch (e) { setPwErr(e?.message || t('Could not change password.')); }
  }
  async function start2fa() {
    setSecErr(''); setRecovery(null);
    try { setSetup(await api.post('/api/me/2fa/setup', {})); }
    catch (e) { setSecErr(e?.message || t('Could not start setup.')); }
  }
  async function confirm2fa() {
    setSecErr('');
    try { const r = await api.post('/api/me/2fa/enable', { code: setupCode }); setSetup(null); setSetupCode(''); setTwoFa('on'); setRecovery(r.recoveryCodes); onUpdated?.({ ...user, twoFactor: true }); }
    catch (e) { setSecErr(e?.message || t('Invalid code.')); }
  }
  async function disable2fa() {
    setSecErr('');
    try { await api.post('/api/me/2fa/disable', { password: disablePw }); setTwoFa('off'); setDisablePw(''); setRecovery(null); onUpdated?.({ ...user, twoFactor: false }); }
    catch (e) { setSecErr(e?.message || t('Could not disable.')); }
  }
  async function regenRecovery() {
    setSecErr('');
    try { const r = await api.post('/api/me/2fa/recovery', { password: disablePw }); setDisablePw(''); setRecovery(r.recoveryCodes); }
    catch (e) { setSecErr(e?.message || t('Could not regenerate codes.')); }
  }
  async function revokeSession(id) {
    try { await api.del('/api/me/sessions/' + id); setSessions(s => (s || []).filter(x => x.id !== id)); }
    catch { setSessionErr(t('Could not revoke that session.')); }
  }
  async function revokeOthers() {
    try { await api.del('/api/me/sessions'); loadSessions(); }
    catch { setSessionErr(t('Could not revoke other sessions.')); }
  }
  const fmtN = (n) => Number(n || 0).toLocaleString();
  const fmtUsd = (n) => { const v = Number(n || 0); if (!v) return '$0.00'; return '$' + (v < 0.01 ? v.toFixed(6) : v.toFixed(4)); };
  const fmtWhen = (ts) => { if (!ts) return 'unknown'; const d = new Date(ts); const diff = Date.now() - ts; if (diff < 60000) return 'just now'; if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago'; if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago'; return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
  const deviceLabel = (ua) => { const s = String(ua || ''); if (/edg/i.test(s)) return 'Edge'; if (/chrome|crios/i.test(s)) return 'Chrome'; if (/firefox|fxios/i.test(s)) return 'Firefox'; if (/safari/i.test(s)) return 'Safari'; return 'Browser'; };
  const osLabel = (ua) => { const s = String(ua || ''); if (/windows/i.test(s)) return 'Windows'; if (/android/i.test(s)) return 'Android'; if (/iphone|ipad|ios/i.test(s)) return 'iOS'; if (/mac os|macintosh/i.test(s)) return 'macOS'; if (/linux/i.test(s)) return 'Linux'; return t('Unknown OS'); };

  function scheduleSave(nextName, nextPrefs) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        const { user: u } = await api.patch('/api/me', { displayName: nextName, prefs: nextPrefs, instructions: instrRef.current });
        onUpdated(u);
      } catch {}
    }, 450);
  }
  function changeName(v) { setName(v); scheduleSave(v, prefs); }
  function changeInstructions(v) { setInstructions(v); instrRef.current = v; scheduleSave(name, prefs); }

  async function clearChats() {
    setClearMsg('');
    try { const r = await api.del('/api/me/chats'); setConfirmClear(false); setClearMsg(`Deleted ${r.deleted || 0} chat${r.deleted === 1 ? '' : 's'}.`); setTimeout(() => { location.href = '/'; }, 700); }
    catch { setClearMsg(t('Could not delete chats.')); }
  }
  async function deleteAccount() {
    setDelErr('');
    try { await api.del('/api/me'); onDeleted?.(); }
    catch (e) { setDelErr(e?.message || t('Could not delete account.')); }
  }

  function setPref(k, v) { setPrefs(p => { const next = { ...p, [k]: v }; applyPrefs(next); scheduleSave(name, next); return next; }); }
  function resetPrefs() {
    const isOpenai = document.documentElement.getAttribute('data-preset') === 'openai';
    const applied = document.documentElement.getAttribute('data-theme');
    const fallbackTheme = (applied === 'anthropic' || applied === 'openai' || applied === 'oled') ? 'dark' : (applied || 'system');
    const next = presetDefaults(isOpenai, fallbackTheme);
    setPrefs(next);
    applyPrefs(next);
    scheduleSave(name, next);
    setConfirmReset(false);
  }
  const [memory, setMemory] = useState(user.memory || '');
  const [memBusy, setMemBusy] = useState(false);
  const memTimer = useRef(null);
  function changeMemory(v) {
    setMemory(v);
    clearTimeout(memTimer.current);
    memTimer.current = setTimeout(async () => {
      try { await api.put('/api/me/memory', { memory: v }); onUpdated?.({ ...user, memory: v }); } catch {}
    }, 700);
  }
  async function refreshMemory() {
    if (memBusy) return;
    setMemBusy(true);
    try {
      const modelId = user?.prefs?.lastModelId || '';
      const r = await api.post('/api/me/memory/refresh', { modelId });
      setMemory(r.memory || '');
      onUpdated?.({ ...user, memory: r.memory || '' });
    } catch (e) { alert(e.message || t('Could not update memory.')); }
    setMemBusy(false);
  }
  async function clearMemory() {
    try { await api.del('/api/me/memory'); setMemory(''); onUpdated?.({ ...user, memory: '' }); } catch {}
  }

  return (
    <div className="overlay" onMouseDown={(e) => e.target.classList.contains('overlay') && onClose()}>
      <div className="modal">
        <button className="modal-close" onClick={onClose} aria-label={t('Close')}>✕</button>
        <SettingsNav tab={tab} setTab={setTab} cfg={cfg} />
        <div className="modal-main">
          {tab === 'general' && (
            <>
              <h2>{t("General")}</h2>
              <div className="hint">{t("Your account basics.")}</div>
              <div className="me-section-h">{t("Profile")}</div>
              <div className="field">
                <label>{t("What should we call you?")}</label>
                <input value={name} onChange={(e) => changeName(e.target.value)} />
              </div>
              <div className="me-section-h">{t("Preferences")}</div>
              {/* This was the one native <select> left in Settings. The modal opens on a
                  transform animation, and browsers composite an OS-drawn select separately,
                  so it painted clipped until a click forced a repaint. SelectRow is what
                  every other dropdown here already uses. */}
              <SetRow label={t("Language")} desc={t("The interface language on this device. Chats and replies are not translated.")}>
                <SelectRow label={t("Language")} value={i18nLang}
                  options={langs.map(l => ({ v: l.code, label: l.name }))}
                  onPick={setAppLang} />
              </SetRow>
              <div className="field">
                <label>{t("Instructions for the Assistant")}</label>
                <div className="muted-note" style={{ marginBottom: 10 }}>{t("Added to the system prompt of every chat. Leave empty for none.")}</div>
                <textarea className="instr-area" value={instructions} maxLength={8000} rows={5}
                  placeholder={t("e.g. I'm a backend developer. Keep answers concise and skip the preamble.")}
                  onChange={(e) => changeInstructions(e.target.value)} />
                <div className="muted-note" style={{ textAlign: 'right' }}>{instructions.length}/8000</div>
              </div>
              <div className="me-section-h">{t("Your data")}</div>
              <SetRow label={t("Export everything")} desc={t("Download everything — chats, styles, personas, prompts, memory — as one JSON file.")}>
                <button className="btn ghost" onClick={onExportChats}><Download style={{ width: 14, verticalAlign: '-2px' }} /> {t("Export")}</button>
              </SetRow>
              <SetRow label={t("Import")} desc={t("Restore from an exported file. Chats are added and profile data is merged.")}>
                <button className="btn ghost" onClick={() => importRef.current?.click()}><Upload style={{ width: 14, verticalAlign: '-2px' }} /> {t("Import")}</button>
                <input ref={importRef} type="file" accept="application/json" hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportChats(f); e.target.value = ''; }} />
              </SetRow>
              <div className="danger-zone">
                  <div className="dz-title">{t("Danger zone")}</div>
                  {!confirmClear ? (
                    <div className="field row">
                      <div><label>{t("Delete all saved chats")}</label><div className="muted-note">{t("Removes every chat and its files. Your account stays.")}</div></div>
                      <button className="btn danger" onClick={() => { setConfirmClear(true); setClearMsg(''); }}>{t("Delete all chats")}</button>
                    </div>
                  ) : (
                    <div className="dz-confirm">
                      <div className="muted-note" style={{ marginBottom: 10 }}>{t("Delete every saved chat? This can't be undone.")}</div>
                      <div className="edit-actions">
                        <button className="btn ghost" onClick={() => setConfirmClear(false)}>{t("Cancel")}</button>
                        <button className="btn danger" onClick={clearChats}>{t("Yes, delete all chats")}</button>
                      </div>
                    </div>
                  )}
                  {clearMsg && <div className="muted-note" style={{ marginTop: 8 }}>{clearMsg}</div>}
                  {!confirmReset ? (
                    <div className="field row" style={{ marginTop: 14 }}>
                      <div><label>{t("Reset all settings")}</label><div className="muted-note">{t("Back to defaults for this theme. Chats and account are untouched.")}</div></div>
                      <button className="btn ghost" onClick={() => setConfirmReset(true)}>{t("Reset all settings")}</button>
                    </div>
                  ) : (
                    <div className="dz-confirm" style={{ marginTop: 14 }}>
                      <div className="muted-note" style={{ marginBottom: 10 }}>{t("Reset every setting to this theme's defaults?")}</div>
                      <div className="edit-actions">
                        <button className="btn ghost" onClick={() => setConfirmReset(false)}>{t("Cancel")}</button>
                        <button className="btn" onClick={resetPrefs}>{t("Yes, reset settings")}</button>
                      </div>
                    </div>
                  )}
                  {!user.isOwner && (!confirmDel ? (
                    <div className="field row" style={{ marginTop: 14 }}>
                      <div><label>{t("Delete account")}</label><div className="muted-note">{t("Permanently removes your account, all chats, and files. This cannot be undone.")}</div></div>
                      <button className="btn danger" onClick={() => setConfirmDel(true)}>{t("Delete account")}</button>
                    </div>
                  ) : (
                    <div className="dz-confirm" style={{ marginTop: 14 }}>
                      <div className="muted-note" style={{ marginBottom: 10 }}>{t("Are you absolutely sure? This permanently deletes your account and everything in it.")}</div>
                      {delErr && <div className="dz-err">{delErr}</div>}
                      <div className="edit-actions">
                        <button className="btn ghost" onClick={() => setConfirmDel(false)}>{t("Cancel")}</button>
                        <button className="btn danger" onClick={deleteAccount}>{t("Yes, delete my account")}</button>
                      </div>
                    </div>
                  ))}
                </div>
            </>
          )}
          {tab === 'memory' && (
            <>
              <h2>{t("Memory")}</h2>
              <div className="hint">{t("A short, editable memory built from your recent chats. Stored locally.")}</div>
              <SwitchRow label={t("Use memory in chats")} desc={t("Adds the memory below to every conversation, refreshed in the background.")}
                on={prefs.memoryEnabled !== false} onToggle={() => setPref('memoryEnabled', prefs.memoryEnabled === false)} />
              <div className="field">
                <label>{t("What the assistant remembers")}</label>
                <textarea className="instr-area" value={memory} maxLength={6000} rows={9}
                  placeholder={t("Nothing yet. Chat a bit, then press Update now, or write anything you want remembered.")}
                  onChange={(e) => changeMemory(e.target.value)} />
                <div className="muted-note" style={{ textAlign: 'right' }}>{memory.length}/6000</div>
              </div>
              <SetRow label={t("Update from recent chats")} desc={t("Asks the current model to refresh this memory from your latest conversations.")}>
                <button className="btn ghost" disabled={memBusy} onClick={refreshMemory}><Refresh style={{ width: 14, verticalAlign: '-2px' }} /> {memBusy ? t('Updating…') : t('Update now')}</button>
              </SetRow>
              <SetRow label={t("Forget everything")} desc={t("Clears the memory. It may be rebuilt from future chats while memory is on.")}>
                <button className="btn ghost danger" onClick={clearMemory}><Trash style={{ width: 14, verticalAlign: '-2px' }} /> {t("Clear")}</button>
              </SetRow>
            </>
          )}
          {tab === 'version' && (() => {
            const vp = parseVersion(release?.version || cfg?.version || '');
            const icon = release?.hasIcon ? '/api/release/icon' : (cfg?.appIcon || '');
            const notes = (release?.notes || '').trim();
            const channel = vp?.channel ? vp.channel[0].toUpperCase() + vp.channel.slice(1) : '';
            return (
              <div className="vh">
                <div className="vh-top">
                  <div className="vh-badge">
                    {icon ? <img src={icon} alt="" /> : <img className="vh-badge-fallback" src={BRAND_ICON} alt="" />}
                  </div>
                  <div className="vh-id">
                    <div className="vh-name">{cfg?.appName || 'open-quill'}</div>
                    <div className="vh-version">{t("Version")} {vp ? vp.full : ', '}</div>
                    {channel && <div className="vh-channel">{channel} channel</div>}
                  </div>
                </div>
                {vp && (
                  <div className="vh-list">
                    <div className="vh-li">
                      <span className="vh-li-k">{t("Release")}</span>
                      <span className="vh-li-v">{vp.base || ', '}</span>
                    </div>

                    {release?.codename && (
                      <div className="vh-li">
                        <span className="vh-li-k">{t("Codename")}</span>
                        <span className="vh-li-v">{release.codename}</span>
                      </div>
                    )}

                    <div className="vh-li">
                      <span className="vh-li-k">{t("Channel")}</span>
                      <span className="vh-li-v">{channel || 'Stable'}</span>
                    </div>

                    {vp.build && (
                      <div className="vh-li">
                        <span className="vh-li-k">{t("Build")}</span>
                        <span className="vh-li-v">{vp.build}</span>
                      </div>
                    )}

                    {release?.released && (
                      <div className="vh-li">
                        <span className="vh-li-k">{t("Released")}</span>
                        <span className="vh-li-v">{formatReleased(release.released)}</span>
                      </div>
                    )}

                    {notes && (
                      <div className="version-desc" style={{ marginTop: 14 }}>
                        <Markdown>{notes}</Markdown>
                      </div>
                    )}

                    {release && !notes && (
                      <div className="vh-empty">{t("No release notes for this build.")}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
          {tab === 'appearance' && (
            <>
              <h2>{t("Appearance")}</h2>
              <div className="hint">{t("Choose how open-quill looks.")}</div>
              <SetRow label={t("Theme")} desc={t("Follow your system, or pick a palette. Colours only — the layout never changes.")}>
                <SelectRow label={t("Theme")} value={themeValue(prefs.theme, activePreset)}
                  onPick={(v) => setPref('theme', v)}
                  options={[{ v: 'system', label: t('System') }].concat(palettesFor(activePreset).map(p => ({ v: p.id, label: p.label })))} />
              </SetRow>
              <SetRow label={t("Motion")} desc={t("Reduce animation in streaming responses and other interface elements.")}>
                <SegSlide label={t("Motion")} value={prefs.minimalAnims ? 'reduced' : 'system'}
                  onPick={(v) => setPref('minimalAnims', v === 'reduced')}
                  options={[{ v: 'system', label: t('System') }, { v: 'reduced', label: t('Reduced') }]} />
              </SetRow>
              <SetRow label={t("Chat font")} desc={t("Overrides the theme's default font, on this device only.")}>
                <SelectRow label={t("Chat font")} value={userFont}
                  onPick={(v) => { setUserFontState(v); setUserFont(v); }}
                  options={[
                    { v: 'default', label: t('Theme default') },
                    { v: 'serif', label: 'Source Serif', font: "'Source Serif 4 Variable', serif" },
                    { v: 'sans', label: 'Open Sans', font: "'Open Sans', sans-serif" }
                  ]} />
              </SetRow>
              <SetRow label={t("Message density")} desc={t("Vertical spacing between messages.")}>
                <SegSlide label={t("Message density")} value={prefs.density || 'comfortable'} onPick={(v) => setPref('density', v)}
                  options={[{ v: 'comfortable', label: t('Comfortable') }, { v: 'compact', label: t('Compact') }]} />
              </SetRow>
              <SetRow label={t("Accent colour")} desc={t("Tints buttons, links and highlights.")}>
                <AccentSelect value={prefs.accent || ''} onPick={(v) => setPref('accent', v)} />
              </SetRow>
              <div className="me-section-h">{t("Display")}</div>
              <SwitchRow label={t("OLED screen protection")} desc={t("Nudges the interface a few pixels and eases brightness to limit burn-in.")}
                on={prefs.oledShift} onToggle={() => setPref('oledShift', !prefs.oledShift)} />
              <Toggle prefs={prefs} setPref={setPref} k="chatStagger" label={t("Staggered open")}
                desc={t("When opening a chat, messages assemble into view one after another.")} />
            </>
          )}
          {tab === 'keybinds' && <KeybindsPanel prefs={prefs} setPref={setPref} />}
          {tab === 'chat' && (() => {
            const rv = revealSpeedMs(prefs.revealMs);
            const noReveal = cfg?.uiPreset === 'openai';
            const style = resolveReveal(prefs, 'anthropic');
            const styleOpt = REVEAL_STYLE_OPTS.find(o => o.v === style) || REVEAL_STYLE_OPTS[0];
            return (
              <>
                <h2>{t("Chat")}</h2>
                <div className="hint">{t("How responses look, move, and feel.")}</div>
                <div className="me-section-h">{t("Streaming")}</div>
                <>
                  {!noReveal && (
                    <SetRow label={t("Text reveal")} desc={t(styleOpt.note)}>
                      <SegSlide label={t("Text reveal")} value={style} onPick={(v) => setPref('revealStyle', v)}
                        options={REVEAL_STYLE_OPTS.map(o => ({ v: o.v, label: t(o.label) }))} />
                    </SetRow>
                  )}
                  {style === 'typewriter' && !noReveal && (
                    <SetRow label={t("Reveal speed")} desc={t("How quickly text appears once it has arrived, not how fast the model replies.")}>
                      <SegSlide label={t("Reveal speed")} value={REVEAL_STOPS.some(o => o.v === rv) ? rv : -1} onPick={(v) => setPref('revealMs', v)}
                        options={REVEAL_STOPS.map(o => ({ v: o.v, label: t(o.label) })).concat(REVEAL_STOPS.some(o => o.v === rv) ? [] : [{ v: -1, label: rv + ' ms' }])} />
                    </SetRow>
                  )}
                  <Toggle prefs={prefs} setPref={setPref} k="autoscroll" label={t("Auto-scroll")} desc={t("Keep the latest text in view unless you scroll up.")} />
                </>
                <div className="me-section-h">{t("Cursor")}</div>
                <>
                  <SwitchRow label={t("Streaming cursor")} desc={t("Show a soft cursor at the write position as text streams in.")}
                    on={prefs.streamCursor} onToggle={() => setPref('streamCursor', !prefs.streamCursor)} />
                  {!!prefs.streamCursor && (
                    <SetRow label={t("Cursor style")}>
                      <SegSlide label={t("Cursor style")} value={prefs.cursorStyle === 'circle' ? 'circle' : 'block'} onPick={(v) => setPref('cursorStyle', v)}
                        options={[{ v: 'block', label: t('Block') }, { v: 'circle', label: t('Circle') }]} />
                    </SetRow>
                  )}
                  {!!prefs.streamCursor && (prefs.cursorStyle || 'block') === 'block' && (() => {
                    const bv = Math.max(150, Math.min(2000, parseInt(prefs.cursorBlinkMs) || 500));
                    return (
                      <SetRow label={t("Blink speed")} desc={t("Idle blink rate. It stays solid while text streams, like a terminal.")}>
                        <div className="reveal-row">
                          <input type="range" min="150" max="2000" step="50" value={bv} onChange={(e) => setPref('cursorBlinkMs', parseInt(e.target.value))} />
                          <span className="reveal-val">{bv} ms</span>
                          {bv !== 500 && <button className="linklike" onClick={() => setPref('cursorBlinkMs', 500)}>{t("Reset")}</button>}
                        </div>
                      </SetRow>
                    );
                  })()}
                  {!!prefs.streamCursor && prefs.cursorStyle === 'circle' && (() => {
                    const pv = Math.max(300, Math.min(4000, parseInt(prefs.cursorPulseMs) || 1000));
                    return (
                      <SetRow label={t("Pulse speed")} desc={t("How quickly the circle grows and shrinks.")}>
                        <div className="reveal-row">
                          <input type="range" min="300" max="4000" step="100" value={pv} onChange={(e) => setPref('cursorPulseMs', parseInt(e.target.value))} />
                          <span className="reveal-val">{pv} ms</span>
                          {pv !== 1000 && <button className="linklike" onClick={() => setPref('cursorPulseMs', 1000)}>{t("Reset")}</button>}
                        </div>
                      </SetRow>
                    );
                  })()}
                </>
                <div className="me-section-h">{t("Navigation")}</div>
                <>
                  <div className="sec-note">{t("Tools for moving around a long conversation. Turn any off for a bare view.")}</div>
                  <SwitchRow label={t("Conversation map")} desc={t("A rail down the right edge with one mark per turn. Click a mark to jump.")}
                    on={prefs.threadRail !== false} onToggle={() => setPref('threadRail', prefs.threadRail === false)} />
                  <SwitchRow label={t("Find in conversation")} desc={t("Search the open chat from the header. Off gives Ctrl+F back to the browser.")}
                    on={prefs.threadFind !== false} onToggle={() => setPref('threadFind', prefs.threadFind === false)} />
                  <SwitchRow label={t("Branch map")} desc={t("A header button showing the whole conversation, every branch included.")}
                    on={prefs.branchMap !== false} onToggle={() => setPref('branchMap', prefs.branchMap === false)} />
                  <SwitchRow label={t("Message shortcuts")} desc={t("J and K move between messages; C copies, E edits, R retries, Y branches.")}
                    on={prefs.msgKeys !== false} onToggle={() => setPref('msgKeys', prefs.msgKeys === false)} />
                </>
                <div className="me-section-h">{t("Tools and context")}</div>
                <>
                  {cfg?.webSearchAvailable && (
                    <SwitchRow label={t("Web search on by default")} desc={t("Start every new chat with web search enabled, when the model allows it.")}
                    on={prefs.webSearchDefault} onToggle={() => setPref('webSearchDefault', !prefs.webSearchDefault)} />
                  )}
                  <SwitchRow label={t("Engine telemetry")} desc={t("Live speed and context fill above the message bar while a reply streams.")}
                    on={prefs.engineStrip !== false} onToggle={() => setPref('engineStrip', prefs.engineStrip === false)} />
                  <SwitchRow label={t("Context gauge")} desc={t("A how-full-is-the-window meter beside the model picker, updated every message.")}
                    on={prefs.ctxGauge} onToggle={() => setPref('ctxGauge', !prefs.ctxGauge)} />
                  <SwitchRow label={t("Speed on each reply")} desc={t("Keep the tokens per second beside each reply, so models stay comparable.")}
                    on={prefs.msgSpeed} onToggle={() => setPref('msgSpeed', !prefs.msgSpeed)} />
                  {(() => {
                    const sv = statusDelaySecs(prefs.statusDelay);
                    return (
                      <SetRow label={t("Progress line delay")} desc={t("How long a reply may take before the progress line fades in. Default 3s")}>
                        <div className="reveal-row">
                          <input type="range" min="0" max={STATUS_DELAY_MAX} step="1" value={sv} onChange={(e) => setPref('statusDelay', parseInt(e.target.value))} />
                          <span className="reveal-val">{sv === 0 ? t("Instant") : sv + 's'}</span>
                          {sv !== STATUS_DELAY_DEFAULT && <button className="linklike" onClick={() => setPref('statusDelay', STATUS_DELAY_DEFAULT)}>{t("Reset")}</button>}
                        </div>
                      </SetRow>
                    );
                  })()}
                  <SwitchRow label={t("Context ledger on open")} desc={t("Open chats with the per-message token ledger already showing.")}
                    on={prefs.ledgerDefault} onToggle={() => setPref('ledgerDefault', !prefs.ledgerDefault)} />
                  <SwitchRow label={t("Mid-stream steering")} desc={t("Correct a reply mid-stream. Restarts from the cut point and costs an extra request.")}
                    on={prefs.steering} onToggle={() => setPref('steering', !prefs.steering)} />
                </>
              </>
            );
          })()}
          {tab === 'usage' && (
            <>
              <h2>{t("Usage")}</h2>
              <div className="hint">{t("Tokens and estimated cost for your account, across every chat.")}</div>
              <div style={{ marginBottom: 16 }}>
                <SegSlide label={t("Usage window")} value={usageWindow} onPick={setUsageWindow}
                  options={[{ v: '7', label: t('7 days') }, { v: '30', label: t('30 days') }, { v: '90', label: t('90 days') }, { v: 'all', label: t('All time') }]} />
              </div>
              {usageErr && <div className="dz-err">{usageErr}</div>}
              {!usageData && !usageErr && <div className="muted-note">{t("Loading…")}</div>}
              {usageData && (
                <>
                  <div className="usage-tiles">
                    {[[t('Total tokens'), fmtN(usageData.totals.total)], [t('Input'), fmtN(usageData.totals.prompt)], [t('Output'), fmtN(usageData.totals.completion)], [t('Est. cost'), usageData.totals.cost ? fmtUsd(usageData.totals.cost) : (usageData.totals.costKnown ? '$0.00' : '—')]].map(([lbl, val]) => (
                      <div key={lbl} className="usage-tile">
                        <div className="ut-val">{val}</div>
                        <div className="ut-lbl">{lbl}</div>
                      </div>
                    ))}
                  </div>
                  <div className="usage-count">{usageData.totals.generations === 1 ? t('{n} generation in this window.', { n: fmtN(usageData.totals.generations) }) : t('{n} generations in this window.', { n: fmtN(usageData.totals.generations) })}</div>
                  {usageData.models.length === 0 ? (
                    <div className="muted-note">{t("No usage recorded yet. Token counts appear here after you chat with a model whose backend reports usage.")}</div>
                  ) : (<>
                    <div className="me-section-h">{t("By model")}</div>
                    <table className="usage-table">
                      <thead>
                        <tr>
                          <th>{t('Model')}</th>
                          <th className="num">{t('Input')}</th>
                          <th className="num">{t('Output')}</th>
                          <th className="num">{t('Cost')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageData.models.map((m, i) => (
                          <tr key={i}>
                            <td>{m.modelName}</td>
                            <td className="num">{fmtN(m.prompt)}</td>
                            <td className="num">{fmtN(m.completion)}</td>
                            <td className="num">{m.priced ? fmtUsd(m.cost) : <span className="muted-note">{t('no price')}</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>)}
                  <div className="muted-note usage-foot">{t('Cost is estimated from per-model prices set by your admin. Models marked no price are local or free, so no cost is counted. Token counts come from your model backend and may be unavailable for some providers.')}</div>
                </>
              )}
            </>
          )}
          {tab === 'security' && (
            <>
              <h2>{t("Security")}</h2>
              <div className="hint">{t("Change your password and manage two-factor authentication.")}</div>
              <div className="me-section-h">{t("Password")}</div>
              <div className="field stack">
                <input type="password" placeholder={t("Current password")} value={pw.current} onChange={(e) => setPw(p => ({ ...p, current: e.target.value }))} />
                <input type="password" placeholder={t("New password")} value={pw.next} onChange={(e) => setPw(p => ({ ...p, next: e.target.value }))} />
                <input type="password" placeholder={t("Confirm new password")} value={pw.confirm} onChange={(e) => setPw(p => ({ ...p, confirm: e.target.value }))} />
                {pwErr && <div className="dz-err">{pwErr}</div>}
                {pwMsg && <div className="muted-note" style={{ color: 'var(--accent)' }}>{pwMsg}</div>}
                <div><button className="btn" onClick={changePassword} disabled={!pw.current || !pw.next}>{t("Update password")}</button></div>
              </div>
              <div className="sec-block">
                <div className="me-section-h">{t("Two-factor authentication")} {twoFa === 'on' && <span className="you-tag">{t("enabled")}</span>}</div>
                {secErr && <div className="dz-err">{secErr}</div>}
                {recovery && (
                  <div className="recovery-box">
                    <div className="muted-note" style={{ marginBottom: 8 }}>{t("Save these recovery codes somewhere safe. Each works once if you lose your authenticator. They will not be shown again.")}</div>
                    <div className="recovery-grid">{recovery.map(c => <code key={c}>{c}</code>)}</div>
                  </div>
                )}
                {twoFa === 'off' && !setup && (
                  <>
                    <div className="muted-note" style={{ marginBottom: 8 }}>{t("Require a code from an authenticator app as a second step at login.")}</div>
                    <button className="btn" onClick={start2fa}>{t("Set up two-factor")}</button>
                  </>
                )}
                {twoFa === 'off' && setup && (
                  <>
                    <div className="muted-note" style={{ marginBottom: 8 }}>{t("In your authenticator app, add an account using this key, then enter the 6-digit code it shows.")}</div>
                    <div className="field"><label className="sub">{t("Secret key")}</label><code className="totp-secret">{setup.secret}</code></div>
                    <div className="field"><label className="sub">{t("Or paste this setup URL")}</label><code className="totp-uri">{setup.otpauth}</code></div>
                    <input placeholder="123456" inputMode="numeric" value={setupCode} onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, '').slice(0, 6))} style={{ marginBottom: 8, maxWidth: 160 }} />
                    <div className="edit-actions">
                      <button className="btn ghost" onClick={() => { setSetup(null); setSetupCode(''); }}>{t("Cancel")}</button>
                      <button className="btn primary" onClick={confirm2fa} disabled={setupCode.length !== 6}>{t("Verify & enable")}</button>
                    </div>
                  </>
                )}
                {twoFa === 'on' && (
                  <>
                    <div className="muted-note" style={{ marginBottom: 8 }}>{t("Enter your password to regenerate recovery codes or turn off two-factor.")}</div>
                    <input type="password" placeholder={t("Password")} value={disablePw} onChange={(e) => setDisablePw(e.target.value)} style={{ marginBottom: 8, maxWidth: 240 }} />
                    <div className="edit-actions">
                      <button className="btn ghost" onClick={regenRecovery} disabled={!disablePw}>{t("Regenerate recovery codes")}</button>
                      <button className="btn danger" onClick={disable2fa} disabled={!disablePw}>{t("Disable two-factor")}</button>
                    </div>
                  </>
                )}
              </div>
              <div className="sec-block">
                <div className="me-section-h">{t("Active sessions")}</div>
                <div className="sec-note">{t("Devices signed in to your account. Sessions expire after 30 days idle.")}</div>
                {sessionErr && <div className="dz-err">{sessionErr}</div>}
                {!sessions && !sessionErr && <div className="muted-note">{t("Loading…")}</div>}
                {sessions && (
                  <>
                    {sessions.map(s => (
                      <div className="field row" key={s.id}>
                        <div>
                          <label>{t("{device} on {os}", { device: deviceLabel(s.userAgent), os: osLabel(s.userAgent) })} {s.current && <span className="you-tag">{t("this device")}</span>}</label>
                          <div className="muted-note">{s.ip ? s.ip + ' • ' : ''}active {fmtWhen(s.lastSeen)} • signed in {fmtWhen(s.createdAt)}</div>
                        </div>
                        {!s.current && <button className="btn danger" onClick={() => revokeSession(s.id)}>{t("Revoke")}</button>}
                      </div>
                    ))}
                    {sessions.filter(s => !s.current).length > 0 && (
                      <div className="field row">
                        <div><label>{t("Revoke all other sessions")}</label><div className="muted-note">{t("Keeps this device signed in and ends every other session.")}</div></div>
                        <button className="btn danger" onClick={revokeOthers}>{t("Revoke others")}</button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
