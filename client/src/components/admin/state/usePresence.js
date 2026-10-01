import { useEffect, useState } from 'react';
import { wsSend, currentPresence } from '../../../lib/wsbus.js';

export function usePresence(userId, section, target = '') {
  const [admins, setAdmins] = useState(currentPresence);

  useEffect(() => {
    const on = (e) => setAdmins(Array.isArray(e.detail) ? e.detail : []);
    window.addEventListener('oq-presence', on);
    return () => window.removeEventListener('oq-presence', on);
  }, []);

  useEffect(() => {
    const send = () => wsSend({ type: 'presence', at: section ? { section, target } : null });
    send();
    window.addEventListener('oq-hello', send);
    return () => window.removeEventListener('oq-hello', send);
  }, [section, target]);

  useEffect(() => () => { wsSend({ type: 'presence', at: null }); }, []);

  return admins.filter(a => a.id !== userId);
}
