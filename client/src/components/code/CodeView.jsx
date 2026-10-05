import { useEffect, useRef, useState } from 'react';
import CodeTranscript, { CodeMark } from './CodeTranscript.jsx';
import CodeComposer from './CodeComposer.jsx';
import CodeFiles from './CodeFiles.jsx';
import CodeMenu, { MenuItem, MenuSep } from './CodeMenu.jsx';
import ChatError from '../chat/ChatError.jsx';
import ThreadSkeleton from '../chat/ThreadSkeleton.jsx';
import Tip from '../ui/Tip.jsx';
import { Laptop, ChevDown, PanelRight, Download, DotsV, Down, Menu, Pencil, Copy, Star, Trash } from '../ui/icons.jsx';
import { copyText } from '../../lib/clipboard.js';
import { toast } from '../../lib/toast.js';
import { pathForCode } from '../../lib/route.js';
import { t, tk } from '../../i18n.jsx';

const PANEL_KEY = 'oq-code-panel-w';
const PANEL_MIN = 320;
const MAIN_MIN = 360;

function readPanelW() {
  try { const n = parseInt(localStorage.getItem(PANEL_KEY), 10); return Number.isFinite(n) && n >= PANEL_MIN ? n : null; } catch { return null; }
}

function SessionMenu({ open, setOpen, anchorRef, align, chat, onRename, onCopyLink, onToggleStar, onDelete, zipHref }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const run = k === 'r' ? onRename : k === 'c' ? onCopyLink : k === 'd' ? onDelete : null;
      if (!run) return;
      e.preventDefault();
      setOpen(false);
      run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onRename, onCopyLink, onDelete, setOpen]);
  return (
    <CodeMenu open={open} setOpen={setOpen} anchorRef={anchorRef} align={align} label={t('Session options')}>
      <MenuItem icon={<Pencil />} kbd="R" onClick={() => { setOpen(false); onRename(); }}>{t('Rename')}</MenuItem>
      <MenuItem icon={<Copy />} kbd="C" onClick={() => { setOpen(false); onCopyLink(); }}>{t('Copy link')}</MenuItem>
      <MenuItem icon={<Star />} onClick={() => { setOpen(false); onToggleStar(); }}>{chat?.starred ? t('Unstar') : t('Star')}</MenuItem>
      <MenuItem icon={<Download />} onClick={() => { setOpen(false); window.location.href = zipHref; }}>{t('Download all files')}</MenuItem>
      <MenuSep />
      <MenuItem icon={<Trash />} danger kbd="D" onClick={() => { setOpen(false); onDelete(); }}>{t('Delete')}</MenuItem>
    </CodeMenu>
  );
}

function SessionHeader({ chat, chatId, files, panelOpen, onTogglePanel, onRename, onToggleStar, onDelete, onOpenMenu }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState(null);
  const chevRef = useRef(null);
  const moreRef = useRef(null);
  const title = chat && chat.title && chat.title !== 'New chat' ? chat.title : t('Untitled session');
  const zipHref = '/api/chats/' + chatId + '/zip';
  const startRename = () => { setDraft(chat?.title && chat.title !== 'New chat' ? chat.title : ''); setEditing(true); };
  const commit = () => { setEditing(false); const v = draft.trim(); if (v && v !== chat?.title) onRename(v); };
  const copyLink = async () => { if (await copyText(location.origin + pathForCode(chatId))) toast(t('Link copied'), { icon: 'copy' }); };
  const menuProps = { chat, onRename: startRename, onCopyLink: copyLink, onToggleStar, onDelete, zipHref };
  return (
    <div className="cx-head">
      <div className="cx-head-left">
        <button type="button" className="cx-hbtn cx-menu-btn" onClick={onOpenMenu} aria-label={t('Menu')}><Menu /></button>
        <Tip label={t('Runs on this server, in a private folder for each session')}>
          <span className="cx-head-ic" aria-hidden="true"><Laptop /></span>
        </Tip>
        {editing ? (
          <input className="cx-title-input" autoFocus value={draft} placeholder={t('Session name')} aria-label={t('Session name')}
            onChange={(e) => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { e.preventDefault(); setEditing(false); } }} />
        ) : (
          <button type="button" className="cx-title" onClick={startRename} aria-label={t('{title}, rename session', { title })}>{title}</button>
        )}
        <button type="button" ref={chevRef} className={'cx-hbtn' + (menu === 'title' ? ' on' : '')} aria-label={t('More options for {title}', { title })}
          aria-haspopup="menu" aria-expanded={menu === 'title'} onClick={() => setMenu(m => (m === 'title' ? null : 'title'))}><ChevDown /></button>
        <SessionMenu open={menu === 'title'} setOpen={(v) => setMenu(v ? 'title' : null)} anchorRef={chevRef} align="left" {...menuProps} />
        <button type="button" className="cx-tag" onClick={onTogglePanel}>
          {files.length === 1 ? t('1 file') : t('{n} files', { n: files.length })}
        </button>
      </div>
      <div className="cx-head-right">
        <Tip label={panelOpen ? t('Hide files') : t('Show files')} keys="Alt+A">
          <button type="button" className={'cx-hbtn lg' + (panelOpen ? ' on' : '')} onClick={onTogglePanel}
            aria-label={panelOpen ? t('Hide files') : t('Show files')} aria-pressed={panelOpen}><PanelRight /></button>
        </Tip>
        <Tip label={t('Download all files')}>
          <a className={'cx-hbtn lg' + (files.length ? '' : ' off')} href={files.length ? zipHref : undefined} aria-label={t('Download all files')}><Download /></a>
        </Tip>
        <button type="button" ref={moreRef} className={'cx-hbtn lg' + (menu === 'more' ? ' on' : '')} aria-label={t('More options')}
          aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu(m => (m === 'more' ? null : 'more'))}><DotsV /></button>
        <SessionMenu open={menu === 'more'} setOpen={(v) => setMenu(v ? 'more' : null)} anchorRef={moreRef} align="right" {...menuProps} />
      </div>
    </div>
  );
}

const HELLO = [
  [tk('What’s up next, {name}?'), tk('What’s up next?')],
  [tk('What are we building, {name}?'), tk('What are we building?')],
  [tk('Ready when you are, {name}.'), tk('Ready when you are.')],
  [tk('What should we make today, {name}?'), tk('What should we make today?')],
  [tk('Got something to fix, {name}?'), tk('Got something to fix?')]
];

function CodeHero({ icon, userName }) {
  const [line] = useState(() => HELLO[Math.floor(Math.random() * HELLO.length)]);
  const first = (userName || '').split(' ')[0];
  return (
    <header className="cx-hero">
      <span className="cx-hero-mark"><CodeMark icon={icon} className="cx-hero-weave" state="idle" /></span>
      <h1>{first ? t(line[0], { name: first }) : t(line[1])}</h1>
    </header>
  );
}

function PlanPrompt({ onBuild, onKeep }) {
  useEffect(() => {
    const onKey = (e) => {
      const el = document.activeElement;
      if (e.ctrlKey || e.metaKey || e.altKey || (el && /^(INPUT|TEXTAREA)$/.test(el.tagName) && el.value)) return;
      if (e.key === '1') { e.preventDefault(); onBuild(); }
      else if (e.key === '2') { e.preventDefault(); onKeep(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBuild, onKeep]);
  return (
    <div className="cx-plan" role="group" aria-label={t('Plan ready')}>
      <div className="cx-plan-title">{t('Would you like to proceed with this plan?')}</div>
      <button type="button" className="cx-plan-opt primary" onClick={onBuild}>
        <span className="cx-plan-num">1</span>
        <span>{t('Yes, switch to Auto and build it')}</span>
      </button>
      <button type="button" className="cx-plan-opt" onClick={onKeep}>
        <span className="cx-plan-num">2</span>
        <span>{t('No, keep planning')}</span>
      </button>
    </div>
  );
}

export default function CodeView({
  userName, modelIcon, chat, chatId, booting, loading, messages, live, liveCalls, phase, status, statusDelay, streaming,
  files, liveFile, pendingFiles, fileFocus, onFilesChanged, composer, scroll, error, onDismissError,
  onRename, onToggleStar, onDelete, onRetry, onContinue, onOpenFile, panelOpen, onTogglePanel, onOpenMenu, onBuildPlan, preset
}) {
  const [panelW, setPanelW] = useState(readPanelW);
  const [wide, setWide] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [keptPlan, setKeptPlan] = useState(null);
  const rootRef = useRef(null);
  const fresh = !chatId && !booting;
  const showPanel = !!chatId && panelOpen;
  const last = messages[messages.length - 1];
  const planReady = !streaming && !live && !!last && last.role === 'assistant' && !!last.plan && keptPlan !== last.id;
  const planPanel = planReady
    ? <PlanPrompt onBuild={() => { setKeptPlan(last.id); onBuildPlan(); }} onKeep={() => { setKeptPlan(last.id); document.getElementById('oq-composer')?.focus(); }} />
    : null;

  useEffect(() => { setWide(false); }, [chatId]);

  function startResize(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return;
    setResizing(true);
    let last = panelW;
    const move = (ev) => {
      last = Math.round(Math.max(PANEL_MIN, Math.min(box.right - ev.clientX - 8, box.width - MAIN_MIN)));
      setPanelW(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setResizing(false);
      try { if (last) localStorage.setItem(PANEL_KEY, String(last)); } catch {}
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function nudge(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const box = rootRef.current?.getBoundingClientRect();
    if (!box) return;
    const cur = panelW || Math.round(box.width / 2);
    const next = Math.max(PANEL_MIN, Math.min(cur + (e.key === 'ArrowLeft' ? 32 : -32), box.width - MAIN_MIN));
    setPanelW(next);
    try { localStorage.setItem(PANEL_KEY, String(next)); } catch {}
  }

  return (
    <div ref={rootRef} className={'code-view' + (fresh ? ' fresh' : '') + (showPanel ? ' with-panel' : '') + (wide && showPanel ? ' panel-wide' : '') + (resizing ? ' resizing' : '')}>
      <div className="cx-main">
        {chatId ? (
          <SessionHeader chat={chat} chatId={chatId} files={files} panelOpen={showPanel} onTogglePanel={onTogglePanel}
            onRename={onRename} onToggleStar={onToggleStar} onDelete={onDelete} onOpenMenu={onOpenMenu} />
        ) : (
          <div className="cx-head blank">
            <button type="button" className="cx-hbtn cx-menu-btn" onClick={onOpenMenu} aria-label={t('Menu')}><Menu /></button>
          </div>
        )}
        <div className="cx-scroll" id="oq-thread" ref={scroll.scrollRef} onScroll={scroll.onScroll} onWheel={scroll.onWheel} onTouchMove={scroll.onTouchMove}>
          <div className={'thread cx-thread' + (fresh ? ' fresh' : '')} role="log" aria-label={t('Conversation')} aria-live="polite" aria-busy={streaming ? 'true' : 'false'}>
            {fresh && <CodeHero icon={modelIcon} userName={userName} />}
            {loading && messages.length === 0 && <ThreadSkeleton />}
            <CodeTranscript messages={messages} live={live} liveCalls={liveCalls} phase={phase} status={status} statusDelay={statusDelay} modelIcon={modelIcon} chatId={chatId}
              onOpenFile={onOpenFile} onRetry={onRetry} onContinue={onContinue} preset={preset} />
            {error && <ChatError message={error} onDismiss={onDismissError} />}
            <div className="thread-pad" />
          </div>
        </div>
        <div className="cx-dock-wrap">
          {scroll.showJump && (
            <button type="button" className="cx-jump" onClick={scroll.jumpDown} aria-label={t('Jump to latest')}><Down /></button>
          )}
          <CodeComposer empty={fresh} chatId={chatId} {...composer} panel={composer.panel || planPanel} />
        </div>
      </div>
      {showPanel && (
        <>
          <div className="cx-resize" role="separator" aria-orientation="vertical" aria-label={t('Resize files panel')} tabIndex={0}
            onPointerDown={startResize} onKeyDown={nudge} onDoubleClick={() => { setPanelW(null); try { localStorage.removeItem(PANEL_KEY); } catch {} }} />
          <div className="cx-panel-slot" style={panelW && !wide ? { width: panelW } : undefined}>
            <CodeFiles chatId={chatId} files={files} live={liveFile} pending={pendingFiles} busy={streaming} focus={fileFocus}
              onFilesChanged={onFilesChanged} onClose={onTogglePanel} wide={wide} onToggleWide={() => setWide(w => !w)} />
          </div>
        </>
      )}
    </div>
  );
}