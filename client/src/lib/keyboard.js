import { useEffect } from 'react';
import { CHORD_TIMEOUT, chordMenu, comboFromEvent, keybindIndex, resolveKeybinds } from './keybinds.js';

export function isTypingTarget(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function useKeybinds(user, kbHandlers, setChordHint) {
  useEffect(() => {
    if (!user) return;
    const nav = user.prefs || {};
    const binds = resolveKeybinds(nav);
    const index = keybindIndex(binds);
    let pending = null;
    let pendingTimer = null;
    const enabled = (act) => act && !(act.pref && nav[act.pref] === false);
    const clearPending = () => { pending = null; clearTimeout(pendingTimer); pendingTimer = null; setChordHint(null); };
    const onKey = (e) => {
      const combo = comboFromEvent(e);
      if (!combo) return;
      const typing = isTypingTarget(document.activeElement);
      const overlay = !!document.querySelector('.overlay');
      if (pending) {
        const chord = index.chords.get(pending)?.get(combo);
        clearPending();
        if (enabled(chord)) {
          e.preventDefault();
          kbHandlers.current[chord.id]?.();
          return;
        }
        if (combo === 'Escape') { e.preventDefault(); return; }
      }
      if (!typing && !overlay && index.chords.has(combo)) {
        e.preventDefault();
        pending = combo;
        setChordHint({ head: combo, items: chordMenu(binds, combo) });
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(clearPending, CHORD_TIMEOUT);
        return;
      }
      const act = index.get(combo);
      if (!enabled(act)) return;
      if (!act.typing && typing) return;
      if (!act.overlay && overlay) return;
      if (kbHandlers.current[act.id]?.() !== false) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(pendingTimer);
    };
  }, [user, kbHandlers, setChordHint]);

  // The same actions, reachable without a key press, so anything that already
  // knows a command by name can run it.
  useEffect(() => {
    const run = (e) => { kbHandlers.current[e.detail?.id]?.(); };
    window.addEventListener('oq-command', run);
    return () => window.removeEventListener('oq-command', run);
  }, [kbHandlers]);
}
