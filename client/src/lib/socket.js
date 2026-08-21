import { useCallback, useEffect, useMemo, useRef } from 'react';

const RETRY_BASE = 1500;
const RETRY_MAX = 15000;

export function retryDelay(attempt) {
  return Math.min(RETRY_MAX, RETRY_BASE * Math.pow(2, attempt));
}

export function useSocket({ onMessage, shouldReconnect }) {
  const ws = useRef(null);
  const retry = useRef(0);
  const timer = useRef(null);
  const msgRef = useRef(onMessage);
  const liveRef = useRef(shouldReconnect);

  msgRef.current = onMessage;
  liveRef.current = shouldReconnect;

  const connect = useCallback(function open() {
    const existing = ws.current;
    if (existing && (existing.readyState === 0 || existing.readyState === 1)) return;
    clearTimeout(timer.current);
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws`);
    ws.current = sock;
    sock.onopen = () => { retry.current = 0; };
    sock.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      msgRef.current?.(m);
    };
    sock.onerror = () => { try { sock.close(); } catch {} };
    sock.onclose = () => {
      if (ws.current === sock) ws.current = null;
      const wait = retryDelay(retry.current++);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (!liveRef.current || liveRef.current()) open(); }, wait);
    };
  }, []);

  const send = useCallback((obj) => {
    const sock = ws.current;
    if (!sock || sock.readyState !== 1) {
      if (!sock || sock.readyState >= 2) connect();
      return false;
    }
    try { sock.send(JSON.stringify(obj)); return true; }
    catch { return false; }
  }, [connect]);

  const isOpen = useCallback(() => ws.current?.readyState === 1, []);

  const close = useCallback(() => {
    clearTimeout(timer.current);
    try { ws.current?.close(); } catch {}
  }, []);

  useEffect(() => close, [close]);

  return useMemo(() => ({ connect, send, isOpen, close }), [connect, send, isOpen, close]);
}
