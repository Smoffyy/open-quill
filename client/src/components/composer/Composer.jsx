import { useRef, useEffect, useState, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ModelDropdown from './ModelDropdown.jsx';
import ModelPickerSlot from './ModelPickerSlot.jsx';
import Tip from '../ui/Tip.jsx';
import { api } from '../../lib/api.js';
import { notify } from '../../lib/notify.js';
import { useAttachments, NO_VISION } from '../../lib/attachments.js';
import { useDictation } from '../../lib/dictation.js';
import { captureScreenshot, screenshotSupported, isCaptureCancel } from '../../lib/screenshot.js';
import { Plus, Mic, Wave, Up, Enter, Stop, FileText, Cube, Check, Globe, Box, X, Chevron, NewChatIcon, Sliders, Steer, Screenshot, Plug, SkillIcon, ImageIcon, Copy, Folder, ChevDown, Calendar, Ghost, Sparkles, Compact, Eye, Dots } from '../ui/icons.jsx';
import LiquidBuds, { BUD_SIZE } from '../liquid/LiquidBuds.jsx';
import { gridTargets, sourceOn, wrapLeft } from '../../lib/liquid.js';
import { edgeColor, surfaceOf } from '../../lib/liquiddraw.js';
import { useLiquidMenu } from '../../lib/liquidmenu.js';
import StyleSubmenu, { styleNameFor, STYLE_PRESETS } from './StyleMenu.jsx';
import { slashState, matchSlash } from '../../lib/slash.js';
import { extLabel } from '../../lib/files.js';
import { t, fmtDate } from '../../i18n.jsx';
import { useThemeText } from '../../lib/theme/store.jsx';
import { focusUnlessTouch } from '../../lib/touch.js';
import { SubItem } from '../ui/Submenu.jsx';
import { useSubmenus } from '../../lib/submenu.js';
import { useDismiss } from '../../lib/dismiss.js';
import { useLayout } from '../../lib/uselayout.js';

// The picker no longer advertises a list. The server decides what it can read by
// sniffing the bytes, so any format is accepted here and one that turns out to be
// unreadable is reported to the model as such rather than silently dropped.
const FILE_ACCEPT = '';

function DropOverlay() {
  return createPortal(
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-overlay-content">
        <div className="drop-overlay-icons">
          <ImageIcon />
          <Copy />
          <Folder />
        </div>
        <div className="drop-overlay-text">{t('Drop files here to add to chat')}</div>
      </div>
    </div>,
    document.body
  );
}

function ActiveChip({ icon, label, onRemove }) {
  return (
    <Tip label={label}>
      <button type="button" className="active-chip" onClick={onRemove} aria-label={label}>
        <span className="ac-icon">{icon}</span>
        <span className="ac-x"><X /></span>
      </button>
    </Tip>
  );
}

export default function Composer({
  value, onChange, onSend, onStop, streaming, stopping = false, models, modelsReady = true,
  currentId, onSelect, extended, onToggleExtended, autoFocus, placeholder, modelUp, focusKey, visionSupported, canUseUnavailable, budget, webSearch, webSearchAvailable, onToggleWebSearch, modelHasBg, bgInChat, onToggleBgInChat, project, onClearProject, onOpenProject, projects = [], onSetProject, onNewChat, onShortcuts,
  voiceMic = false, voiceCall = false, sttEngine = 'browser', onStartCall, callActive = false, quickTools = false,
  safetyFlagged = false, safetyChecking = false, safetyVerbose = false, safetyReason = '',
  styles = [], styleId = 'normal', onSelectStyle, onSaveStyles,
  conversationEnded = false, endedReason = '',
  removedModel = null, skills = [], onToggleSkill = null, onManageSkills = null,
  queueCount = 0, onQueue, onSteer, canSteer = false, onManageConnectors = null, attachCombo = '',
  compareIds = [], onSetCompare, reasoningEffort, onSetEffort, kwargValues, onSetKwarg,
  contextRing = null, thread = false, footer = null, draftId, panel = null, jump = null,
  incognito = false, onToggleIncognito = null, onShowSummary = null, onPromptLedger = null
}) {
  const composerPlaceholder = useThemeText('composer.placeholder', t('How can I help you today?'));
  const layout = useLayout();
  const chipsBelow = layout.toolChips === 'below';
  const enterSend = thread && layout.sendIcon === 'enter';
  const ta = useRef(null);
  const fileInput = useRef(null);
  const plusRef = useRef(null);
  const plusBtnRef = useRef(null);
  const plusMenuRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const valueRef = useRef(value);
  useEffect(() => { valueRef.current = value; }, [value]);

  const { dictating, transcribing, toggleDictation } = useDictation({ sttEngine, valueRef, onChange });
  const {
    files, dragActive, glow, upErr, setUpErr,
    addFiles, pickFiles, onPaste, removeFile, clearFiles
  } = useAttachments({ visionSupported, draftId });

  const [plusMenu, setPlusMenu] = useState(false);
  const [plusDown, setPlusDown] = useState(false);
  const sub = useSubmenus();
  const { closeAll: closeSubs } = sub;
  const [voiceMenu, setVoiceMenu] = useState(false);
  const voiceRef = useRef(null);
  useDismiss(voiceMenu, () => setVoiceMenu(false), voiceRef);
  const voiceBtnRef = useRef(null);
  const voiceMenuRef = useRef(null);
  useLiquidMenu(voiceMenu, voiceMenuRef, voiceBtnRef);
  const rootRef = useRef(null);
  const placeFooter = useCallback(() => {
    const root = rootRef.current;
    const foot = root && root.querySelector('.disclaimer');
    if (!foot) return;
    if (window.matchMedia('(max-width: 768px)').matches) {
      foot.style.maxWidth = '';
      root.style.setProperty('--foot-shift', '0px');
      return;
    }
    const rb = root.getBoundingClientRect();
    const rightOf = el => el.getBoundingClientRect().right - rb.left;
    const leftBound = Math.max(0, ...[...root.querySelectorAll('.plus-wrap, .mic, .voice-wrap')].map(rightOf)) + 8;
    const rightBound = Math.min(rb.width - 8, ...[...root.querySelectorAll('.model-select, .chat-ring')].map(el => el.getBoundingClientRect().left - rb.left)) - 8;
    const avail = Math.max(0, rightBound - leftBound);
    foot.style.maxWidth = avail + 'px';
    const w = Math.min(foot.scrollWidth, avail);
    const center = rb.width / 2;
    let c = center;
    if (c + w / 2 > rightBound) c = rightBound - w / 2;
    if (c - w / 2 < leftBound) c = leftBound + w / 2;
    root.style.setProperty('--foot-shift', (c - center) + 'px');
  }, []);
  useLayoutEffect(() => { placeFooter(); });
  useLayoutEffect(() => {
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(placeFooter) : null;
    if (ro) ro.observe(rootRef.current);
    window.addEventListener('resize', placeFooter);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', placeFooter); };
  }, [placeFooter]);
  useEffect(() => { if (!plusMenu) closeSubs(); }, [plusMenu, closeSubs]);
  // Picking something in a submenu is the end of that errand, so the whole menu goes away.
  const closePlusMenu = useCallback(() => { closeSubs(); setPlusMenu(false); }, [closeSubs]);
  const [capturing, setCapturing] = useState(false);
  const [captureAvailable] = useState(() => screenshotSupported());
  const canScreenshot = visionSupported && captureAvailable;
  const onScreenshot = useCallback(() => {
    closePlusMenu();
    const shot = captureScreenshot();
    setCapturing(true);
    shot
      .then(file => { addFiles([file]); focusUnlessTouch(ta.current); })
      .catch(err => { if (!isCaptureCancel(err)) notify(t('The upload failed.')); })
      .finally(() => setCapturing(false));
  }, [addFiles, closePlusMenu]);
  const [showReason, setShowReason] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashFor, setSlashFor] = useState(value);
  if (slashFor !== value) {
    setSlashFor(value);
    setSlashIdx(0);
  }

  useLayoutEffect(() => {
    if (!plusMenu) return;
    const btn = plusRef.current && plusRef.current.querySelector('.plus');
    if (btn) {
      const r = btn.getBoundingClientRect();
      setPlusDown(window.innerHeight - r.bottom > 320);
    }
  }, [plusMenu]);
  useDismiss(plusMenu, () => setPlusMenu(false), plusRef, { inside: '.pm-flyout' });
  useLiquidMenu(plusMenu, plusMenuRef, plusBtnRef);

  const grewOnce = useRef(false);
  const fitWidth = useRef(0);
  const shapeRef = useRef(false);
  const setShape = (on) => {
    if (shapeRef.current === on) return;
    shapeRef.current = on;
    setMultiline(on);
  };
  const fit = useCallback((animate) => {
    const el = ta.current; if (!el) return;
    const MAX = 280;
    const host = el.parentElement;
    if ((el.value ? el.value.length : 0) > 4000) {
      el.style.overflowY = 'auto';
      el.style.height = MAX + 'px';
      if (host) host.classList.add('ml');
      setShape(true);
      grewOnce.current = true;
      return;
    }
    const prev = el.offsetHeight;
    el.style.height = 'auto';
    const setMl = (on) => { if (host) host.classList.toggle('ml', on); };
    setMl(false);
    const ml = el.scrollHeight > 44;
    setMl(ml);
    const raw = el.scrollHeight;
    const measured = Math.min(raw, MAX);
    el.style.overflowY = raw > MAX ? 'auto' : 'hidden';
    setShape(ml);
    if (!animate || !grewOnce.current || Math.abs(prev - measured) < 1) {
      el.style.height = measured + 'px';
      grewOnce.current = true;
      return;
    }
    el.style.height = prev + 'px';
    void el.offsetHeight;
    el.style.height = measured + 'px';
  }, []);
  useEffect(() => { fit(true); }, [value, fit]);
  useEffect(() => {
    fit(false);
    const onResize = () => fit(false);
    window.addEventListener('resize', onResize);
    let ro;
    const host = ta.current ? (ta.current.parentElement || ta.current) : null;
    if (typeof ResizeObserver !== 'undefined' && host) {
      fitWidth.current = host.clientWidth;
      ro = new ResizeObserver(() => {
        const w = host.clientWidth;
        if (w !== fitWidth.current) { fitWidth.current = w; fit(false); }
      });
      ro.observe(host);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (ta.current) fit(false); });
    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
    };
  }, [fit]);
  useEffect(() => { if (autoFocus || focusKey !== undefined) focusUnlessTouch(ta.current); }, [autoFocus, focusKey]);
  useEffect(() => {
    const h = () => fileInput.current?.click();
    window.addEventListener('oq-attach-files', h);
    return () => window.removeEventListener('oq-attach-files', h);
  }, []);
  const dictateRef = useRef(toggleDictation);
  dictateRef.current = toggleDictation;
  useEffect(() => {
    if (!voiceMic) return undefined;
    const h = () => dictateRef.current();
    window.addEventListener('oq-dictate', h);
    return () => window.removeEventListener('oq-dictate', h);
  }, [voiceMic]);
  const [drops, setDrops] = useState(null);
  useEffect(() => { setDrops(d => (d && d.open ? { ...d, open: false } : d)); }, [value]);
  const openDrops = (viaKeyboard) => {
    if (drops && drops.open) { setDrops({ ...drops, open: false }); return; }
    const btn = plusRef.current && plusRef.current.querySelector('.plus');
    const root = rootRef.current;
    if (!btn || !root) { setPlusMenu(true); return; }
    const b = btn.getBoundingClientRect();
    const surface = surfaceOf(root);
    const box = surface.rect;
    const count = dropItems().length;
    const radius = parseFloat(surface.style.borderTopLeftRadius) || 0;
    const offset = BUD_SIZE / 2 + 8;
    if (box.left >= offset + BUD_SIZE / 2 + 8) {
      const y = Math.max(box.top + box.height / 2, box.bottom - radius - 20);
      const source = { ...sourceOn(box, radius, box.left, y), spread: 10, half: 30 };
      const targets = wrapLeft({
        left: box.left, top: box.top, bottom: box.bottom, radius, offset, gap: 52, count,
        minY: 8 + BUD_SIZE / 2, maxY: window.innerHeight - 8 - BUD_SIZE / 2
      });
      setDrops({ open: true, keyboard: viaKeyboard, source, targets });
      return;
    }
    const source = { ...sourceOn(box, radius, b.left + b.width / 2, box.top), spread: 18, half: 54 };
    const targets = gridTargets({
      count, cols: count, gap: 52, size: BUD_SIZE, x: source.x + 4, y: box.top - 34, rowStep: -52, width: window.innerWidth, align: 'start'
    });
    setDrops({ open: true, keyboard: viaKeyboard, source, targets });
  };
  const composerEdge = () => edgeColor(surfaceOf(rootRef.current).style) || 'var(--border)';
  const pendingSub = useRef(null);
  useEffect(() => {
    if (!plusMenu || !pendingSub.current) return;
    sub.show(pendingSub.current);
    pendingSub.current = null;
  }, [plusMenu]);
  const fullMenu = (subId) => {
    pendingSub.current = subId;
    setPlusMenu(true);
  };
  const dropItems = () => [
    { id: 'attach', icon: <FileText />, label: visionSupported ? t('Add files or photos') : t('Add files'), run: () => fileInput.current?.click() },
    webSearchAvailable && { id: 'web', icon: <Globe />, label: t('Web search'), active: !!webSearch, toggle: true, keep: true, run: () => onToggleWebSearch && onToggleWebSearch() },
    onSelectStyle && { id: 'style', icon: <Sliders />, label: t('Response style'), run: () => fullMenu('styles') },
    { id: 'skills', icon: <SkillIcon />, label: t('Skills'), run: () => fullMenu('skills') },
    voiceMic && { id: 'dictate', icon: <Mic />, label: dictating ? t('Stop dictation') : t('Dictate'), run: () => toggleDictation() },
    { id: 'more', icon: <Dots />, label: t('Everything else'), run: () => fullMenu(null) }
  ].filter(Boolean);

  const [steerMode, setSteerMode] = useState(true);
  const steering = canSteer && steerMode && !!onSteer;
  useEffect(() => { if (!canSteer) setSteerMode(true); }, [canSteer]);
  async function doSend() {
    if (uploading) return;
    if (blockSend || budgetBlock || safetyFlagged || safetyChecking || conversationEnded) return;
    if (steering) {
      const text = value.trim();
      if (!text) return;
      onSteer(text);
      onChange('');
      return;
    }
    if (streaming) {
      const text = value.trim();
      if (!text && files.length === 0) return;
      if (!onQueue) return;
      let attachments = [];
      if (files.length) {
        setUploading(true);
        try { const r = await api.uploadFiles(files.map(f => f.file)); attachments = r.files || []; }
        catch (e) { setUploading(false); setUpErr(e?.message || t('Upload failed, the file may be too large.')); return; }
        setUploading(false);
        clearFiles();
      }
      onQueue(text, attachments);
      onChange('');
      return;
    }
    if (!value.trim() && files.length === 0) return;
    let attachments = [];
    if (files.length) {
      setUploading(true);
      try { const r = await api.uploadFiles(files.map(f => f.file)); attachments = r.files || []; }
      catch (e) { setUploading(false); setUpErr(e?.message || t('Upload failed, the file may be too large.')); return; }
      setUploading(false);
    }
    clearFiles();
    onSend(attachments);
  }

  useEffect(() => { setShowReason(false); }, [currentId]);

  const slashCmds = [];
  if (slashState(value)) {
    const done = (fn) => () => { onChange(''); fn(); };
    if (onNewChat) slashCmds.push({ id: 'new', word: 'new', label: t('New chat'), icon: <NewChatIcon style={{ width: 16 }} />, run: done(onNewChat) });
    if (onToggleIncognito) slashCmds.push({ id: 'incognito', word: 'incognito', label: incognito ? t('Exit incognito') : t('Incognito chat'), icon: <Ghost style={{ width: 16 }} />, run: done(onToggleIncognito) });
    if (webSearchAvailable && onToggleWebSearch) slashCmds.push({ id: 'web', word: 'web', label: t('Web search'), sub: webSearch ? t('Disable') : t('Enable'), icon: <Globe style={{ width: 16 }} />, run: done(onToggleWebSearch) });
    const pickable = (models || []).filter(m => !m.unavailable || canUseUnavailable);
    if (onSelect && pickable.length > 1) slashCmds.push({
      id: 'model', word: 'model', label: t('Switch model'), icon: <Cube style={{ width: 16 }} />,
      items: pickable.map(m => ({ id: 'model:' + m.id, label: m.displayName, sub: m.id === currentId ? t('Current') : '', run: done(() => onSelect(m.id)) }))
    });
    if (onSelectStyle) slashCmds.push({
      id: 'style', word: 'style', label: t('Response style'), icon: <Sparkles style={{ width: 16 }} />,
      items: [...STYLE_PRESETS.map(p => ({ id: p.id, name: t(p.name) })), ...styles].map(s => ({ id: 'style:' + s.id, label: s.name, sub: s.id === styleId ? t('Current') : '', run: done(() => onSelectStyle(s.id)) }))
    });
    if (onToggleSkill && skills.length > 0) slashCmds.push({
      id: 'skill', word: 'skill', label: t('Skills'), icon: <SkillIcon style={{ width: 16 }} />,
      items: skills.map(sk => ({ id: 'skill:' + sk.id, label: sk.name, sub: sk.enabled ? t('On') : t('Off'), run: done(() => onToggleSkill(sk)) }))
    });
    if (onSetProject && projects.length > 0) slashCmds.push({
      id: 'project', word: 'project', label: t('Add to project'), icon: <Box style={{ width: 16 }} />,
      items: [
        ...(project && onClearProject ? [{ id: 'project:none', label: t('Remove from project'), run: done(onClearProject) }] : []),
        ...projects.map(p => ({ id: 'project:' + p.id, label: p.name, sub: project?.id === p.id ? t('Current') : '', run: done(() => onSetProject(p)) }))
      ]
    });
    if (onShowSummary) slashCmds.push({ id: 'summary', word: 'summary', label: t('Conversation memory'), icon: <Compact style={{ width: 16 }} />, run: done(onShowSummary) });
    if (onPromptLedger) slashCmds.push({ id: 'prompt', word: 'prompt', label: t('What gets sent'), icon: <Eye style={{ width: 16 }} />, run: done(onPromptLedger) });
    if (onShortcuts) slashCmds.push({ id: 'keys', word: 'keys', label: t('Keyboard shortcuts'), icon: <Sliders style={{ width: 16 }} />, run: done(onShortcuts) });
  }
  const { parent: slashParent, items: slashShown } = matchSlash(slashCmds, value);
  const slashOpen = slashShown.length > 0;
  const runSlash = (c) => (c.items ? onChange('/' + c.word + ' ') : c.run());
  const slashMenuRef = useRef(null);
  useLiquidMenu(slashOpen, slashMenuRef, rootRef);
  const slashListRef = useRef(null);
  useEffect(() => { slashListRef.current?.children[slashIdx]?.scrollIntoView({ block: 'nearest' }); }, [slashIdx]);

  function key(e) {
    if (slashOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx(i => Math.min(slashShown.length - 1, i + 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); if (slashShown[slashIdx]) runSlash(slashShown[slashIdx]); return; }
      if (e.key === 'Escape') { e.preventDefault(); onChange(''); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); }
  }
  const activeModel = models?.find(m => m.id === currentId) || null;
  const unavailable = !!activeModel?.unavailable;
  const blockSend = (unavailable && !canUseUnavailable) || !!removedModel;
  const sunsetInfo = (() => {
    const sAt = activeModel?.sunsetAt;
    if (!sAt || unavailable || removedModel) return null;
    const d = new Date(sAt + 'T00:00:00');
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((d.getTime() - today.getTime()) / 86400000);
    if (days < 0) return null;
    const t = Math.max(0, Math.min(1, 1 - days / 14));
    return {
      name: activeModel.displayName,
      date: fmtDate(d, { month: 'long', day: 'numeric', year: 'numeric' }),
      mix: Math.round(t * 62)
    };
  })();
  const [bannerMounted, setBannerMounted] = useState(unavailable);
  const [bannerOut, setBannerOut] = useState(false);
  const bannerInfo = useRef(null);
  if (unavailable && activeModel) bannerInfo.current = { name: activeModel.displayName, reason: (activeModel.unavailableReason || '').trim() };
  useEffect(() => {
    if (unavailable) { setBannerMounted(true); setBannerOut(false); return; }
    if (!bannerMounted) return;
    setBannerOut(true);
    const t = setTimeout(() => { setBannerMounted(false); setShowReason(false); }, 300);
    return () => clearTimeout(t);
  }, [unavailable]);
  const hasImage = files.some(f => f.preview);
  const budgetState = budget && budget.cap ? budget.state : 'none';
  const budgetBlock = budgetState === 'over' && budget?.enforce && !canUseUnavailable;
  const showBudgetBanner = budgetState === 'warn' || budgetState === 'over';
  const otherBanner = showBudgetBanner || safetyFlagged || conversationEnded || removedModel || panel;
  const anyBanner = bannerMounted || otherBanner || sunsetInfo;
  const onlyUnavailable = !otherBanner && !sunsetInfo;
  const sunsetOnly = !!sunsetInfo && !bannerMounted && !otherBanner;
  const activeTools = [];
  if (webSearchAvailable && webSearch) activeTools.push({ id: 'websearch', icon: <Globe />, label: t("Web search"), off: () => onToggleWebSearch && onToggleWebSearch() });
  for (const sk of skills) if (sk.enabled) activeTools.push({ id: 'skill:' + sk.id, icon: <SkillIcon />, label: sk.name, off: () => onToggleSkill && onToggleSkill(sk) });
  if (onSelectStyle && styleId && styleId !== 'normal') activeTools.push({ id: 'style', icon: <Sliders />, label: styleNameFor(styleId, styles), off: () => onSelectStyle('normal') });
  const chips = activeTools.map(a => <ActiveChip key={a.id} icon={a.icon} label={a.label} onRemove={a.off} />);
  const hasText = /\S/.test(value);
  const canSend = (hasText || files.length > 0) && !uploading && !blockSend && !budgetBlock && !safetyFlagged && !safetyChecking && !conversationEnded;
  const [multiline, setMultiline] = useState(false);
  const cls = 'composer' + (multiline ? ' ml' : '') + (chipsBelow && activeTools.length > 0 ? ' has-chips' : '') + (hasImage ? ' glowing' : '') + ((unavailable || removedModel) ? ' unavailable' : '') + ((blockSend || budgetBlock) ? ' blocked' : '');
  const fmtUsd = (n) => '$' + (Number(n || 0) > 0 && Number(n || 0) < 0.01 ? Number(n).toFixed(4) : Number(n || 0).toFixed(2));

  return (
    <div className={'composer-stack' + (anyBanner ? ' has-banner' : '')}>
    {dragActive && <DropOverlay />}
    {jump}
    {anyBanner && (
      <div className={'unavail-bg' + (bannerOut && onlyUnavailable ? ' out' : '')}
        style={sunsetOnly ? {
          background: `color-mix(in srgb, #e5484d ${sunsetInfo.mix}%, var(--bg))`,
          borderColor: `color-mix(in srgb, #e5484d ${Math.min(70, sunsetInfo.mix + 12)}%, var(--border-soft))`,
          transition: 'background .4s ease, border-color .4s ease'
        } : undefined} />
    )}
    {removedModel && (
      <div className="unavail-banner removed-banner">
        <div className="unavail-row">
          <span className="unavail-msg"><strong>{removedModel.name}</strong> {t('has been removed, try using a different model to continue this chat.')}</span>
        </div>
      </div>
    )}
    {sunsetInfo && (
      <div className={'unavail-banner sunset-banner' + (sunsetOnly ? '' : ' pill')} style={sunsetOnly ? undefined : { background: `color-mix(in srgb, #e5484d ${sunsetInfo.mix}%, transparent)` }}>
        <div className="unavail-row">
          <span className="unavail-msg sunset-msg">
            <Calendar />
            <span><strong>{sunsetInfo.name}</strong> {t('is going away {date}.', { date: sunsetInfo.date })}</span>
          </span>
        </div>
      </div>
    )}
    {conversationEnded && (
      <div className="unavail-banner ended-banner">
        <div className="unavail-row">
          <span className="unavail-msg"><strong>{t("The assistant ended this conversation.")}</strong> {endedReason ? endedReason : t('It can no longer be continued, edited, or branched.')}</span>
        </div>
      </div>
    )}
    {safetyFlagged && (
      <div className="unavail-banner safety-banner">
        <div className="unavail-row">
          <span className="unavail-msg"><strong>{t("Message flagged.")}</strong> {safetyReason && safetyReason.trim() ? safetyReason.trim() : t('This prompt was blocked by the safety check, please revise it and try again.')}</span>
        </div>
      </div>
    )}
    {showBudgetBanner && (
      <div className={'unavail-banner budget-banner ' + budgetState}>
        <div className="unavail-row">
          <span className="unavail-msg">
            {budgetState === 'over'
              ? <><strong>{t("Monthly budget reached.")}</strong> {t('{spent} of {cap} used.', { spent: fmtUsd(budget.spent), cap: fmtUsd(budget.cap) })}{budget.enforce && !canUseUnavailable ? ' ' + t('New messages are paused until next month.') : ''}</>
              : <><strong>{t("Approaching your monthly budget.")}</strong> {t('{spent} of {cap} used.', { spent: fmtUsd(budget.spent), cap: fmtUsd(budget.cap) })}</>}
          </span>
        </div>
      </div>
    )}
    {bannerMounted && bannerInfo.current && (
      <div className={'unavail-banner' + (bannerOut ? ' out' : '') + (showReason ? ' open' : '')}>
        <div className="unavail-row">
          <span className="unavail-msg">{t("{name} is currently unavailable.", { name: bannerInfo.current.name })}</span>
          {bannerInfo.current.reason && (
            <button className="unavail-learn" onClick={() => setShowReason(s => !s)}>{showReason ? t('Hide') : t('Learn more')}</button>
          )}
        </div>
        {showReason && bannerInfo.current.reason && (
          <div className="unavail-reason">{bannerInfo.current.reason}</div>
        )}
      </div>
    )}
    {panel}
    <div className={cls} style={{ '--glow': glow }} ref={rootRef} data-liquid-source>
      {files.length > 0 && (
        <div className="attach-row">
          {files.map(f => (
            <div key={f.id} className={'attach-chip' + (f.preview ? ' image' : '')}>
              {f.preview
                ? <img src={f.preview} alt={f.name} />
                : (
                  <div className="attach-file" data-tip={f.name}>
                    <div className="attach-name">{f.name}</div>
                    <div className="attach-foot">
                      <span className="attach-type">{extLabel(f.name)}</span>
                    </div>
                  </div>
                )}
              <button className="attach-x" onClick={() => removeFile(f.id)} data-tip={t("Remove")} aria-label={t("Remove")}><X /></button>
            </div>
          ))}
        </div>
      )}
      {upErr && <div className="attach-err">{upErr === NO_VISION ? t('This model cannot see images, so they were left out.') : upErr}</div>}
      {slashOpen && (
        <div ref={slashMenuRef} className="slash-menu" role="listbox" aria-label={slashParent ? slashParent.label : t('Commands')}>
          <div className="slash-head">{slashParent ? slashParent.label : t("Commands")}</div>
          <div className="slash-list" ref={slashListRef}>
            {slashShown.map((c, i) => (
              <button key={c.id} role="option" aria-selected={i === slashIdx} className={'slash-item' + (i === slashIdx ? ' active' : '')} onMouseEnter={() => setSlashIdx(i)} onMouseDown={(e) => { e.preventDefault(); runSlash(c); }}>
                <span className="slash-ico">{c.icon || slashParent?.icon}</span>
                <span className="slash-label">{c.label}</span>
                {!slashParent && <span className="slash-word">/{c.word}</span>}
                {c.sub && <span className="slash-sub">{c.sub}</span>}
                {c.items && <Chevron className="slash-more" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      )}
      {canSteer && (
        <div className="steer-row">
          <div className="steer-seg">
            <button className={steerMode ? 'on' : ''} onClick={() => setSteerMode(true)} data-tip={t('Correct the reply that is being written right now')}>
              <Steer style={{ width: 13 }} /> {t('Steer')}
            </button>
            <button className={!steerMode ? 'on' : ''} onClick={() => setSteerMode(false)} data-tip={t('Send after this reply finishes')}>
              {t('Queue')}{queueCount > 0 ? ` (${queueCount})` : ''}
            </button>
          </div>
          <span className="steer-note">{steerMode ? t('Applied to the reply in progress, without losing what is already written.') : t('Sent as a new message when this reply finishes.')}</span>
        </div>
      )}
      <textarea ref={ta} rows={1} value={value} placeholder={steering ? t('Steer this reply, e.g. "shorter" or "you misread the file"…') : streaming ? (queueCount > 0 ? t('Queue another message ({n} waiting)…', { n: queueCount }) : t('Type to queue a message…')) : (placeholder || composerPlaceholder)}
        id="oq-composer" aria-label={t('Message input')}
        onChange={(e) => onChange(e.target.value)} onKeyDown={key} onPaste={onPaste} />
      <input ref={fileInput} type="file" multiple hidden onChange={pickFiles}
        {...(FILE_ACCEPT ? { accept: (visionSupported ? 'image/*,' : '') + FILE_ACCEPT } : {})} />
      {safetyChecking && safetyVerbose && <div className="safety-checking shimmer">{t("Safety check…")}</div>}
      {compareIds.length > 0 && (
        <div className="queued-chip compare-chip">
          <span className="queued-label">{t("Compare:")}</span>
          <span className="queued-text">{[models?.find(m => m.id === currentId)?.displayName || t('Current'), ...compareIds.map(id => models?.find(m => m.id === id)?.displayName || id)].join(' · ')}</span>
          <button className="queued-x" data-tip={t("Cancel comparison")} aria-label={t("Cancel comparison")} onClick={() => onSetCompare?.([])}><X style={{ width: 12 }} /></button>
        </div>
      )}
      <div className="composer-bar">
        <div className="composer-left">
          <div className="plus-wrap" ref={plusRef}>
            <Tip label={t('More')} keys="/">
              <button ref={plusBtnRef} className={'plus' + (plusMenu || (drops && drops.open) ? ' on' : '')} onClick={(e) => {
                if (plusMenu) setPlusMenu(false);
                else if (quickTools) openDrops(e.detail === 0);
                else setPlusMenu(true);
              }} aria-label={t("More")}
                aria-haspopup="true" aria-expanded={plusMenu || !!(drops && drops.open)}>
                <Plus style={{ width: 20, height: 20 }} />
              </button>
            </Tip>
            {drops && (
              <LiquidBuds open={drops.open} source={drops.source} targets={drops.targets} items={dropItems()}
                color="var(--composer-bg, var(--input-bg))" rim={composerEdge} label={t('Composer tools')} trigger={plusRef} focusFirst={drops.keyboard}
                onClose={() => setDrops(d => (d ? { ...d, open: false } : d))} />
            )}
            {plusMenu && (
              <div ref={plusMenuRef} className={'plus-menu' + (plusDown ? ' down' : '')}>
                <button className="pm-item" onClick={() => { setPlusMenu(false); fileInput.current?.click(); }}>
                  <FileText />
                  <span className="pm-label">{visionSupported ? t('Add files or photos') : t('Add files')}</span>
                  {attachCombo && <span className="pm-shortcut">{attachCombo}</span>}
                </button>
                {captureAvailable && (
                  <button className="pm-item" onClick={onScreenshot} disabled={!canScreenshot || capturing}
                    data-tip={canScreenshot ? undefined : t("This model can't read images.")}>
                    <Screenshot />
                    <span className="pm-label">{t('Take a screenshot')}</span>
                  </button>
                )}
                {onSetProject && (
                  <SubItem id="project" sub={sub} wrapClass="pm-subwrap" flyoutClass="plus-menu pm-flyout"
                    trigger={({ open, onClick }) => (
                      <button className={'pm-item' + (open ? ' active' : '')} onClick={onClick}>
                        <Box />
                        <span className="pm-label">{t('Add to project')}</span>
                        <Chevron className="pm-chev" />
                      </button>
                    )}>
                    <div className="pm-head">{t('Add to project')}</div>
                    {projects.length === 0 && <div className="pm-empty">{t('No projects yet')}</div>}
                    {projects.map(p => (
                      <button key={p.id} className="pm-item pm-opt" onClick={() => onSetProject(p)}>
                        <Box />
                        <span className="pm-label">{p.name}</span>
                        {project && p.id === project.id && <Check className="pm-check" />}
                      </button>
                    ))}
                    {project && onClearProject && (
                      <button className="pm-item pm-opt" onClick={() => onClearProject()}>
                        <span className="pm-label">{t('Remove from project')}</span>
                      </button>
                    )}
                  </SubItem>
                )}
                <div className="pm-divider" />
                {onSelectStyle && (
                  <SubItem id="styles" sub={sub} wrapClass="pm-subwrap" flyoutClass="plus-menu pm-flyout"
                    trigger={({ open, onClick }) => (
                      <button className={'pm-item' + (open ? ' active' : '')} onClick={onClick}>
                        <Sliders />
                        <span className="pm-label">{t("Response style")}</span>
                        <span className="pm-note">{styleNameFor(styleId, styles)}</span>
                        <Chevron className="pm-chev" />
                      </button>
                    )}>
                    <StyleSubmenu styles={styles} stylesReady={modelsReady} styleId={styleId} currentId={currentId} onSaveStyles={onSaveStyles}
                      onSelect={(id) => onSelectStyle(id)} />
                  </SubItem>
                )}
                {onSetCompare && models && models.length > 1 && (
                  <SubItem id="compare" sub={sub} wrapClass="pm-subwrap" flyoutClass="plus-menu pm-flyout"
                    trigger={({ open, onClick }) => (
                      <button className={'pm-item' + (open ? ' active' : '')} onClick={onClick}>
                        <Cube />
                        <span className="pm-label">{t("Compare models")}</span>
                        {compareIds.length > 0 && <span className="pm-note">+{compareIds.length}</span>}
                        <Chevron className="pm-chev" />
                      </button>
                    )}>
                    <div className="pm-head">{t("Also answer with")}</div>
                    {models.filter(m => m.id !== currentId).map(m => {
                      const on = compareIds.includes(m.id);
                      return (
                        <button key={m.id} className="pm-item pm-opt"
                          onClick={() => onSetCompare(on ? compareIds.filter(x => x !== m.id) : (compareIds.length < 2 ? [...compareIds, m.id] : compareIds))}>
                          <span className="pm-label">{m.displayName || m.id}</span>
                          {on && <Check className="pm-check" />}
                        </button>
                      );
                    })}
                    <div className="pm-foot">{t("Pick up to 2 extra models. Your next message will be answered by each as versions of one response.")}</div>
                  </SubItem>
                )}
                <div className="pm-divider" />
                <SubItem id="skills" sub={sub} wrapClass="pm-subwrap" flyoutClass="plus-menu pm-flyout"
                  trigger={({ open, onClick }) => (
                    <button className={'pm-item' + (open ? ' active' : '')} onClick={onClick}>
                      <SkillIcon />
                      <span className="pm-label">{t('Skills')}</span>
                      <Chevron className="pm-chev" />
                    </button>
                  )}>
                  <div className="pm-head">{t('Skills')}</div>
                  {skills.length === 0 && <div className="pm-empty">{t('No skills yet')}</div>}
                  {skills.map(sk => (
                    <button key={sk.id} className="pm-item pm-opt" data-tip={sk.description || sk.name}
                      onClick={() => onToggleSkill && onToggleSkill(sk)}>
                      <SkillIcon />
                      <span className="pm-label">{sk.name}</span>
                      {sk.enabled && <Check className="pm-check" />}
                    </button>
                  ))}
                  <div className="pm-divider" />
                  <button className="pm-item pm-opt" onClick={() => { closePlusMenu(); onManageSkills && onManageSkills(); }}>
                    <Sliders />
                    <span className="pm-label">{t('Manage skills')}</span>
                  </button>
                  <button className="pm-item pm-opt" onClick={() => { closePlusMenu(); onManageSkills && onManageSkills('browse'); }}>
                    <Plus />
                    <span className="pm-label">{t('Browse skills')}</span>
                  </button>
                </SubItem>
                {onManageConnectors && (
                  <button className="pm-item" onClick={() => { closePlusMenu(); onManageConnectors(); }}>
                    <Plug />
                    <span className="pm-label">{t('MCP')}</span>
                  </button>
                )}
                {webSearchAvailable && <div className="pm-divider" />}
                {webSearchAvailable && (
                  <button className="pm-item" onClick={() => { onToggleWebSearch && onToggleWebSearch(); closePlusMenu(); }}>
                    <Globe />
                    <span className="pm-label">{t("Web search")}</span>
                    {webSearch && <Check className="pm-check" />}
                  </button>
                )}
              </div>
            )}
          </div>
          {!chipsBelow && activeTools.length > 0 && <div className="composer-chips">{chips}</div>}
          {project && (
            <div className="composer-project">
              {onOpenProject ? (
                <button type="button" className="cp-open" onClick={() => onOpenProject(project.id)} data-tip={t('Open project {name}', { name: project.name })}>
                  <Box style={{ width: 14 }} />
                  <span className="cp-name">{project.name}</span>
                </button>
              ) : (
                <span className="cp-open" data-tip={t('In project: {name}', { name: project.name })}>
                  <Box style={{ width: 14 }} />
                  <span className="cp-name">{project.name}</span>
                </span>
              )}
              {onClearProject && <button className="cp-x" onClick={onClearProject} data-tip={t("Remove from project")} aria-label={t("Remove from project")}><X style={{ width: 12 }} /></button>}
            </div>
          )}
        </div>
        <div className="composer-right">
          <ModelPickerSlot at="composer">
            <div className="model-slot">
              <ModelDropdown models={models} modelsReady={modelsReady} currentId={currentId} onSelect={onSelect}
                extended={extended} onToggleExtended={onToggleExtended} up={modelUp} isAdmin={canUseUnavailable}
                reasoningEffort={reasoningEffort} onSetEffort={onSetEffort}
                kwargValues={kwargValues} onSetKwarg={onSetKwarg}
                modelHasBg={modelHasBg} bgInChat={bgInChat} onToggleBgInChat={onToggleBgInChat} />
              {contextRing}
            </div>
          </ModelPickerSlot>
          {voiceMic && (
            <Tip label={dictating ? t('Stop dictation') : transcribing ? t('Transcribing…') : t('Dictate')}>
              <button className={'mic' + (dictating ? ' rec' : '') + (transcribing ? ' busy' : '')} onClick={toggleDictation}
                aria-label={dictating ? t('Stop dictation') : transcribing ? t('Transcribing…') : t('Dictate')} disabled={transcribing}>
                <Mic style={{ width: 20, height: 20 }} />
              </button>
            </Tip>
          )}
          {thread && layout.id === 'card' && (voiceMic || voiceCall) && (
            <div className="voice-wrap" ref={voiceRef}>
              <button ref={voiceBtnRef} type="button" className={'voice-trigger' + (voiceMenu ? ' on' : '')} onClick={() => setVoiceMenu(m => !m)}
                aria-label={t('Voice options')} data-tip={t('Voice options')} aria-haspopup="menu" aria-expanded={voiceMenu}>
                <ChevDown style={{ width: 14, height: 14 }} />
              </button>
              {voiceMenu && (
                <div ref={voiceMenuRef} className="plus-menu voice-menu" role="menu">
                  {voiceMic && (
                    <button type="button" role="menuitemradio" aria-checked="true" className="pm-item" onClick={() => { setVoiceMenu(false); toggleDictation(); }}>
                      <Mic /><span className="pm-label">{t('Dictate')}</span><Check className="pm-check" />
                    </button>
                  )}
                  {voiceCall && (
                    <button type="button" role="menuitem" className="pm-item" onClick={() => { setVoiceMenu(false); onStartCall && onStartCall(); }}>
                      <Wave /><span className="pm-label">{callActive ? t('End call') : t('Voice mode')}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {steering && hasText && (
            <button key="steer" className="send steer" onClick={doSend} data-tip={t('Steer this reply')} aria-label={t('Steer this reply')}><Steer style={{ width: 20, height: 20 }} /></button>
          )}
          {streaming ? (
            <button key="stop" className={'send stop' + (stopping ? ' stopping' : '')} onClick={onStop} disabled={stopping}
              data-tip={stopping ? t('Stopping, finishing the step in progress') : t('Stop generating')} aria-label={t('Stop generating')}><Stop style={{ width: 20, height: 20 }} /></button>
          ) : safetyChecking ? (
            <button key="send" className={'send' + (safetyVerbose ? ' checking' : ' quiet')} disabled aria-label={t('Send message')} data-tip={safetyVerbose ? t('Safety check…') : undefined}><Up style={{ width: 20, height: 20 }} /></button>
          ) : canSend ? (
            <button key="send" className={'send' + (enterSend ? ' enter' : '')} onClick={doSend} disabled={uploading} aria-label={t('Send message')}>
              {enterSend ? <Enter style={{ width: 20, height: 20 }} /> : <Up style={{ width: 20, height: 20 }} />}
            </button>
          ) : voiceCall && (!thread || layout.id !== 'card') ? (
            <Tip label={callActive ? t("End call") : t("Start a voice call")}><button key="call" className={'mic call' + (callActive ? ' on' : '')} onClick={onStartCall} aria-label={callActive ? t("End call") : t("Start a voice call")} aria-pressed={callActive}>{callActive ? <X style={{ width: 18, height: 18 }} /> : <Wave style={{ width: 20, height: 20 }} />}</button></Tip>
          ) : (
            <button key="send" className={enterSend ? 'send enter' : 'send ghost'} disabled aria-label={t('Send message')}>{enterSend ? <Enter style={{ width: 20, height: 20 }} /> : <Up style={{ width: 20, height: 20 }} />}</button>
          )}
        </div>
      </div>
      {footer}
      {chipsBelow && activeTools.length > 0 && <div className="composer-chips">{chips}</div>}
    </div>
    </div>
  );
}