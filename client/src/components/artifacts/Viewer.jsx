import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { ensureLanguage, hljsVersion, knowsLanguage, rawHighlight, subscribeHljs } from '../../lib/hljs.js';
import { api } from '../../api.js';
import { copyText } from '../../clipboard.js';
import Markdown from '../Markdown.jsx';
import FileChip from './FileChip.jsx';
import { Download, Check, ChevDown, Chevron, Search, X, Down } from '../icons.jsx';
import { t } from '../../i18n.jsx';
import { buildPreviewDoc } from '../../lib/preview.js';
import {
  PREVIEW_HTML, PREVIEW_MD, IMAGE_EXT, EXT_LANG, baseName, extOf, escHtml,
  diffLines, stableLineDiff, collapseRuns, splitHighlightedLines, markLine, findMatches
} from '../../lib/artifacts.js';

const HL_MAX_LINES = 5000;
const AUTO_HL_MAX_LINES = 1200;
const PAINT_MS = 90;
const SCROLL_MEM = new Map();

const CodeRow = React.memo(function CodeRow({ n, html, hit, hasMatch }) {
  return (
    <div className={'art-line' + (hit ? ' hit' : '') + (hasMatch ? ' has-match' : '')}>
      <span className="art-ln">{n}</span>
      <span className="art-lc" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
    </div>
  );
});

function useFrameThrottle(value, active) {
  const [v, setV] = useState(value);
  const latest = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    latest.current = value;
    if (!active) { if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; } setV(value); return; }
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; setV(latest.current); });
  }, [value, active]);
  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);
  return active ? v : value;
}

function ImageView({ src, alt }) {
  const [z, setZ] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const onWheel = (e) => { e.preventDefault(); setZ(v => Math.min(8, Math.max(0.2, v * (e.deltaY < 0 ? 1.12 : 0.89)))); };
  const onDown = (e) => { drag.current = { x: e.clientX - off.x, y: e.clientY - off.y }; };
  const onMove = (e) => { if (!drag.current) return; setOff({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); };
  const onUp = () => { drag.current = null; };
  const reset = () => { setZ(1); setOff({ x: 0, y: 0 }); };
  return (
    <div className="art-imgwrap">
      <div className="art-imgstage" onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onDoubleClick={reset} style={{ cursor: z > 1 ? 'grab' : 'default' }}>
        <img className="art-img" src={src} alt={alt} draggable={false} style={{ transform: `translate(${off.x}px, ${off.y}px) scale(${z})` }} />
      </div>
      <div className="art-imgbar">
        <button className="art-btn icon" onClick={() => setZ(v => Math.max(0.2, v * 0.8))} title={t("Zoom out")}>−</button>
        <span className="art-imgzoom">{Math.round(z * 100)}%</span>
        <button className="art-btn icon" onClick={() => setZ(v => Math.min(8, v * 1.25))} title={t("Zoom in")}>+</button>
        <button className="art-btn icon" onClick={reset} title={t("Reset")}>⤢</button>
        <a className="art-btn copy" href={src} style={{ borderRadius: 8 }}><Download style={{ width: 14 }} /> {t("Download")}</a>
      </div>
    </div>
  );
}

const PREVIEW_SANDBOX = 'allow-scripts allow-modals allow-forms allow-popups allow-downloads allow-pointer-lock';

function HtmlPreview({ chatId, path, html }) {
  const [doc, setDoc] = useState(null);
  useEffect(() => {
    let on = true;
    setDoc(null);
    buildPreviewDoc({ chatId, path, html })
      .then(d => { if (on) setDoc(d); })
      .catch(() => { if (on) setDoc(html); });
    return () => { on = false; };
  }, [chatId, path, html]);
  if (doc == null) return <div className="art-empty"><div className="art-empty-spin" />{t('Preparing preview…')}</div>;
  return <iframe className="art-preview-frame" sandbox={PREVIEW_SANDBOX} srcDoc={doc} title={baseName(path)} referrerPolicy="no-referrer" />;
}

export default function Viewer({ chatId, path, onBack, canBack, liveText, liveInfo = null, committed = true, pendingText = null, fileV = 0, headerExtra = null, onFocusPane }) {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState(false);
  const [diff, setDiff] = useState(false);
  const [wrap, setWrap] = useState(() => localStorage.getItem('oq-art-wrap') === '1');
  const [prev, setPrev] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [baseText, setBaseText] = useState(null);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState('');
  const [matchIdx, setMatchIdx] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set());
  const loadTok = useRef(0);
  const searchInputRef = useRef(null);

  const ext = extOf(path);
  const isLive = liveText != null;
  const canPreview = PREVIEW_HTML.has(ext) || PREVIEW_MD.has(ext);
  const [mode, setMode] = useState(() => (PREVIEW_HTML.has(ext) ? 'preview' : 'code'));
  useEffect(() => { setMode(PREVIEW_HTML.has(extOf(path)) ? 'preview' : 'code'); }, [path]);
  const previewOn = canPreview && mode === 'preview' && !isLive && !diff;
  const liveEdit = isLive && liveInfo && liveInfo.tool === 'str_replace';
  const liveActive = isLive || liveEdit;
  const rawStream = isLive ? liveText : (!committed && pendingText != null ? pendingText : null);
  const fromStream = rawStream != null;
  const streamText = useFrameThrottle(rawStream ?? '', fromStream);

  useEffect(() => { setExpanded(new Set()); }, [path, diff]);
  useEffect(() => { setWrap(localStorage.getItem('oq-art-wrap') === '1'); }, [path]);
  useEffect(() => { if (search && searchInputRef.current) searchInputRef.current.focus(); }, [search]);

  useEffect(() => {
    if (!liveEdit) { setBaseText(null); return; }
    if (baseText != null) return;
    let on = true;
    api.get(`/api/chats/${chatId}/file?path=${encodeURIComponent(path)}`)
      .then(r => { if (on) setBaseText(r.text ?? ''); }).catch(() => { if (on) setBaseText(''); });
    return () => { on = false; };
  }, [liveEdit, path, chatId]);

  const liveDiff = useMemo(() => {
    if (!liveEdit || baseText == null) return null;
    const oldStr = liveInfo.oldStr || '';
    const newStr = streamText || '';
    const idx = oldStr ? baseText.indexOf(oldStr) : -1;
    const result = idx !== -1 ? baseText.slice(0, idx) + newStr + baseText.slice(idx + oldStr.length) : baseText;
    return { rows: stableLineDiff(baseText.split('\n'), result.split('\n')) };
  }, [liveEdit, baseText, streamText, liveInfo]);

  async function load(v, { blank = false } = {}) {
    const tok = ++loadTok.current;
    if (blank) setData(null);
    try { const r = await api.get(`/api/chats/${chatId}/file?path=${encodeURIComponent(path)}${v ? '&v=' + v : ''}`); if (tok === loadTok.current) setData(r); }
    catch { if (tok === loadTok.current) setData({ error: true }); }
  }
  useEffect(() => { if (isLive) return; if (committed) { setDiff(false); setPrev(null); load(undefined, { blank: true }); } else setData(null); }, [path, isLive, committed]);

  const pinnedOld = data && data.viewing && data.v && data.viewing !== data.v;
  useEffect(() => {
    if (isLive || !committed || !fileV) return;
    if (pinnedOld) return;
    if (data && data.v === fileV) return;
    load();
  }, [fileV]);

  const viewingV = data?.viewing;
  useEffect(() => {
    if (!diff || !viewingV || viewingV <= 1) { setPrev(null); return; }
    let on = true; setPrev(null);
    api.get(`/api/chats/${chatId}/file?path=${encodeURIComponent(path)}&v=${viewingV - 1}`)
      .then(r => { if (on) setPrev(r.text ?? ''); }).catch(() => { if (on) setPrev(''); });
    return () => { on = false; };
  }, [diff, viewingV, path, chatId]);

  const shownText = fromStream ? streamText : (data?.text != null ? data.text : null);
  const [viewText, setViewText] = useState(shownText);
  const paintPending = useRef(shownText);
  const paintTimer = useRef(null);
  useEffect(() => {
    paintPending.current = shownText;
    if (!liveActive) {
      if (paintTimer.current) { clearTimeout(paintTimer.current); paintTimer.current = null; }
      setViewText(shownText);
      return;
    }
    if (paintTimer.current) return;
    paintTimer.current = setTimeout(() => { paintTimer.current = null; setViewText(paintPending.current); }, PAINT_MS);
  }, [shownText, liveActive]);
  useEffect(() => () => { if (paintTimer.current) clearTimeout(paintTimer.current); }, []);

  const hlVersion = useSyncExternalStore(subscribeHljs, hljsVersion, hljsVersion);
  const rawLines = useMemo(() => viewText != null ? viewText.split('\n') : [], [viewText]);
  const bigFile = rawLines.length > HL_MAX_LINES;
  const lineHtmls = useMemo(() => {
    if (viewText == null) return [];
    if (liveActive || bigFile || viewText.length > 40000) return rawLines.map(escHtml);
    const lang = EXT_LANG[(fromStream ? ext : (data?.ext || '').toLowerCase())];
    try {
      let full;
      if (lang && knowsLanguage(lang)) full = rawHighlight(viewText, lang);
      else if (lang) { ensureLanguage(lang); return rawLines.map(escHtml); }
      else if (rawLines.length > AUTO_HL_MAX_LINES) return rawLines.map(escHtml);
      else full = rawHighlight(viewText, '');
      return splitHighlightedLines(full);
    } catch { return rawLines.map(escHtml); }
  }, [viewText, rawLines, liveActive, fromStream, bigFile, ext, data, hlVersion]);

  const matches = useMemo(() => findMatches(rawLines, query), [query, rawLines]);
  useEffect(() => { setMatchIdx(0); }, [query]);
  const matchesByLine = useMemo(() => { const m = new Map(); for (const x of matches) { if (!m.has(x.line)) m.set(x.line, []); m.get(x.line).push(x); } return m; }, [matches]);
  const activeMatch = matches[matchIdx] || null;

  const diffRows = useMemo(() => {
    if (!diff || prev == null || data?.text == null) return null;
    const raw = diffLines(prev.split('\n'), data.text.split('\n'));
    return raw == null ? null : collapseRuns(raw, 3, expanded);
  }, [diff, prev, data, expanded]);
  const liveRows = useMemo(() => liveDiff ? collapseRuns(liveDiff.rows, 4, expanded) : null, [liveDiff, expanded]);

  async function copy() { const text = data?.text != null ? data.text : shownText; if (text != null && await copyText(text)) { setCopied(true); setTimeout(() => setCopied(false), 1400); } }
  async function restore() {
    if (restoring || !viewing) return;
    setRestoring(true);
    try { await api.post(`/api/chats/${chatId}/restore`, { path, v: viewing }); await load(); } catch {}
    setRestoring(false);
  }

  const bodyRef = useRef(null);
  const codeRef = useRef(null);
  const followRef = useRef(true);
  const [following, setFollowing] = useState(true);
  const progUntil = useRef(0);
  const touchY = useRef(0);
  const scrollKey = chatId + '::' + path;

  useEffect(() => { followRef.current = true; setFollowing(true); }, [path]);

  const restoreScroll = useCallback(() => {
    const el = bodyRef.current; if (!el) return;
    const want = SCROLL_MEM.get(scrollKey) || 0;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    progUntil.current = Date.now() + 160;
    el.scrollTop = Math.min(want, max);
  }, [scrollKey]);

  useLayoutEffect(() => {
    if (liveActive && followRef.current) {
      const el = bodyRef.current;
      if (el) { progUntil.current = Date.now() + 160; el.scrollTop = el.scrollHeight; }
    }
  }, [viewText, liveActive]);

  useLayoutEffect(() => {
    if (liveActive && followRef.current) return;
    restoreScroll();
  }, [path, mode, diff, wrap, previewOn, data?.viewing, shownText != null, restoreScroll]);

  useLayoutEffect(() => {
    if (!activeMatch) return;
    const el = codeRef.current; if (!el) return;
    const node = el.querySelector('.art-line.hit');
    if (node && node.scrollIntoView) { progUntil.current = Date.now() + 160; node.scrollIntoView({ block: 'center' }); }
  }, [matchIdx, activeMatch, query]);

  function onBodyScroll() {
    const el = bodyRef.current; if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
    if (Date.now() > progUntil.current) SCROLL_MEM.set(scrollKey, el.scrollTop);
    if (liveActive && atBottom && !followRef.current) { followRef.current = true; setFollowing(true); }
  }
  function stopFollow() { if (liveActive && followRef.current) { followRef.current = false; setFollowing(false); } }
  function onBodyWheel(e) { if (e.deltaY < 0) stopFollow(); }
  function onBodyTouchStart(e) { touchY.current = e.touches[0]?.clientY || 0; }
  function onBodyTouchMove(e) { const y = e.touches[0]?.clientY || 0; if (y > touchY.current + 2) stopFollow(); touchY.current = y; }
  function jumpLatest() { followRef.current = true; setFollowing(true); const el = bodyRef.current; if (el) { progUntil.current = Date.now() + 160; el.scrollTop = el.scrollHeight; } }
  function nextMatch(d) { if (!matches.length) return; setMatchIdx(i => (i + d + matches.length) % matches.length); }
  function onSearchKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); nextMatch(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); setSearch(false); setQuery(''); }
  }

  function jumpToChange() {
    const el = codeRef.current || bodyRef.current;
    const node = el && el.querySelector('.art-diff-line.add, .art-diff-line.del');
    if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center' });
  }

  const versions = data?.versions || [];
  const viewing = data?.viewing;
  const current = data?.v;
  const stale = viewing && current && viewing !== current;
  const showText = (fromStream || (committed && data && data.text != null));
  const isCode = !liveEdit && showText && !diff && !previewOn;
  const crumbs = path.split('/');

  const renderDiffRows = (rows, live) => (
    <div className={'art-diff' + (live ? ' live' : '') + (wrap ? ' wrap' : '')} ref={live ? codeRef : undefined}>
      {(rows || []).map((r) => r.fold
        ? <button key={r.key} className="art-fold" onClick={() => setExpanded(s => { const n = new Set(s); n.add(r.key); return n; })}>⋯ {r.count} unchanged line{r.count === 1 ? '' : 's'}</button>
        : (
          <div key={r.key} className={'art-diff-line ' + r.type}>
            <span className="art-diff-sign">{r.type === 'add' ? '+' : r.type === 'del' ? '−' : ''}</span>
            <span className="art-diff-text">{r.text || ' '}</span>
          </div>
        ))}
      {live && <span className="live-caret diff" />}
    </div>
  );

  return (
    <div className="art-viewer" onMouseDown={onFocusPane}>
      <div className="art-vhead">
        <div className="art-vtitle">
          {canBack && <button className="art-back" onClick={onBack} title={t("Back to files")}><Chevron style={{ width: 16, transform: 'rotate(180deg)' }} /></button>}
          <span className="art-vname">{crumbs[crumbs.length - 1]}</span>
          <span className="art-vkind">{isLive ? (liveEdit ? t('editing…') : (liveText && liveText.length ? t('writing…') : t('creating…'))) : ext.toUpperCase()}</span>
          {!isLive && stale && <span className="art-vkind">v{viewing} of {current}</span>}
        </div>
        <div className="art-vactions">
          {!isLive && data?.text != null && (
            <div className="art-copy-wrap">
              <button className="art-btn copy" onClick={copy}>{copied ? <Check style={{ width: 14 }} /> : null} {copied ? t('Copied') : t('Copy')}</button>
              <button className="art-btn caret" onClick={() => setMenu(m => !m)}><ChevDown style={{ width: 13 }} /></button>
              {menu && (
                <div className="art-menu" onMouseLeave={() => setMenu(false)}>
                  <a className="art-menu-item" href={`/api/chats/${chatId}/download?path=${encodeURIComponent(path)}${stale ? '&v=' + viewing : ''}`}>Download as {ext.toUpperCase()}</a>
                  {canPreview && showText && (
                    <button className="art-menu-item" onClick={() => { setMenu(false); setMode(mode === 'preview' ? 'code' : 'preview'); }}>
                      {mode === 'preview' ? t('Code') : t('Preview')}
                    </button>
                  )}
                  {showText && !previewOn && <button className="art-menu-item" onClick={() => { setMenu(false); setSearch(true); }}>{t('Find in file')}</button>}
                  {isCode && (
                    <button className="art-menu-item" onClick={() => { setMenu(false); setWrap(w => { localStorage.setItem('oq-art-wrap', w ? '0' : '1'); return !w; }); }}>
                      {t('Toggle word wrap')}{wrap && <Check style={{ width: 13 }} />}
                    </button>
                  )}
                  {viewing > 1 && (
                    <button className="art-menu-item" onClick={() => { setMenu(false); setDiff(d => !d); }}>
                      {t('Show changes from previous version')}{diff && <Check style={{ width: 13 }} />}
                    </button>
                  )}
                  {versions.length > 1 && <>
                    <div className="art-menu-label">{t("Version history")}</div>
                    {[...versions].reverse().map(v => (
                      <button key={v} className={'art-menu-item ver' + (v === viewing ? ' active' : '')} onClick={() => { setMenu(false); load(v); }}>
                        Version {v}{v === current ? ' · latest' : ''}{v === viewing && <Check style={{ width: 13 }} />}
                      </button>
                    ))}
                  </>}
                </div>
              )}
            </div>
          )}
          {headerExtra}
        </div>
      </div>
      {search && !isLive && (
        <div className="art-search">
          <Search style={{ width: 14, opacity: .6, flexShrink: 0 }} />
          <input ref={searchInputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={onSearchKey} placeholder={t('Find in file')} spellCheck={false} />
          <span className="art-search-count">{matches.length ? `${matchIdx + 1} / ${matches.length}` : (query ? '0' : '')}</span>
          <button className="art-btn icon" disabled={!matches.length} onClick={() => nextMatch(-1)} title={t("Previous")}>↑</button>
          <button className="art-btn icon" disabled={!matches.length} onClick={() => nextMatch(1)} title={t("Next")}>↓</button>
          <button className="art-btn icon" onClick={() => { setSearch(false); setQuery(''); }} title={t("Close")}><X style={{ width: 13 }} /></button>
        </div>
      )}
      {stale && (
        <div className="art-stale-row">
          <button className="art-stale-bar" onClick={() => load()}>Viewing older version v{viewing}, jump to latest (v{current})</button>
          <button className="art-restore-btn" disabled={restoring} onClick={restore}>{restoring ? 'Restoring…' : `Restore v${viewing}`}</button>
        </div>
      )}
      <div className="art-vbody" ref={bodyRef} onScroll={onBodyScroll} onWheel={onBodyWheel} onTouchStart={onBodyTouchStart} onTouchMove={onBodyTouchMove}>
        {liveEdit && (
          baseText == null
            ? <div className="art-skel">{Array.from({ length: 14 }).map((_, i) => <span key={i} className="skeleton" style={{ width: (32 + ((i * 53) % 58)) + '%' }} />)}</div>
            : renderDiffRows(liveRows, true)
        )}
        {!liveEdit && showText && !diff && previewOn && (
          PREVIEW_MD.has(ext)
            ? <div className="art-md"><Markdown>{shownText || ''}</Markdown></div>
            : <HtmlPreview chatId={chatId} path={path} html={shownText || ''} />
        )}
        {isCode && (
          <div className={'art-code2' + (isLive ? ' live' : '') + (wrap ? ' wrap' : '')} ref={codeRef}>
            {lineHtmls.map((lh, i) => {
              const lm = matchesByLine.get(i);
              const hit = !!(activeMatch && activeMatch.line === i);
              const inner = lm ? markLine(rawLines[i] ?? '', lm, activeMatch ? activeMatch.gid : -1) : lh;
              return <CodeRow key={i} n={i + 1} html={inner} hit={hit} hasMatch={!!lm} />;
            })}
            {isLive && <div className="art-line caret"><span className="art-ln" /><span className="art-lc"><span className="live-caret" /></span></div>}
          </div>
        )}
        {!fromStream && !committed && <div className="art-empty"><div className="art-empty-spin" />{t("This file is still being written…")}</div>}
        {!fromStream && committed && !data && (
          <div className="art-skel">
            {Array.from({ length: 16 }).map((_, i) => <span key={i} className="skeleton" style={{ width: (32 + ((i * 53) % 58)) + '%' }} />)}
          </div>
        )}
        {!fromStream && committed && data?.error && <div className="art-empty">{t("Couldn't load this file.")}</div>}
        {!fromStream && data && data.text != null && diff && (
          prev == null ? <div className="art-empty">{t("Loading diff…")}</div>
            : diffRows == null ? <div className="art-empty">{t("File too large to diff.")}</div>
              : renderDiffRows(diffRows, false)
        )}
        {!isLive && data && data.binary && (
          IMAGE_EXT.has(ext)
            ? <ImageView src={data.downloadUrl} alt={baseName(path)} />
            : (
              <div className="art-binary">
                <div className="art-binary-icon"><FileChip ext={ext} size="lg" /></div>
                <div className="art-bname">{baseName(path)}</div>
                <a className="btn primary" href={data.downloadUrl}><Download style={{ width: 15, verticalAlign: '-2px' }} /> {t("Download")}</a>
              </div>
            )
        )}
      </div>
      {diff && diffRows && <button className="art-jump change" onClick={jumpToChange} title={t("Jump to first change")}><Down style={{ width: 14 }} /> {t("Change")}</button>}
      {liveActive && !following && <button className="art-jump" onClick={jumpLatest}><Down style={{ width: 14 }} /> {t('Jump to latest')}</button>}
    </div>
  );
}
