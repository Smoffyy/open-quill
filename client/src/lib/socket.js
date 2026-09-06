import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createSocketClient, socketUrl } from './wsclient.js';

export { retryDelay } from './wsclient.js';

// Thin React binding over createSocketClient: the lifecycle lives there, this
// only keeps one client per mount and reads the latest callbacks through refs so
// the socket is never torn down just because a parent re-rendered.
export function useSocket({ onMessage, shouldReconnect }) {
  const msgRef = useRef(onMessage);
  const liveRef = useRef(shouldReconnect);
  msgRef.current = onMessage;
  liveRef.current = shouldReconnect;

  const client = useRef(null);
  if (!client.current) {
    client.current = createSocketClient({
      url: () => socketUrl(location),
      onMessage: (m) => msgRef.current?.(m),
      shouldReconnect: () => (liveRef.current ? liveRef.current() : true)
    });
  }

  const connect = useCallback(() => client.current.connect(), []);
  const send = useCallback((obj) => client.current.send(obj), []);
  const isOpen = useCallback(() => client.current.isOpen(), []);
  const close = useCallback(() => client.current.close(), []);

  useEffect(() => close, [close]);

  return useMemo(() => ({ connect, send, isOpen, close }), [connect, send, isOpen, close]);
}
