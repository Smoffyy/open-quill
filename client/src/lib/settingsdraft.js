import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from './api.js';
import { applyPrefs, currentPreset } from './prefs.js';
import { initialPrefs, presetDefaults, shownThemeFallback } from './settingsdefaults.js';
import { toast } from './toast.js';
import { t } from '../i18n.jsx';

const TYPING_SAVE_MS = 450;
const DRAGGED_PREFS = new Set(['cursorBlinkMs', 'cursorPulseMs', 'revealMs']);

export function useSettingsDraft(user, onUpdated) {
  const [name, setName] = useState(user.displayName);
  const [instructions, setInstructions] = useState(user.instructions || '');
  const [prefs, setPrefs] = useState(() => initialPrefs(user.prefs, currentPreset() === 'openai'));

  const nameRef = useRef(name);
  const instrRef = useRef(instructions);
  const prefsRef = useRef(prefs);
  const updatedRef = useRef(onUpdated);
  nameRef.current = name;
  prefsRef.current = prefs;
  updatedRef.current = onUpdated;

  const timer = useRef(null);
  const pending = useRef(false);
  const saving = useRef(false);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!pending.current || saving.current) return;
    pending.current = false;
    saving.current = true;
    try {
      const { user: u } = await api.patch('/api/me', {
        displayName: nameRef.current, prefs: prefsRef.current, instructions: instrRef.current
      });
      updatedRef.current?.(u);
    } catch {
      toast(t('Could not save these changes.'), { icon: 'info', kind: 'warn' });
    }
    saving.current = false;
    if (pending.current) flush();
  }, []);

  const schedule = useCallback((delay = TYPING_SAVE_MS) => {
    if (timer.current) clearTimeout(timer.current);
    pending.current = true;
    timer.current = setTimeout(flush, delay);
  }, [flush]);

  useEffect(() => () => { flush(); }, [flush]);

  const changeName = useCallback((v) => { setName(v); nameRef.current = v; schedule(); }, [schedule]);
  const changeInstructions = useCallback((v) => { setInstructions(v); instrRef.current = v; schedule(); }, [schedule]);

  const mounted = useRef(false);
  const lastPref = useRef('');
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    applyPrefs(prefs);
    schedule(DRAGGED_PREFS.has(lastPref.current) ? TYPING_SAVE_MS : 0);
  }, [prefs, schedule]);

  const setPref = useCallback((k, v) => { lastPref.current = k; setPrefs(p => ({ ...p, [k]: v })); }, []);

  const resetPrefs = useCallback(() => {
    lastPref.current = '';
    const applied = document.documentElement.getAttribute('data-theme');
    setPrefs(presetDefaults(currentPreset() === 'openai', shownThemeFallback(applied)));
  }, []);

  const seen = useRef(user.prefs || {});
  useEffect(() => {
    const incoming = user.prefs || {};
    const before = seen.current;
    seen.current = incoming;
    const same = (a, b) => a === b
      || (!!a && !!b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
    const changed = Object.keys(incoming).filter(k => !same(incoming[k], before[k]));
    if (!changed.length) return;
    setPrefs(p => {
      const add = changed.filter(k => !same(incoming[k], p[k]));
      if (!add.length) return p;
      const next = { ...p };
      for (const k of add) next[k] = incoming[k];
      return next;
    });
  }, [user.prefs]);

  return { name, instructions, prefs, changeName, changeInstructions, setPref, resetPrefs };
}
