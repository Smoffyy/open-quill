import { tk } from '../../i18n.jsx';

export const THEME_SCHEMA = 1;

/* ---------------------------------------------------------------------------
   Design tokens

   Every token writes one CSS custom property that the app's own stylesheets
   already read, so changing a token restyles every component that uses it
   without the builder having to know those components exist. New tokens
   (spacing, radius steps, shadow steps) are exposed to element controls as
   pickable values, which is what makes them worth being global.
--------------------------------------------------------------------------- */

export const TOKEN_GROUPS = [
  {
    id: 'color', label: tk('Colors'), kind: 'color',
    tokens: [
      { id: 'bg', var: '--bg', label: tk('Background') },
      { id: 'sidebar', var: '--sidebar', label: tk('Sidebar') },
      { id: 'surface', var: '--surface', label: tk('Surface') },
      { id: 'surface2', var: '--surface-2', label: tk('Surface raised') },
      { id: 'surfaceHover', var: '--surface-hover', label: tk('Surface hover') },
      { id: 'border', var: '--border', label: tk('Border') },
      { id: 'text', var: '--text', label: tk('Text') },
      { id: 'textMuted', var: '--text-muted', label: tk('Muted text') },
      { id: 'textFaint', var: '--text-faint', label: tk('Faint text') },
      { id: 'accent', var: '--accent', label: tk('Accent') },
      { id: 'onAccent', var: '--on-accent', label: tk('Text on accent') },
      { id: 'link', var: '--link', label: tk('Link') },
      { id: 'userBubble', var: '--user-bubble', label: tk('Message bubble') },
      { id: 'composerBg', var: '--composer-bg', label: tk('Composer') },
      { id: 'inputBg', var: '--input-bg', label: tk('Input') },
      { id: 'menuBg', var: '--menu-bg', label: tk('Menu') },
      { id: 'popBg', var: '--pop-bg', label: tk('Popover') },
      { id: 'popText', var: '--pop-text', label: tk('Popover text') },
      { id: 'modalBg', var: '--modal-bg', label: tk('Modal') },
      { id: 'cardBg', var: '--card-bg', label: tk('Card') },
      { id: 'codeBg', var: '--code-bg', label: tk('Code block') },
      { id: 'success', var: '--success', label: tk('Success') },
      { id: 'warning', var: '--warning', label: tk('Warning') },
      { id: 'danger', var: '--danger', label: tk('Error') }
    ]
  },
  {
    id: 'font', label: tk('Typography'), kind: 'font',
    tokens: [
      { id: 'display', var: '--font-serif', label: tk('Heading font'), kind: 'fontFamily' },
      { id: 'body', var: '--font-sans', label: tk('Body font'), kind: 'fontFamily' },
      { id: 'proseWeight', var: '--prose-weight', label: tk('Body weight'), kind: 'number', min: 100, max: 900, step: 5 },
      { id: 'proseStrong', var: '--prose-strong', label: tk('Bold weight'), kind: 'number', min: 100, max: 900, step: 5 }
    ]
  },
  {
    id: 'space', label: tk('Spacing'), kind: 'size',
    tokens: [
      { id: 'xs', var: '--oq-space-xs', label: tk('Extra small'), def: '4px', min: 0, max: 40 },
      { id: 'sm', var: '--oq-space-sm', label: tk('Small'), def: '8px', min: 0, max: 60 },
      { id: 'md', var: '--oq-space-md', label: tk('Medium'), def: '12px', min: 0, max: 80 },
      { id: 'lg', var: '--oq-space-lg', label: tk('Large'), def: '20px', min: 0, max: 120 },
      { id: 'xl', var: '--oq-space-xl', label: tk('Extra large'), def: '32px', min: 0, max: 200 }
    ]
  },
  {
    id: 'radius', label: tk('Corner radius'), kind: 'size',
    tokens: [
      { id: 'base', var: '--radius', label: tk('Default'), def: '14px', min: 0, max: 48 },
      { id: 'sm', var: '--oq-radius-sm', label: tk('Small'), def: '6px', min: 0, max: 40 },
      { id: 'md', var: '--oq-radius-md', label: tk('Medium'), def: '10px', min: 0, max: 60 },
      { id: 'lg', var: '--oq-radius-lg', label: tk('Large'), def: '18px', min: 0, max: 80 },
      { id: 'full', var: '--oq-radius-full', label: tk('Pill'), def: '999px', min: 0, max: 999 }
    ]
  },
  {
    id: 'shadow', label: tk('Shadows'), kind: 'shadow',
    tokens: [
      { id: 'sm', var: '--oq-shadow-sm', label: tk('Small'), def: '0 1px 2px rgba(0,0,0,.16)' },
      { id: 'md', var: '--oq-shadow-md', label: tk('Medium'), def: '0 4px 14px rgba(0,0,0,.22)' },
      { id: 'lg', var: '--oq-shadow-lg', label: tk('Large'), def: '0 12px 32px rgba(0,0,0,.30)' },
      { id: 'popover', var: '--pop-shadow', label: tk('Menus and popovers') }
    ]
  },
  {
    id: 'motion', label: tk('Motion'), kind: 'motion',
    tokens: [
      { id: 'duration', var: '--fx-t', label: tk('Transition speed'), def: '.15s', kind: 'seconds', min: 0, max: 1.2, step: 0.01 },
      { id: 'easing', var: '--oq-ease', label: tk('Easing'), def: 'ease', kind: 'easing' }
    ]
  }
];

export const TOKEN_INDEX = (() => {
  const m = new Map();
  for (const g of TOKEN_GROUPS) for (const tok of g.tokens) m.set(g.id + '.' + tok.id, { ...tok, group: g.id, kind: tok.kind || g.kind });
  return m;
})();

// Values an element control can borrow from the global palette. Picking one
// writes var(--token) rather than a literal, so a later token change follows.
export function tokenRefs(kind) {
  const out = [];
  for (const g of TOKEN_GROUPS) {
    if (kind === 'color' && g.id !== 'color') continue;
    if (kind === 'size' && !['space', 'radius'].includes(g.id)) continue;
    if (kind === 'shadow' && g.id !== 'shadow') continue;
    for (const tok of g.tokens) out.push({ id: g.id + '.' + tok.id, label: tok.label, value: `var(${tok.var})` });
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Element registry

   An element is a named piece of the running interface plus the CSS selector
   that finds it. Build mode matches a click against this list rather than
   against React, so instrumenting a component is never required to style it.
   Only ordering and editable text need the component to opt in.

   caps decides which inspector groups appear. Showing every group on every
   element is what turns a builder back into a settings page.
--------------------------------------------------------------------------- */

const ALL = ['layout', 'size', 'spacing', 'type', 'color', 'border', 'effects', 'motion', 'states', 'responsive'];
const BOX = ['size', 'spacing', 'color', 'border', 'effects', 'motion', 'states', 'responsive'];
const TEXTY = ['size', 'spacing', 'type', 'color', 'effects', 'motion', 'responsive'];
const CTRL = ['layout', 'size', 'spacing', 'type', 'color', 'border', 'effects', 'motion', 'states', 'responsive'];

export const CATEGORIES = [
  { id: 'shell', label: tk('Shell') },
  { id: 'sidebar', label: tk('Sidebar') },
  { id: 'nav', label: tk('Navigation') },
  { id: 'home', label: tk('New chat screen') },
  { id: 'composer', label: tk('Composer') },
  { id: 'thread', label: tk('Conversation') },
  { id: 'chrome', label: tk('Menus & overlays') },
  { id: 'panels', label: tk('Panels & pages') },
  { id: 'controls', label: tk('Controls') },
  { id: 'feedback', label: tk('Feedback') }
];

export const ELEMENTS = [
  /* shell */
  { id: 'app', label: tk('App'), cat: 'shell', sel: '.app', caps: ['layout', 'color', 'motion', 'responsive'] },
  { id: 'main', label: tk('Content area'), cat: 'shell', sel: '.main', parent: 'app', caps: ALL },
  { id: 'topbar', label: tk('Header'), cat: 'shell', sel: '.topbar', parent: 'main', caps: ALL },
  { id: 'topbarActions', label: tk('Header actions'), cat: 'shell', sel: '.topbar-actions', parent: 'topbar', caps: ALL, orders: true },
  { id: 'topbarBtn', label: tk('Header button'), cat: 'shell', sel: '.paper-btn', parent: 'topbarActions', caps: CTRL, icon: true },
  { id: 'incognitoBar', label: tk('Incognito bar'), cat: 'shell', sel: '.incognito-bar', parent: 'main', caps: ALL },
  { id: 'incognitoTitle', label: tk('Incognito title'), cat: 'shell', sel: '.incognito-title', parent: 'incognitoBar', caps: TEXTY },
  { id: 'appBg', label: tk('Background layer'), cat: 'shell', sel: '.app-bg-layer', parent: 'app', caps: ['size', 'color', 'effects', 'motion'] },
  { id: 'appBgScrim', label: tk('Background scrim'), cat: 'shell', sel: '.app-bg-scrim', parent: 'app', caps: ['color', 'effects'] },
  { id: 'topbarModel', label: tk('Header model name'), cat: 'shell', sel: '.topbar-model', parent: 'topbar', caps: CTRL },
  { id: 'mobileMenuBtn', label: tk('Mobile menu button'), cat: 'shell', sel: '.mobile-menu-btn', parent: 'topbar', caps: CTRL, icon: true },
  { id: 'scrollArea', label: tk('Scroll area'), cat: 'shell', sel: '.scroll-area', parent: 'main', caps: ['spacing', 'size', 'color', 'responsive'] },

  /* sidebar */
  { id: 'sidebar', label: tk('Sidebar'), cat: 'sidebar', sel: '.sidebar', parent: 'app', caps: ALL },
  { id: 'sidebarHead', label: tk('Sidebar header'), cat: 'sidebar', sel: '.sidebar-head', parent: 'sidebar', caps: ALL, orders: true },
  { id: 'brand', label: tk('Logo / workspace name'), cat: 'sidebar', sel: '.brand', parent: 'sidebarHead', caps: TEXTY },
  { id: 'brandVersion', label: tk('Version line'), cat: 'sidebar', sel: '.brand-version', parent: 'sidebarHead', caps: TEXTY },
  { id: 'sidebarHeadActions', label: tk('Sidebar header buttons'), cat: 'sidebar', sel: '.sidebar-head-actions', parent: 'sidebarHead', caps: ALL, orders: true },
  { id: 'searchBtn', label: tk('Search button'), cat: 'sidebar', sel: '.search-btn', parent: 'sidebarHeadActions', caps: CTRL, icon: true },
  { id: 'collapseBtn', label: tk('Collapse button'), cat: 'sidebar', sel: '.collapse-btn', parent: 'sidebarHeadActions', caps: CTRL, icon: true },
  { id: 'sidebarNav', label: tk('Primary navigation'), cat: 'nav', sel: '.sidebar > .nav', parent: 'sidebar', caps: ALL, orders: true },
  { id: 'navItem', label: tk('Navigation item'), cat: 'nav', sel: '.nav-item', parent: 'sidebarNav', caps: CTRL },
  { id: 'navIcon', label: tk('Navigation icon'), cat: 'nav', sel: '.nav-ic', parent: 'navItem', caps: ['size', 'spacing', 'color', 'effects', 'motion', 'states'] },
  { id: 'navLabel', label: tk('Navigation label'), cat: 'nav', sel: '.nav-label', parent: 'navItem', caps: TEXTY },
  { id: 'navShortcut', label: tk('Navigation shortcut'), cat: 'nav', sel: '.nav-shortcut', parent: 'navItem', caps: TEXTY },
  { id: 'newChatBtn', label: tk('New chat button'), cat: 'nav', sel: '.nav-item.new-chat', parent: 'sidebarNav', caps: CTRL, slotKey: 'nav.new' },
  { id: 'quickTaskBtn', label: tk('Quick task button'), cat: 'nav', sel: '.new-quick', parent: 'sidebarNav', caps: CTRL, icon: true },
  { id: 'sectionLabel', label: tk('Section label'), cat: 'sidebar', sel: '.section-label', parent: 'sidebar', caps: TEXTY },
  { id: 'chatList', label: tk('Chat list'), cat: 'sidebar', sel: '.chats', parent: 'sidebar', caps: ALL },
  { id: 'chatRow', label: tk('Chat list row'), cat: 'sidebar', sel: '.chat-row', parent: 'chatList', caps: CTRL },
  { id: 'chatRowTitle', label: tk('Chat row title'), cat: 'sidebar', sel: '.chat-row .title', parent: 'chatRow', caps: TEXTY },
  { id: 'chatRowDot', label: tk('Chat row marker'), cat: 'sidebar', sel: '.row-dot', parent: 'chatRow', caps: BOX },
  { id: 'profile', label: tk('Profile section'), cat: 'sidebar', sel: '.profile', parent: 'sidebar', caps: ALL },
  { id: 'profileBtn', label: tk('Profile button'), cat: 'sidebar', sel: '.profile-btn', parent: 'profile', caps: CTRL },
  { id: 'profileInfo', label: tk('Profile name and plan'), cat: 'sidebar', sel: '.profile-info', parent: 'profileBtn', caps: TEXTY },
  { id: 'profileApps', label: tk('Version button'), cat: 'sidebar', sel: '.profile-apps', parent: 'profile', caps: CTRL, icon: true },
  { id: 'navBadge', label: tk('Navigation badge'), cat: 'nav', sel: '.nav-badge', parent: 'navItem', caps: BOX.concat(['type']) },
  { id: 'rowCtrl', label: tk('Chat row options button'), cat: 'sidebar', sel: '.row-ctrl', parent: 'chatRow', caps: CTRL, icon: true },
  { id: 'chatSkel', label: tk('Chat list placeholder'), cat: 'sidebar', sel: '.chat-skel', parent: 'chatList', caps: BOX },
  { id: 'sideResize', label: tk('Sidebar resize handle'), cat: 'sidebar', sel: '.side-resize', parent: 'sidebar', caps: BOX },
  { id: 'railOpen', label: tk('Collapsed sidebar tab'), cat: 'sidebar', sel: '.rail-open', parent: 'app', caps: CTRL, icon: true },

  /* new chat screen */
  { id: 'centerWrap', label: tk('Empty state'), cat: 'home', sel: '.center-wrap', parent: 'main', caps: ALL, orders: true },
  { id: 'greeting', label: tk('Greeting'), cat: 'home', sel: '.greeting', parent: 'centerWrap', caps: TEXTY.concat(['motion']) },
  { id: 'quickPrompts', label: tk('Starter prompts'), cat: 'home', sel: '.quick-prompts', parent: 'centerWrap', caps: ALL, orders: true },
  { id: 'quickPrompt', label: tk('Starter prompt'), cat: 'home', sel: '.quick-prompt', parent: 'quickPrompts', caps: CTRL },
  { id: 'quickPromptIcon', label: tk('Starter prompt icon'), cat: 'home', sel: '.qp-icon', parent: 'quickPrompt', caps: ['size', 'spacing', 'color', 'effects'] },
  { id: 'chatsEmpty', label: tk('Empty chat list'), cat: 'home', sel: '.chats-empty', parent: 'chatList', caps: TEXTY },

  /* composer */
  { id: 'composerWrap', label: tk('Composer area'), cat: 'composer', sel: '.composer-wrap', parent: 'main', caps: ALL, orders: true },
  { id: 'composer', label: tk('Chat input'), cat: 'composer', sel: '.composer', parent: 'composerWrap', caps: ALL },
  { id: 'composerText', label: tk('Input text'), cat: 'composer', sel: '.composer textarea', parent: 'composer', caps: TEXTY, content: [{ key: 'placeholder', label: tk('Placeholder'), type: 'text' }] },
  { id: 'composerBar', label: tk('Composer toolbar'), cat: 'composer', sel: '.composer-bar', parent: 'composer', caps: ALL, orders: true },
  { id: 'composerLeft', label: tk('Toolbar left'), cat: 'composer', sel: '.composer-left', parent: 'composerBar', caps: ALL, orders: true },
  { id: 'plusBtn', label: tk('Attachment button'), cat: 'composer', sel: '.plus', parent: 'composerLeft', caps: CTRL, icon: true },
  { id: 'sendBtn', label: tk('Send button'), cat: 'composer', sel: '.send', parent: 'composerBar', caps: CTRL, icon: true },
  { id: 'micBtn', label: tk('Dictation button'), cat: 'composer', sel: '.mic', parent: 'composerBar', caps: CTRL, icon: true },
  { id: 'modelTrigger', label: tk('Model selector'), cat: 'composer', sel: '.model-trigger', parent: 'composerBar', caps: CTRL },
  { id: 'attachRow', label: tk('Attachments'), cat: 'composer', sel: '.attach-row', parent: 'composer', caps: ALL },
  { id: 'attachChip', label: tk('Attachment chip'), cat: 'composer', sel: '.attach-chip', parent: 'attachRow', caps: BOX },
  { id: 'composerChips', label: tk('Composer chips'), cat: 'composer', sel: '.composer-chips', parent: 'composer', caps: ALL },
  { id: 'queuedChip', label: tk('Queued message chip'), cat: 'composer', sel: '.queued-chip', parent: 'composer', caps: BOX.concat(['type']) },
  { id: 'slashMenu', label: tk('Slash command menu'), cat: 'composer', sel: '.slash-menu', parent: 'composer', caps: ALL },
  { id: 'slashItem', label: tk('Slash command'), cat: 'composer', sel: '.slash-item', parent: 'slashMenu', caps: CTRL },
  { id: 'attachFile', label: tk('Attachment card'), cat: 'composer', sel: '.attach-file', parent: 'attachChip', caps: ALL },
  { id: 'attachX', label: tk('Remove attachment'), cat: 'composer', sel: '.attach-x', parent: 'attachChip', caps: CTRL, icon: true },
  { id: 'steerChip', label: tk('Steering chip'), cat: 'composer', sel: '.steer-chip', parent: 'composer', caps: BOX.concat(['type']) },
  { id: 'disclaimer', label: tk('Footer line'), cat: 'composer', sel: '.disclaimer', parent: 'composerWrap', caps: TEXTY },

  /* conversation */
  { id: 'thread', label: tk('Message list'), cat: 'thread', sel: '.thread', parent: 'main', caps: ALL },
  { id: 'message', label: tk('Message'), cat: 'thread', sel: '.msg', parent: 'thread', caps: ALL },
  { id: 'assistantBody', label: tk('Assistant message'), cat: 'thread', sel: '.assistant-body', parent: 'message', caps: ALL },
  { id: 'userBubble', label: tk('Your message bubble'), cat: 'thread', sel: '.bubble-user', parent: 'message', caps: ALL },
  { id: 'userBubbleText', label: tk('Your message text'), cat: 'thread', sel: '.bubble-user-text', parent: 'userBubble', caps: TEXTY },
  { id: 'msgAvatar', label: tk('Assistant avatar'), cat: 'thread', sel: '.msg-icon', parent: 'message', caps: BOX },
  { id: 'msgActions', label: tk('Message actions'), cat: 'thread', sel: '.actions', parent: 'message', caps: ALL, orders: true },
  { id: 'actionBtn', label: tk('Message action button'), cat: 'thread', sel: '.action-btn', parent: 'msgActions', caps: CTRL, icon: true },
  { id: 'msgTime', label: tk('Message timestamp'), cat: 'thread', sel: '.msg-time', parent: 'message', caps: TEXTY },
  { id: 'msgModelBadge', label: tk('Model badge'), cat: 'thread', sel: '.msg-model-badge', parent: 'message', caps: BOX.concat(['type']) },
  { id: 'codeWrap', label: tk('Code block'), cat: 'thread', sel: '.code-wrap', parent: 'assistantBody', caps: ALL },
  { id: 'codeBar', label: tk('Code block header'), cat: 'thread', sel: '.code-bar', parent: 'codeWrap', caps: ALL },
  { id: 'reasoning', label: tk('Reasoning block'), cat: 'thread', sel: '.reasoning', parent: 'message', caps: ALL },
  { id: 'toolLine', label: tk('Tool call'), cat: 'thread', sel: '.tool-line', parent: 'message', caps: ALL },
  { id: 'userCol', label: tk('Your message column'), cat: 'thread', sel: '.user-col', parent: 'message', caps: ALL },
  { id: 'streamText', label: tk('Streaming text'), cat: 'thread', sel: '.stream-text', parent: 'assistantBody', caps: TEXTY },
  { id: 'msgSpeed', label: tk('Speed chip'), cat: 'thread', sel: '.msg-speed', parent: 'message', caps: BOX.concat(['type']) },
  { id: 'branchNav', label: tk('Branch switcher'), cat: 'thread', sel: '.branch-nav', parent: 'message', caps: ALL },
  { id: 'editBox', label: tk('Message edit box'), cat: 'thread', sel: '.edit-box', parent: 'message', caps: ALL },
  { id: 'editActions', label: tk('Message edit buttons'), cat: 'thread', sel: '.edit-actions', parent: 'message', caps: ALL },
  { id: 'toolBash', label: tk('Terminal card'), cat: 'thread', sel: '.tool-bash', parent: 'toolLine', caps: ALL },
  { id: 'toolVerb', label: tk('Tool verb'), cat: 'thread', sel: '.tl-verb', parent: 'toolLine', caps: TEXTY },
  { id: 'toolPath', label: tk('Tool path'), cat: 'thread', sel: '.tl-path', parent: 'toolLine', caps: TEXTY },
  { id: 'reasonStep', label: tk('Reasoning step'), cat: 'thread', sel: '.rb-step', parent: 'reasoning', caps: ALL },
  { id: 'queueWait', label: tk('Queue notice'), cat: 'thread', sel: '.queue-wait', parent: 'thread', caps: ALL },
  { id: 'chatError', label: tk('Chat error'), cat: 'thread', sel: '.chat-error', parent: 'thread', caps: ALL },
  { id: 'compactingBar', label: tk('Compacting bar'), cat: 'thread', sel: '.compacting-bar', parent: 'thread', caps: ALL },
  { id: 'threadSkel', label: tk('Loading conversation'), cat: 'thread', sel: '.thread-skel', parent: 'thread', caps: ALL },
  { id: 'threadRail', label: tk('Thread rail'), cat: 'thread', sel: '.trail', parent: 'main', caps: ALL },
  { id: 'threadRailTick', label: tk('Thread rail marker'), cat: 'thread', sel: '.trail-tick', parent: 'threadRail', caps: BOX },
  { id: 'threadFind', label: tk('Find in conversation'), cat: 'thread', sel: '.thread-find', parent: 'main', caps: ALL },
  { id: 'ledgerBar', label: tk('Context ledger'), cat: 'thread', sel: '.ledger-head', parent: 'thread', caps: ALL },
  { id: 'proseP', label: tk('Paragraph'), cat: 'thread', sel: '.assistant-body p', parent: 'assistantBody', caps: TEXTY },
  { id: 'proseH1', label: tk('Heading 1'), cat: 'thread', sel: '.assistant-body h1', parent: 'assistantBody', caps: TEXTY },
  { id: 'proseH2', label: tk('Heading 2 and below'), cat: 'thread', sel: '.assistant-body h2, .assistant-body h3, .assistant-body h4', parent: 'assistantBody', caps: TEXTY },
  { id: 'proseList', label: tk('List'), cat: 'thread', sel: '.assistant-body ul, .assistant-body ol', parent: 'assistantBody', caps: ALL },
  { id: 'proseItem', label: tk('List item'), cat: 'thread', sel: '.assistant-body li', parent: 'proseList', caps: TEXTY },
  { id: 'proseLink', label: tk('Link'), cat: 'thread', sel: '.assistant-body a', parent: 'assistantBody', caps: TEXTY.concat(['states']) },
  { id: 'proseCode', label: tk('Inline code'), cat: 'thread', sel: '.assistant-body code:not(pre code)', parent: 'assistantBody', caps: BOX.concat(['type']) },
  { id: 'proseQuote', label: tk('Quote'), cat: 'thread', sel: '.assistant-body blockquote', parent: 'assistantBody', caps: ALL },
  { id: 'proseRule', label: tk('Divider line'), cat: 'thread', sel: '.assistant-body hr', parent: 'assistantBody', caps: BOX },
  { id: 'proseTable', label: tk('Table'), cat: 'thread', sel: '.assistant-body table', parent: 'assistantBody', caps: ALL },
  { id: 'proseTh', label: tk('Table header cell'), cat: 'thread', sel: '.assistant-body table th', parent: 'proseTable', caps: BOX.concat(['type']) },
  { id: 'proseTd', label: tk('Table cell'), cat: 'thread', sel: '.assistant-body table td', parent: 'proseTable', caps: BOX.concat(['type']) },
  { id: 'codeArea', label: tk('Code text'), cat: 'thread', sel: '.code-wrap pre', parent: 'codeWrap', caps: TEXTY },
  { id: 'codeCopy', label: tk('Copy code button'), cat: 'thread', sel: '.code-copy', parent: 'codeWrap', caps: CTRL },
  { id: 'reasoningHead', label: tk('Reasoning header'), cat: 'thread', sel: '.reasoning-head', parent: 'reasoning', caps: CTRL },
  { id: 'toolChip', label: tk('Tool chip'), cat: 'thread', sel: '.tool-chip', parent: 'toolLine', caps: CTRL },
  { id: 'bubbleToggle', label: tk('Show more button'), cat: 'thread', sel: '.bubble-toggle', parent: 'userBubble', caps: CTRL },
  { id: 'msgAttachments', label: tk('Message attachments'), cat: 'thread', sel: '.msg-attachments', parent: 'message', caps: ALL },
  { id: 'msgAttachment', label: tk('Attached file'), cat: 'thread', sel: '.att', parent: 'msgAttachments', caps: CTRL },
  { id: 'pinTag', label: tk('Pinned tag'), cat: 'thread', sel: '.pin-tag', parent: 'message', caps: BOX.concat(['type']) },
  { id: 'toBottom', label: tk('Scroll to bottom'), cat: 'thread', sel: '.to-bottom', parent: 'main', caps: CTRL, icon: true },

  /* menus and overlays */
  { id: 'menu', label: tk('Menu'), cat: 'chrome', sel: '.popover, .plus-menu, .chat-menu, .more-menu, .model-menu, .rl-menu, .retry-menu, .art-menu, .pj-menu, .sk-menu, .qp-iconmenu, .spc-mention-menu', caps: ALL },
  { id: 'menuItem', label: tk('Menu item'), cat: 'chrome', sel: '.popover button, .pm-item, .chat-menu button, .model-opt, .art-menu-item', parent: 'menu', caps: CTRL },
  { id: 'menuLabel', label: tk('Menu section label'), cat: 'chrome', sel: '.pm-label, .art-menu-label, .retry-menu-label, .style-menu-label', parent: 'menu', caps: TEXTY },
  { id: 'menuHead', label: tk('Menu header'), cat: 'chrome', sel: '.pm-head, .rl-menu-head', parent: 'menu', caps: ALL },
  { id: 'menuShortcut', label: tk('Menu shortcut'), cat: 'chrome', sel: '.pm-shortcut', parent: 'menuItem', caps: BOX.concat(['type']) },
  { id: 'menuDivider', label: tk('Menu divider'), cat: 'chrome', sel: '.pm-divider, .popover hr', parent: 'menu', caps: BOX },
  { id: 'menuAccount', label: tk('Menu account line'), cat: 'chrome', sel: '.pm-account', parent: 'menu', caps: TEXTY },
  { id: 'chordHint', label: tk('Chord hint'), cat: 'chrome', sel: '.chord-hint', caps: ALL },
  { id: 'submenu', label: tk('Submenu'), cat: 'chrome', sel: '.model-submenu, .cm-sublist, .pm-subwrap', parent: 'menu', caps: ALL },
  { id: 'modelCard', label: tk('Model card'), cat: 'chrome', sel: '.model-card', parent: 'menu', caps: ALL },
  { id: 'modal', label: tk('Window'), cat: 'chrome', sel: '.modal', caps: ALL },
  { id: 'modalSide', label: tk('Window sidebar'), cat: 'chrome', sel: '.modal-side', parent: 'modal', caps: ALL },
  { id: 'modalTab', label: tk('Window tab'), cat: 'chrome', sel: '.modal-tab', parent: 'modalSide', caps: CTRL },
  { id: 'modalMain', label: tk('Window body'), cat: 'chrome', sel: '.modal-main', parent: 'modal', caps: ALL },
  { id: 'modalClose', label: tk('Window close button'), cat: 'chrome', sel: '.modal-close', parent: 'modal', caps: CTRL, icon: true },
  { id: 'secBlock', label: tk('Settings section'), cat: 'chrome', sel: '.sec-block', parent: 'modalMain', caps: ALL },
  { id: 'secNote', label: tk('Settings section note'), cat: 'chrome', sel: '.sec-note', parent: 'secBlock', caps: TEXTY },
  { id: 'setRow', label: tk('Settings row'), cat: 'chrome', sel: '.set-row', parent: 'secBlock', caps: ALL },
  { id: 'setRowTitle', label: tk('Settings row title'), cat: 'chrome', sel: '.set-row-title', parent: 'setRow', caps: TEXTY },
  { id: 'setRowDesc', label: tk('Settings row description'), cat: 'chrome', sel: '.set-row-desc', parent: 'setRow', caps: TEXTY },
  { id: 'setSelect', label: tk('Dropdown'), cat: 'chrome', sel: '.set-select-trigger', parent: 'setRow', caps: CTRL },
  { id: 'setSelectMenu', label: tk('Dropdown menu'), cat: 'chrome', sel: '.set-select-menu', parent: 'setSelect', caps: ALL },
  { id: 'setSelectOpt', label: tk('Dropdown option'), cat: 'chrome', sel: '.set-select-opt', parent: 'setSelectMenu', caps: CTRL },
  { id: 'segsCtrl', label: tk('Segmented control'), cat: 'chrome', sel: '.segs', parent: 'setRow', caps: ALL },
  { id: 'segsOpt', label: tk('Segmented option'), cat: 'chrome', sel: '.segs-opt', parent: 'segsCtrl', caps: CTRL },
  { id: 'overlay', label: tk('Overlay scrim'), cat: 'chrome', sel: '.overlay', caps: ['color', 'effects', 'motion'] },
  { id: 'tip', label: tk('Tooltip'), cat: 'chrome', sel: '.tip', caps: BOX.concat(['type']) },
  { id: 'cmdk', label: tk('Command palette'), cat: 'chrome', sel: '.cmdk', caps: ALL },
  { id: 'cmdkInput', label: tk('Palette search field'), cat: 'chrome', sel: '.cmdk-input', parent: 'cmdk', caps: CTRL },
  { id: 'cmdkList', label: tk('Palette results'), cat: 'chrome', sel: '.cmdk-list', parent: 'cmdk', caps: ALL },
  { id: 'cmdkItem', label: tk('Palette result'), cat: 'chrome', sel: '.cmdk-item', parent: 'cmdkList', caps: CTRL },
  { id: 'cmdkLabel', label: tk('Palette group label'), cat: 'chrome', sel: '.cmdk-label', parent: 'cmdkList', caps: TEXTY },
  { id: 'cmdkShortcut', label: tk('Palette shortcut'), cat: 'chrome', sel: '.cmdk-shortcut', parent: 'cmdkItem', caps: BOX.concat(['type']) },
  { id: 'login', label: tk('Sign-in screen'), cat: 'chrome', sel: '.login', caps: ALL },
  { id: 'loginCard', label: tk('Sign-in card'), cat: 'chrome', sel: '.login-card', parent: 'login', caps: ALL },
  { id: 'loginLogo', label: tk('Sign-in logo'), cat: 'chrome', sel: '.login-logo', parent: 'loginCard', caps: BOX },
  { id: 'loginTabs', label: tk('Sign-in tabs'), cat: 'chrome', sel: '.login-tabs', parent: 'loginCard', caps: ALL },
  { id: 'searchModal', label: tk('Search window'), cat: 'chrome', sel: '.search-modal', caps: ALL },
  { id: 'searchRow', label: tk('Search result'), cat: 'chrome', sel: '.search-row', parent: 'searchModal', caps: CTRL },
  { id: 'searchTitle', label: tk('Search result title'), cat: 'chrome', sel: '.search-title', parent: 'searchRow', caps: TEXTY },
  { id: 'searchSnippet', label: tk('Search result snippet'), cat: 'chrome', sel: '.search-snippet', parent: 'searchRow', caps: TEXTY },
  { id: 'shortcutsModal', label: tk('Shortcuts window'), cat: 'chrome', sel: '.shortcuts-modal', caps: ALL },
  { id: 'shortcutItem', label: tk('Shortcut row'), cat: 'chrome', sel: '.sc-item', parent: 'shortcutsModal', caps: ALL },
  { id: 'shortcutGroup', label: tk('Shortcut group title'), cat: 'chrome', sel: '.sc-group-title', parent: 'shortcutsModal', caps: TEXTY },
  { id: 'lightbox', label: tk('Image viewer'), cat: 'chrome', sel: '.lightbox', caps: ALL },

  { id: 'artPane', label: tk('Artifacts panel'), cat: 'panels', sel: '.art-pane', caps: ALL },
  { id: 'artHead', label: tk('Artifacts header'), cat: 'panels', sel: '.art-head', parent: 'artPane', caps: ALL },
  { id: 'artToolbar', label: tk('Artifacts toolbar'), cat: 'panels', sel: '.art-toolbar', parent: 'artPane', caps: ALL },
  { id: 'artTabs', label: tk('Artifact tabs'), cat: 'panels', sel: '.art-tabs', parent: 'artPane', caps: ALL },
  { id: 'artTab', label: tk('Artifact tab'), cat: 'panels', sel: '.art-tab', parent: 'artTabs', caps: CTRL },
  { id: 'artTree', label: tk('Artifact file tree'), cat: 'panels', sel: '.art-tree', parent: 'artPane', caps: ALL },
  { id: 'artCard', label: tk('Artifact card'), cat: 'panels', sel: '.art-card', parent: 'artPane', caps: ALL },
  { id: 'artViewer', label: tk('Artifact viewer'), cat: 'panels', sel: '.art-viewer', parent: 'artPane', caps: ALL },
  { id: 'artCode', label: tk('Artifact code'), cat: 'panels', sel: '.art-code, .code-area', parent: 'artViewer', caps: TEXTY },
  { id: 'projects', label: tk('Projects page'), cat: 'panels', sel: '.pj-overview', caps: ALL },
  { id: 'projectCard', label: tk('Project card'), cat: 'panels', sel: '.pj-card', parent: 'projects', caps: ALL },
  { id: 'projectDetail', label: tk('Project page'), cat: 'panels', sel: '.pj-detail', caps: ALL },
  { id: 'projectChatRow', label: tk('Project chat row'), cat: 'panels', sel: '.pj-chat-row', parent: 'projectDetail', caps: CTRL },
  { id: 'projectFileRow', label: tk('Project file row'), cat: 'panels', sel: '.pj-file-row', parent: 'projectDetail', caps: CTRL },
  { id: 'chatsOverview', label: tk('All chats page'), cat: 'panels', sel: '.chats-overview', caps: ALL },
  { id: 'chatsOverviewCard', label: tk('All chats card'), cat: 'panels', sel: '.co-card', parent: 'chatsOverview', caps: ALL },
  { id: 'modelDocs', label: tk('Model docs page'), cat: 'panels', sel: '.mdoc', caps: ALL },
  { id: 'modelDocsHead', label: tk('Model docs header'), cat: 'panels', sel: '.mdoc-head', parent: 'modelDocs', caps: ALL },
  { id: 'modelDocsRow', label: tk('Model docs row'), cat: 'panels', sel: '.mdoc-row', parent: 'modelDocs', caps: CTRL },
  { id: 'modelDocsCard', label: tk('Model docs card'), cat: 'panels', sel: '.mdoc-feat-card, .mdoc-price-card', parent: 'modelDocs', caps: ALL },
  { id: 'spaceChat', label: tk('Space conversation'), cat: 'panels', sel: '.spc-chat', caps: ALL },
  { id: 'spaceMsg', label: tk('Space message'), cat: 'panels', sel: '.spc-msg', parent: 'spaceChat', caps: ALL },
  { id: 'spaceMember', label: tk('Space member row'), cat: 'panels', sel: '.spc-member-row', caps: ALL },
  { id: 'branchTree', label: tk('Branch map'), cat: 'panels', sel: '.bt-modal', caps: ALL },
  { id: 'branchNode', label: tk('Branch node'), cat: 'panels', sel: '.bt-node', parent: 'branchTree', caps: CTRL },
  { id: 'callPanel', label: tk('Voice panel'), cat: 'panels', sel: '.callpanel', caps: ALL },
  { id: 'callOrb', label: tk('Voice orb'), cat: 'panels', sel: '.call-orb', parent: 'callPanel', caps: BOX },
  { id: 'ctxInspect', label: tk('Context inspector'), cat: 'panels', sel: '.ctx-inspect', caps: ALL },
  { id: 'chatCtl', label: tk('Chat controls panel'), cat: 'panels', sel: '.chatctl-panel', caps: ALL },
  /* controls */
  { id: 'button', label: tk('Button'), cat: 'controls', sel: '.btn', caps: CTRL },
  { id: 'iconBtn', label: tk('Icon button'), cat: 'controls', sel: '.icon-btn', caps: CTRL, icon: true },
  { id: 'input', label: tk('Text field'), cat: 'controls', sel: '.set-input, .cp-input', caps: CTRL },
  { id: 'switchCtrl', label: tk('Toggle switch'), cat: 'controls', sel: '.switch', caps: BOX },
  { id: 'badge', label: tk('Badge'), cat: 'controls', sel: '.badge', caps: BOX.concat(['type']) },
  { id: 'chip', label: tk('Chip'), cat: 'controls', sel: '.chip', caps: BOX.concat(['type']) },
  { id: 'avatarCtrl', label: tk('Avatar'), cat: 'controls', sel: '.avatar', caps: BOX.concat(['type']) },
  { id: 'field', label: tk('Labelled field'), cat: 'controls', sel: '.field', caps: ALL },
  { id: 'btnRow', label: tk('Button row'), cat: 'controls', sel: '.btn-row', caps: ALL },

  /* feedback */
  { id: 'toast', label: tk('Notification'), cat: 'feedback', sel: '.toast', caps: ALL },
  { id: 'toaster', label: tk('Notification stack'), cat: 'feedback', sel: '.toaster', caps: ['layout', 'spacing', 'responsive'] },
  { id: 'toastMsg', label: tk('Notification text'), cat: 'feedback', sel: '.toast-msg', parent: 'toast', caps: TEXTY },
  { id: 'toastIcon', label: tk('Notification icon'), cat: 'feedback', sel: '.toast-ico', parent: 'toast', caps: BOX },
  { id: 'skeleton', label: tk('Loading skeleton'), cat: 'feedback', sel: '.skeleton', caps: BOX },
  { id: 'ctxGauge', label: tk('Context gauge'), cat: 'feedback', sel: '.ctx-gauge', caps: BOX },
  { id: 'engineStrip', label: tk('Engine telemetry'), cat: 'feedback', sel: '.engine-strip', caps: ALL },
  { id: 'unavailBanner', label: tk('Warning banner'), cat: 'feedback', sel: '.unavail-banner', caps: ALL }
];

export const ELEMENT_INDEX = (() => {
  const m = new Map();
  for (const el of ELEMENTS) m.set(el.id, el);
  return m;
})();

export function elementsByCategory() {
  return CATEGORIES.map(c => ({ ...c, items: ELEMENTS.filter(e => e.cat === c.id) })).filter(c => c.items.length);
}

// The tree is built from the parent links rather than from the DOM, so it reads
// the same whether or not a branch happens to be on screen right now.
export function elementTree() {
  const kids = new Map();
  for (const el of ELEMENTS) {
    const p = el.parent && ELEMENT_INDEX.has(el.parent) ? el.parent : '';
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(el);
  }
  const build = (id) => (kids.get(id) || []).map(el => ({ ...el, children: build(el.id) }));
  return build('');
}

/* ---------------------------------------------------------------------------
   Editable content

   Text the builder can replace. Each key is read through useThemeText() at the
   one place it renders, so a rename never has to touch a translation pack.
--------------------------------------------------------------------------- */

export const CONTENT_KEYS = [
  { key: 'nav.new', label: tk('New chat label'), group: tk('Navigation'), def: 'New' },
  { key: 'nav.projects', label: tk('Projects label'), group: tk('Navigation'), def: 'Projects' },
  { key: 'nav.artifacts', label: tk('Artifacts label'), group: tk('Navigation'), def: 'Artifacts' },
  { key: 'nav.scheduled', label: tk('Scheduled label'), group: tk('Navigation'), def: 'Scheduled' },
  { key: 'nav.customize', label: tk('Customize label'), group: tk('Navigation'), def: 'Customize' },
  { key: 'nav.recents', label: tk('Recents heading'), group: tk('Navigation'), def: 'Recents' },
  { key: 'nav.allChats', label: tk('All chats label'), group: tk('Navigation'), def: 'All chats' },
  { key: 'composer.placeholder', label: tk('Composer placeholder'), group: tk('Composer'), def: 'How can I help you today?' },
  { key: 'empty.chats', label: tk('Empty chat list'), group: tk('Empty states'), def: 'No chats yet' }
];

export const CONTENT_INDEX = (() => {
  const m = new Map();
  for (const c of CONTENT_KEYS) m.set(c.key, c);
  return m;
})();

/* ---------------------------------------------------------------------------
   Placeholders

   The builder never receives real user data. It composes strings out of these
   tokens and the app substitutes them at render, so a layout designed against
   one account renders correctly for everybody.
--------------------------------------------------------------------------- */

export const PLACEHOLDERS = [
  { token: '{{user.name}}', label: tk('User name') },
  { token: '{{user.email}}', label: tk('User email') },
  { token: '{{workspace.name}}', label: tk('Workspace name') },
  { token: '{{conversation.title}}', label: tk('Conversation title') },
  { token: '{{model.name}}', label: tk('Model name') },
  { token: '{{currentDate}}', label: tk('Current date') },
  { token: '{{currentTime}}', label: tk('Current time') },
  { token: '{{version}}', label: tk('App version') }
];

export function fillPlaceholders(text, vars) {
  if (typeof text !== 'string' || text.indexOf('{{') === -1) return text;
  return text.replace(/\{\{\s*([a-zA-Z.]+)\s*\}\}/g, (m, key) => {
    const v = vars?.[key];
    return v == null ? m : String(v);
  });
}

/* ---------------------------------------------------------------------------
   Insertable elements

   A slot is a place the app agrees to render extra nodes. Keeping the list of
   slots short and explicit is what stops the builder from being able to inject
   markup into somewhere that would break behaviour.
--------------------------------------------------------------------------- */

export const SLOTS = [
  { id: 'sidebar.top', label: tk('Sidebar, above navigation') },
  { id: 'sidebar.bottom', label: tk('Sidebar, below chat list') },
  { id: 'home.above', label: tk('New chat screen, above greeting') },
  { id: 'home.below', label: tk('New chat screen, below prompts') },
  { id: 'composer.above', label: tk('Above the composer') },
  { id: 'main.top', label: tk('Top of the content area') }
];

export const NODE_TYPES = [
  { type: 'heading', label: tk('Heading'), cat: 'content', props: [{ key: 'text', label: tk('Text'), type: 'text', def: 'Heading' }] },
  { type: 'text', label: tk('Text'), cat: 'content', props: [{ key: 'text', label: tk('Text'), type: 'textarea', def: 'Some text' }] },
  { type: 'badge', label: tk('Badge'), cat: 'content', props: [{ key: 'text', label: tk('Text'), type: 'text', def: 'New' }] },
  { type: 'image', label: tk('Image'), cat: 'content', props: [{ key: 'src', label: tk('Image URL'), type: 'text', def: '' }, { key: 'alt', label: tk('Alt text'), type: 'text', def: '' }] },
  { type: 'divider', label: tk('Divider'), cat: 'layout', props: [] },
  { type: 'spacer', label: tk('Spacer'), cat: 'layout', props: [{ key: 'size', label: tk('Height'), type: 'text', def: '16px' }] },
  { type: 'container', label: tk('Container'), cat: 'layout', props: [{ key: 'text', label: tk('Text'), type: 'text', def: '' }] },
  { type: 'link', label: tk('Link'), cat: 'controls', props: [{ key: 'text', label: tk('Label'), type: 'text', def: 'Link' }, { key: 'href', label: tk('URL'), type: 'text', def: '' }] },
  { type: 'note', label: tk('Callout'), cat: 'feedback', props: [{ key: 'text', label: tk('Text'), type: 'textarea', def: 'A note for everyone on this workspace.' }] }
];

export const NODE_INDEX = (() => {
  const m = new Map();
  for (const n of NODE_TYPES) m.set(n.type, n);
  return m;
})();

/* ---------------------------------------------------------------------------
   Documents
--------------------------------------------------------------------------- */

export function emptyDoc(basePreset = 'anthropic') {
  return { v: THEME_SCHEMA, basePreset: basePreset === 'openai' ? 'openai' : 'anthropic', tokens: {}, content: {}, elements: {}, slots: {}, css: '' };
}

// Older documents keep working: an unknown key is left alone and a missing one
// is filled, so adding builder features never invalidates a saved theme.
export function migrateDoc(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  return {
    ...d,
    v: THEME_SCHEMA,
    basePreset: d.basePreset === 'openai' ? 'openai' : 'anthropic',
    tokens: d.tokens && typeof d.tokens === 'object' ? d.tokens : {},
    content: d.content && typeof d.content === 'object' ? d.content : {},
    elements: d.elements && typeof d.elements === 'object' ? d.elements : {},
    slots: d.slots && typeof d.slots === 'object' ? d.slots : {},
    css: typeof d.css === 'string' ? d.css : ''
  };
}

export function elementConfig(doc, id) {
  return (doc?.elements && doc.elements[id]) || null;
}

export function docIsEmpty(doc) {
  if (!doc) return true;
  return !Object.keys(doc.elements || {}).length
    && !Object.keys(doc.content || {}).length
    && !Object.keys(doc.slots || {}).length
    && !Object.values(doc.tokens || {}).some(g => Object.keys(g || {}).length)
    && !(doc.css || '').trim();
}

/* ---------------------------------------------------------------------------
   Reorderable groups

   Dragging writes an `order` number, and the container is already a flex box, so
   the running app rearranges itself without the React tree being touched. A
   child is addressed structurally where the markup allows it, and by an explicit
   data-oq-item where several siblings share one class.
--------------------------------------------------------------------------- */

export const ORDER_GROUPS = [
  {
    id: 'sidebarNav', container: '.sidebar > .nav', label: tk('Primary navigation'),
    items: [
      { id: 'nav.new', label: tk('New chat'), sel: '.sidebar > .nav > .new-row' },
      { id: 'nav.projects', label: tk('Projects'), sel: '[data-oq-item="nav.projects"]' },
      { id: 'nav.artifacts', label: tk('Artifacts'), sel: '[data-oq-item="nav.artifacts"]' },
      { id: 'nav.scheduled', label: tk('Scheduled'), sel: '[data-oq-item="nav.scheduled"]' },
      { id: 'nav.customize', label: tk('Customize'), sel: '[data-oq-item="nav.customize"]' }
    ]
  },
  {
    id: 'sidebar', container: '.sidebar', label: tk('Sidebar sections'),
    items: [
      { id: 'sb.head', label: tk('Header'), sel: '.sidebar > .sidebar-head' },
      { id: 'sb.nav', label: tk('Navigation'), sel: '.sidebar > .nav' },
      { id: 'sb.chats', label: tk('Chat list'), sel: '.sidebar > .chats-wrap' },
      { id: 'sb.foot', label: tk('Footer navigation'), sel: '.sidebar > .side-foot-nav' },
      { id: 'sb.profile', label: tk('Profile'), sel: '.sidebar > .profile' }
    ]
  },
  {
    id: 'centerWrap', container: '.center-wrap', label: tk('New chat screen'),
    items: [
      { id: 'home.greeting', label: tk('Greeting'), sel: '.center-wrap > .greeting' },
      { id: 'home.composer', label: tk('Composer'), sel: '.center-wrap > .composer-wrap' },
      { id: 'home.prompts', label: tk('Starter prompts'), sel: '.center-wrap > .quick-prompts' }
    ]
  },
  {
    id: 'composerBar', container: '.composer-bar', label: tk('Composer toolbar'),
    items: [
      { id: 'cb.left', label: tk('Left group'), sel: '.composer-bar > .composer-left' },
      { id: 'cb.right', label: tk('Right group'), sel: '.composer-bar > .composer-right' }
    ]
  },
  {
    id: 'composerRight', container: '.composer-right', label: tk('Composer actions'),
    items: [
      { id: 'cr.gauge', label: tk('Context gauge'), sel: '.composer-right > .ctx-gauge' },
      { id: 'cr.model', label: tk('Model selector'), sel: '.composer-right > .model-select' },
      { id: 'cr.mic', label: tk('Dictation'), sel: '.composer-right > .mic' },
      { id: 'cr.send', label: tk('Send'), sel: '.composer-right > .send' }
    ]
  },
  {
    id: 'sidebarHead', container: '.sidebar-head', label: tk('Sidebar header'),
    items: [
      { id: 'sh.brand', label: tk('Workspace name'), sel: '.sidebar-head > .brand-wrap' },
      { id: 'sh.actions', label: tk('Buttons'), sel: '.sidebar-head > .sidebar-head-actions' }
    ]
  }
];

export const ORDER_INDEX = (() => {
  const m = new Map();
  for (const g of ORDER_GROUPS) m.set(g.id, g);
  return m;
})();

export function orderItemSel(id) {
  for (const g of ORDER_GROUPS) {
    const hit = g.items.find(i => i.id === id);
    if (hit) return hit.sel;
  }
  return '';
}
