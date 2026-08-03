export const KEYBIND_PREF = 'keybinds';
export const LEADER_PREF = 'leaderKey';
export const DEFAULT_LEADER = 'space';
export const CHORD_TIMEOUT = 1600;

export const KEYBIND_ACTIONS = [
  { id: 'commandPalette', group: 'General', label: 'Command palette', def: 'mod+k', typing: true, overlay: true },
  { id: 'searchChats', group: 'General', label: 'Search chats', def: 'mod+shift+f', typing: true, overlay: true },
  { id: 'newChat', group: 'General', label: 'New chat', def: 'mod+shift+o', typing: true, overlay: true },
  { id: 'toggleSidebar', group: 'General', label: 'Toggle sidebar', def: 'mod+shift+s', typing: true, overlay: true },
  { id: 'openSettings', group: 'General', label: 'Open settings', def: 'mod+,', typing: true, overlay: false },
  { id: 'toggleIncognito', group: 'General', label: 'Toggle incognito', def: 'alt+i', typing: true, overlay: false },
  { id: 'toggleTheme', group: 'General', label: 'Switch light / dark', def: 'alt+t', typing: true, overlay: true },
  { id: 'shortcuts', group: 'General', label: 'Shortcuts (this)', def: '?', typing: false, overlay: true },
  { id: 'focusComposer', group: 'Composer', label: 'Focus the message bar', def: '/', typing: false, overlay: false },
  { id: 'attachFiles', group: 'Composer', label: 'Attach files', def: 'mod+u', typing: true, overlay: false },
  { id: 'toggleWebSearch', group: 'Composer', label: 'Toggle web search', def: 'alt+w', typing: true, overlay: false },
  { id: 'toggleSandbox', group: 'Composer', label: 'Toggle sandbox', def: 'alt+s', typing: true, overlay: false },
  { id: 'stopGeneration', group: 'Composer', label: 'Stop generating', def: 'mod+.', typing: true, overlay: false },
  { id: 'findInChat', group: 'In this conversation', label: 'Find in conversation', def: 'mod+f', pref: 'threadFind', typing: true, overlay: true },
  { id: 'branchMap', group: 'In this conversation', label: 'Branch map', def: 'b', pref: 'branchMap', typing: false, overlay: false },
  { id: 'msgNext', group: 'In this conversation', label: 'Next message', def: 'j', pref: 'msgKeys', typing: false, overlay: false },
  { id: 'msgPrev', group: 'In this conversation', label: 'Previous message', def: 'k', pref: 'msgKeys', typing: false, overlay: false },
  { id: 'scrollBottom', group: 'In this conversation', label: 'Jump to latest', def: 'alt+ArrowDown', typing: true, overlay: false },
  { id: 'toggleLedger', group: 'In this conversation', label: 'Context ledger', def: 'alt+l', typing: true, overlay: false },
  { id: 'promptLedger', group: 'In this conversation', label: 'What gets sent', def: 'alt+p', typing: true, overlay: false },
  { id: 'toggleArtifacts', group: 'In this conversation', label: 'Artifacts panel', def: 'alt+a', typing: true, overlay: false },
  { id: 'nextChat', group: 'In this conversation', label: 'Next chat in sidebar', def: 'alt+j', typing: true, overlay: false },
  { id: 'prevChat', group: 'In this conversation', label: 'Previous chat in sidebar', def: 'alt+k', typing: true, overlay: false },
  { id: 'msgCopy', group: 'Focused message', label: 'Copy', def: 'c', pref: 'msgKeys', typing: false, overlay: false },
  { id: 'msgEdit', group: 'Focused message', label: 'Edit (your message)', def: 'e', pref: 'msgKeys', typing: false, overlay: false },
  { id: 'msgRetry', group: 'Focused message', label: 'Retry (assistant)', def: 'r', pref: 'msgKeys', typing: false, overlay: false },
  { id: 'msgFork', group: 'Focused message', label: 'Branch into new chat', def: 'y', pref: 'msgKeys', typing: false, overlay: false },
  { id: 'clearFocus', group: 'Focused message', label: 'Clear focus', def: 'Escape', pref: 'msgKeys', typing: false, overlay: false, fixed: true },
];

export const KEYBIND_BY_ID = KEYBIND_ACTIONS.reduce((m, a) => { m[a.id] = a; return m; }, {});

export const KEYBIND_GROUPS = KEYBIND_ACTIONS.reduce((list, a) => (list.includes(a.group) ? list : list.concat(a.group)), []);

export const KEYBIND_PRESETS = [
  { id: 'default', label: 'Defaults', binds: {} },
  { id: 'vim', label: 'Vim flavoured', binds: {
    focusComposer: 'i',
    findInChat: '/',
    branchMap: 'shift+b',
    msgCopy: 'y',
    msgEdit: 'shift+i',
    msgRetry: 'shift+r',
    msgFork: 'shift+y',
    scrollBottom: 'shift+g',
    nextChat: 'shift+j',
    prevChat: 'shift+k',
  } },
];

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'OS', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'SymbolLock']);
const OPAQUE_KEYS = new Set(['Dead', 'Unidentified', 'Process', 'Compose']);
const FLAG_SET = new Set(['mod', 'alt', 'shift']);

const CODE_KEYS = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Backquote: '`', Comma: ',', Period: '.', Slash: '/',
  Escape: 'Escape', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
};

const KEY_LABELS = {
  escape: 'Esc', enter: 'Enter', tab: 'Tab', space: 'Space', backspace: '⌫', delete: 'Del',
  arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→',
  home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn', insert: 'Ins',
};

const RESERVED = new Set(['mod+w', 'mod+t', 'mod+n', 'mod+q', 'mod+shift+w', 'mod+shift+t', 'mod+shift+n', 'mod+shift+q', 'mod+shift+i', 'mod+shift+j', 'mod+alt+i']);

let macCache = null;
export function isMacPlatform() {
  if (macCache !== null) return macCache;
  if (typeof navigator === 'undefined') return false;
  const p = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '';
  macCache = /mac|iphone|ipad|ipod/i.test(p);
  return macCache;
}

function baseKey(e) {
  const k = e.key;
  const opaque = OPAQUE_KEYS.has(k);
  if (!opaque && typeof k === 'string' && k.length === 1 && /[a-z0-9]/i.test(k)) return k.toLowerCase();
  const code = e.code || '';
  let m = /^Key([A-Z])$/.exec(code);
  if (m) return m[1].toLowerCase();
  m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (m) return m[1];
  if (k === ' ' || code === 'Space') return 'space';
  if (opaque) return CODE_KEYS[code] || '';
  return k;
}

export function comboFromEvent(e) {
  if (!e || !e.key || MODIFIER_KEYS.has(e.key)) return '';
  const key = baseKey(e);
  if (!key || MODIFIER_KEYS.has(key) || OPAQUE_KEYS.has(key)) return '';
  const named = key.length > 1;
  const alnum = key.length === 1 && /[a-z0-9]/.test(key);
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('mod');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey && (named || alnum)) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

export function isChord(combo) {
  return typeof combo === 'string' && combo.includes(' ');
}

export function chordParts(combo) {
  return String(combo || '').split(' ').filter(Boolean);
}

function isValidKey(key) {
  if (typeof key !== 'string' || !key) return false;
  if (key.length === 1) return true;
  return /^[A-Za-z][A-Za-z0-9]*$/.test(key);
}

export function isValidCombo(combo) {
  if (typeof combo !== 'string' || !combo) return false;
  if (combo.includes(' ')) {
    const parts = chordParts(combo);
    return parts.length === 2 && parts.every(p => isValidCombo(p));
  }
  const parts = combo.split('+');
  const key = parts.pop();
  if (!isValidKey(key) || FLAG_SET.has(key) || MODIFIER_KEYS.has(key)) return false;
  const seen = new Set();
  for (const p of parts) {
    if (!FLAG_SET.has(p) || seen.has(p)) return false;
    seen.add(p);
  }
  return true;
}

export function isReservedCombo(combo) {
  return RESERVED.has(String(combo || '').toLowerCase());
}

export function comboKeys(combo) {
  if (!isValidCombo(combo)) return [];
  if (isChord(combo)) return chordParts(combo).flatMap((p, i) => (i ? ['then', ...comboKeys(p)] : comboKeys(p)));
  const mac = isMacPlatform();
  const parts = combo.split('+');
  const key = parts.pop();
  const out = parts.map(p => (p === 'mod' ? (mac ? '⌘' : 'Ctrl') : p === 'alt' ? (mac ? '⌥' : 'Alt') : mac ? '⇧' : 'Shift'));
  const lower = key.toLowerCase();
  out.push(KEY_LABELS[lower] || (key.length === 1 ? key.toUpperCase() : key));
  return out;
}

export function comboLabel(combo) {
  const keys = comboKeys(combo);
  if (!keys.length) return '';
  return keys.join(isMacPlatform() ? '' : '+');
}

export function sanitizeKeybinds(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const a of KEYBIND_ACTIONS) {
    if (a.fixed) continue;
    const v = raw[a.id];
    if (typeof v === 'string' && v !== a.def && isValidCombo(v)) out[a.id] = v;
  }
  return out;
}

export function customKeybinds(prefs) {
  return sanitizeKeybinds(prefs?.[KEYBIND_PREF]);
}

export function resolveKeybinds(prefs) {
  const custom = customKeybinds(prefs);
  const out = {};
  for (const a of KEYBIND_ACTIONS) out[a.id] = custom[a.id] || a.def;
  return out;
}

export function keybindIndex(binds) {
  const index = new Map();
  const prefixes = new Map();
  for (const a of KEYBIND_ACTIONS) {
    const combo = binds[a.id];
    if (!combo) continue;
    if (isChord(combo)) {
      const [head, tail] = chordParts(combo);
      if (!prefixes.has(head)) prefixes.set(head, new Map());
      if (!prefixes.get(head).has(tail)) prefixes.get(head).set(tail, a);
      continue;
    }
    if (!index.has(combo)) index.set(combo, a);
  }
  index.chords = prefixes;
  return index;
}

export function leaderCombo(prefs) {
  const v = prefs?.[LEADER_PREF];
  return typeof v === 'string' && isValidCombo(v) && !isChord(v) ? v : DEFAULT_LEADER;
}

export function chordMenu(binds, head) {
  const out = [];
  for (const a of KEYBIND_ACTIONS) {
    const combo = binds[a.id];
    if (!isChord(combo)) continue;
    const parts = chordParts(combo);
    if (parts[0] !== head) continue;
    out.push({ action: a, key: parts[1] });
  }
  return out;
}

export function keybindConflicts(binds) {
  const seen = new Set();
  const dupes = new Set();
  for (const a of KEYBIND_ACTIONS) {
    const combo = binds[a.id];
    if (!combo) continue;
    if (seen.has(combo)) dupes.add(combo);
    else seen.add(combo);
  }
  return dupes;
}

export function presetBinds(id) {
  const preset = KEYBIND_PRESETS.find(p => p.id === id);
  return preset ? sanitizeKeybinds(preset.binds) : {};
}

export function activePresetId(prefs) {
  const custom = customKeybinds(prefs);
  const keys = Object.keys(custom).sort().join(',');
  for (const p of KEYBIND_PRESETS) {
    const b = sanitizeKeybinds(p.binds);
    if (Object.keys(b).sort().join(',') !== keys) continue;
    if (Object.keys(b).every(k => b[k] === custom[k])) return p.id;
  }
  return '';
}

export function exportKeybinds(prefs) {
  return { kind: 'open-quill-keybinds', version: 1, binds: customKeybinds(prefs) };
}

export function importKeybinds(payload) {
  const raw = payload && typeof payload === 'object'
    ? (payload.binds && typeof payload.binds === 'object' ? payload.binds : payload)
    : null;
  if (!raw) return null;
  return sanitizeKeybinds(raw);
}
