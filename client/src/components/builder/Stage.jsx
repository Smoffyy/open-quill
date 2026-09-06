import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Message from '../Message.jsx';
import ToolCard from '../ToolCard.jsx';
import { ChatMenu, menuAtButton } from '../ChatMenu.jsx';
import { t, tk } from '../../i18n.jsx';
import { toast } from '../../toast.js';
import { BRAND_ICON, BRAND_GENERATING, BRAND_THINKING } from '../../lib/brand.js';
import { DotsV, Ghost, Info, Gauge } from '../icons.jsx';

/* Most of an interface only exists while something is happening. There are no
   messages until someone sends one, no chats in a new workspace, no menu until
   someone opens it, and no warning banner until something breaks. None of that
   can be styled if it is never on screen.

   So build mode fills the gaps. Regions that are empty get sample content, and
   the picker in the top bar puts any one-off surface on the canvas on demand.
   Nothing here is a mock-up: the sample conversation mounts the real Message
   component, and every window and menu is the app's own, opened the way a
   person would open it. What an admin styles is what ships. */

const SAMPLE_USER = 'Can you summarise the release notes and show me the config?';

const SAMPLE_ASSISTANT = `# Release 27.1

## What changed

The scheduler now retries failed jobs with a backoff, and \`worker.concurrency\`
defaults to the number of cores. See the [upgrade notes](#) before deploying.

- Retries are capped at five attempts
- Dead letters land in \`jobs.failed\`
- Metrics are unchanged

> Existing queues keep their old behaviour until you restart the worker.

| Setting | Old | New |
| --- | --- | --- |
| retries | 0 | 5 |
| backoff | none | exponential |

---

\`\`\`js
export const worker = {
  concurrency: os.cpus().length,
  retries: 5
};
\`\`\`
`;

const SAMPLE_REASONING = 'Checking which settings actually changed before writing the summary.';

const SAMPLE_MODEL = {
  id: 'oq-stage-model',
  displayName: 'Sample model',
  iconPosition: 'below',
  iconSize: 40,
  showName: true,
  staticIcon: BRAND_ICON,
  generatingIcon: BRAND_GENERATING,
  thinkingIcon: BRAND_THINKING
};

const SAMPLE_CALL = { tool: 'view', path: 'server/lib/worker.js' };
const SAMPLE_RESULT = { ok: true, output: 'export const worker = {\n  concurrency: 8\n};' };

const SAMPLE_CHATS = [
  { id: 'oq-stage-chat-1', title: 'Release notes for 27.1', active: true },
  { id: 'oq-stage-chat-2', title: 'Onboarding checklist' },
  { id: 'oq-stage-chat-3', title: 'Queue retry design' },
  { id: 'oq-stage-chat-4', title: 'Pricing page copy' }
];

const noop = () => {};

function stageMessages() {
  const now = Date.now();
  return [
    {
      id: 'oq-stage-user',
      role: 'user',
      content: SAMPLE_USER,
      created_at: now - 60000,
      pinned: true,
      attachments: [{ id: 'oq-stage-file', name: 'release-notes.md', size: 4096, mime: 'text/markdown' }]
    },
    {
      id: 'oq-stage-assistant',
      role: 'assistant',
      content: SAMPLE_ASSISTANT,
      reasoning: SAMPLE_REASONING,
      model_id: SAMPLE_MODEL.id,
      created_at: now
    }
  ];
}

export const STAGES = [
  { id: '', label: tk('Live app'), hint: tk('The interface exactly as it is right now.') },
  { id: 'thread', label: tk('Conversation'), hint: tk('A sample exchange, so messages and their text can be styled with no chat open.') },
  { id: 'states', label: tk('Banners & states'), hint: tk('The pieces that only appear when something happens: banners, notifications, tooltips, loading.') },
  { id: 'settings', label: tk('Settings window'), hint: tk('Opens the real settings window.'), command: 'openSettings' },
  { id: 'cmdk', label: tk('Command palette'), hint: tk('Opens the real command palette.'), command: 'commandPalette' },
  { id: 'shortcuts', label: tk('Shortcuts window'), hint: tk('Opens the real shortcuts window.'), command: 'shortcuts' },
  { id: 'search', label: tk('Search window'), hint: tk('Opens the real chat search.'), command: 'searchChats' },
  { id: 'model', label: tk('Model menu'), hint: tk('Opens the model picker in the composer.'), click: '.model-trigger' },
  { id: 'attach', label: tk('Attachment menu'), hint: tk('Opens the plus menu in the composer.'), click: '.composer .plus' },
  { id: 'profile', label: tk('Profile menu'), hint: tk('Opens the account menu at the foot of the sidebar.'), click: '.profile-btn' },
  { id: 'chatMenu', label: tk('Chat row menu'), hint: tk('Opens the options menu on a chat in the sidebar.'), click: '.chat-row .row-ctrl' }
];

export const STAGE_BY_ID = STAGES.reduce((m, x) => { m[x.id] = x; return m; }, { __proto__: null });

// Build mode swallows real clicks so that clicking the app selects rather than
// activates. A stage opening a menu is not a real click, and says so.
function passthroughClick(sel) {
  const el = document.querySelector(sel);
  if (!el) return false;
  const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
  ev.oqPass = true;
  el.dispatchEvent(ev);
  return true;
}

export function openStage(id) {
  const stage = STAGE_BY_ID[id];
  closeStage();
  if (!stage || !stage.click) {
    if (stage?.command) window.dispatchEvent(new CustomEvent('oq-command', { detail: { id: stage.command } }));
    return true;
  }
  if (passthroughClick(stage.click)) return true;
  toast(t('That part of the interface is not on screen right now.'));
  return false;
}

/* Escape is what the app itself listens for, so one key closes whichever window
   or menu the last stage opened without the builder tracking which it was. It
   has to be aimed, though: a focus-trapped window listens on its own root, and
   an event dispatched at the document never travels down into it. */
export function closeStage() {
  const roots = new Set([document.activeElement, ...document.querySelectorAll(ESCAPABLE), document, window]);
  for (const root of roots) {
    root?.dispatchEvent?.(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  // Not every window listens for Escape; the ones that do not close when their
  // scrim is pressed, which is the other thing a person would do.
  for (const scrim of document.querySelectorAll('.overlay')) {
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window });
    ev.oqPass = true;
    scrim.dispatchEvent(ev);
  }
}

const ESCAPABLE = '.overlay, .modal, .cmdk, .popover, .lightbox, [role="dialog"]';

/* A portal host that waits for its element to exist, since the sidebar and the
   canvas mount on their own schedule and a stage can be picked before either is
   ready. With `before`, sample content lands where the real thing would sit
   rather than at the end of its parent. */
function useHost(sel, before) {
  const [host, setHost] = useState(null);
  useEffect(() => {
    let raf = 0;
    let slot = null;
    const find = () => {
      const parent = document.querySelector(sel);
      if (!parent) { raf = requestAnimationFrame(find); return; }
      if (!before) { setHost(parent); return; }
      slot = document.createElement('div');
      slot.className = 'bx-stage-slot';
      parent.insertBefore(slot, parent.querySelector(before));
      setHost(slot);
    };
    find();
    return () => { cancelAnimationFrame(raf); slot?.remove(); };
  }, [sel, before]);
  return host;
}

/* Whether a region is still empty, watched rather than read once. Sample rows
   are the same markup as real ones, so a plain query would see the sample and
   conclude the region had filled up, then take it away again. */
function useAbsent(parentSel, childSel) {
  const [absent, setAbsent] = useState(true);
  useEffect(() => {
    let raf = 0;
    let obs = null;
    const check = () => setAbsent(!document.querySelector(childSel));
    const watch = () => {
      const parent = document.querySelector(parentSel);
      if (!parent) { raf = requestAnimationFrame(watch); return; }
      check();
      obs = new MutationObserver(check);
      obs.observe(parent, { childList: true, subtree: true });
    };
    watch();
    return () => { cancelAnimationFrame(raf); obs?.disconnect(); };
  }, [parentSel, childSel]);
  return absent;
}

function SampleChats() {
  const host = useHost('.sidebar .chats');
  const empty = useAbsent('.sidebar .chats', '.chat-row:not([data-oq-sample])');
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (!host || !empty) return undefined;
    document.documentElement.setAttribute('data-oq-chats', 'sample');
    return () => document.documentElement.removeAttribute('data-oq-chats');
  }, [host, empty]);
  if (!host || !empty) return null;
  return createPortal(
    <>
      {SAMPLE_CHATS.map(c => (
        <div key={c.id} className={'chat-row' + (c.active ? ' active' : '')} data-oq-sample="">
          <span className="row-ic"><span className="row-dot" aria-hidden="true" /></span>
          <span className="title">{c.title}</span>
          <button type="button" className="row-ctrl" title={t('Options')} aria-label={t('Options')}
            onClick={(e) => { e.stopPropagation(); const at = menuAtButton(e.currentTarget); setMenu(m => (m && m.id === c.id ? null : { id: c.id, at })); }}>
            <DotsV />
          </button>
          {menu?.id === c.id && (
            <ChatMenu chat={c} at={menu.at} onClose={() => setMenu(null)}
              onToggleStar={noop} onMoveToProject={noop} onDelete={noop} onStopChat={noop} />
          )}
        </div>
      ))}
    </>, host);
}

function SampleThread() {
  const host = useHost('.main');
  const [messages] = useState(stageMessages);
  useEffect(() => {
    document.documentElement.setAttribute('data-oq-stage', 'thread');
    return () => document.documentElement.removeAttribute('data-oq-stage');
  }, []);
  if (!host) return null;
  return createPortal(
    <div className="scroll-area bx-stage-scroll">
      <div className="thread" role="log" aria-label={t('Sample conversation')}>
        {messages.map(msg => (
          <Message key={msg.id} msg={msg} chatId="oq-stage" phase="static"
            model={msg.role === 'assistant' ? SAMPLE_MODEL : null} models={[SAMPLE_MODEL]} currentId={SAMPLE_MODEL.id}
            onRegenerate={noop} onRegenerateWith={noop} onEdit={noop} onDelete={noop} onFork={noop} onTogglePin={noop} />
        ))}
        <div className="msg assistant">
          <ToolCard call={SAMPLE_CALL} result={SAMPLE_RESULT} />
        </div>
        <div className="thread-pad" />
      </div>
    </div>, host);
}

/* The one-off pieces, gathered where they can be reached. Each is the markup
   the app itself renders, so styling one here styles it everywhere. */
function SampleStates() {
  const host = useHost('.main');
  useEffect(() => {
    document.documentElement.setAttribute('data-oq-stage', 'states');
    return () => document.documentElement.removeAttribute('data-oq-stage');
  }, []);
  if (!host) return null;
  return createPortal(
    <div className="bx-stage-states">
      <div className="incognito-bar">
        <div className="incog-left">
          <div className="incognito-title"><Ghost style={{ width: 18 }} /> {t('Incognito chat')}</div>
        </div>
      </div>
      <div className="unavail-banner">
        <div className="unavail-row">
          <span className="unavail-msg"><strong>{t('Sample model')}</strong> {t('is unavailable right now.')}</span>
        </div>
      </div>
      <div className="toast">
        <span className="toast-ico"><Info style={{ width: 15 }} /></span>
        <span className="toast-msg">{t('Saved.')}</span>
      </div>
      <div className="tip"><span className="tip-label">{t('A tooltip')}</span></div>
      <div className="btn-row">
        <button type="button" className="btn">{t('Cancel')}</button>
        <button type="button" className="btn primary">{t('Save')}</button>
        <span className="badge">{t('New')}</span>
        <span className="chip">{t('A chip')}</span>
      </div>
      <div className="ctx-gauge"><span className="cg-bar"><span className="cg-fill" style={{ width: '42%' }} /></span></div>
      <div className="engine-strip final"><span className="es-icon"><Gauge style={{ width: 13 }} /></span><span className="es-stat">{t('Sample telemetry')}</span></div>
      <span className="skeleton" style={{ width: 220 }} />
    </div>, host);
}

// The composer only grows an attachment row once a file is picked, so build
// mode supplies one when there is none.
function SampleAttachment() {
  const host = useHost('.composer', '.composer-bar');
  const empty = useAbsent('.composer', '.attach-row:not([data-oq-sample])');
  if (!host || !empty) return null;
  return createPortal(
    <div className="attach-row" data-oq-sample="">
      <div className="attach-chip">
        <div className="attach-file" title="release-notes.md">
          <div className="attach-name">release-notes.md</div>
          <div className="attach-foot"><span className="attach-type">MD</span></div>
        </div>
        <button type="button" className="attach-x" title={t('Remove')}>{'✕'}</button>
      </div>
    </div>, host);
}

export default function Stage({ id }) {
  return (
    <>
      <SampleChats />
      <SampleAttachment />
      {id === 'thread' && <SampleThread />}
      {id === 'states' && <SampleStates />}
    </>
  );
}
