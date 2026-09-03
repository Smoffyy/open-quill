import { useCallback, useMemo, useState } from 'react';

// Everything the interface shows about an in-flight turn other than its text:
// generation speed, how big the prompt was, what the backend is busy doing,
// the steers the user has thrown in, and which model a router picked.
//
// These were five useStates in App cleared by hand at five different places, and
// they had drifted: starting a turn cleared all four, switching chats cleared
// three, starting a project chat cleared none. One reset is what stops that.

export const NO_STEERS = Object.freeze([]);

export function useTurnMeta() {
  const [telemetry, setTelemetry] = useState(null);
  const [promptTokens, setPromptTokens] = useState(0);
  const [status, setStatus] = useState(null);
  const [steers, setSteers] = useState(NO_STEERS);
  // Deliberately outside reset(): the server sends `routed` *before* `start`, so
  // clearing it when a turn begins would wipe the routing decision that has just
  // arrived. It belongs to the chat, and is cleared when the chat changes.
  const [route, setRoute] = useState(null);

  const reset = useCallback(() => {
    setTelemetry(null);
    setPromptTokens(0);
    setStatus(null);
    setSteers(NO_STEERS);
  }, []);

  // Picking a turn back up after a reload: the server's snapshot is the truth.
  const restore = useCallback((rec) => {
    setSteers(Array.isArray(rec && rec.steers) && rec.steers.length ? rec.steers : NO_STEERS);
    setStatus((rec && rec.status) || null);
  }, []);

  const addSteers = useCallback((notes) => {
    const list = Array.isArray(notes) ? notes : [notes];
    if (!list.length) return;
    setSteers(prev => [...prev, ...list]);
  }, []);

  return useMemo(() => ({
    telemetry, promptTokens, status, steers, route,
    setTelemetry, setPromptTokens, setStatus, setSteers, setRoute,
    reset, restore, addSteers
  }), [telemetry, promptTokens, status, steers, route, reset, restore, addSteers]);
}

// The ledger only shows a live token count when the backend reports exact
// numbers; an estimate would put a number next to a label that promises a
// measurement. Pulled out of the render so the condition is stated once.
export function liveLedgerTokens({ streaming, promptTokens, telemetry, ledgerOpen }) {
  const exact = !!(streaming && promptTokens > 0 && telemetry && telemetry.exact);
  const generated = exact ? (telemetry.genTokens || 0) : 0;
  return {
    exact,
    generated,
    used: (ledgerOpen && exact) ? promptTokens + generated : 0
  };
}
