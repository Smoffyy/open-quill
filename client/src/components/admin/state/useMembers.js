import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../api.js';

export function useMembers({ confirm }) {
  const [members, setMembers] = useState([]);

  const load = useCallback(async () => {
    try { setMembers(await api.get('/api/admin/users')); } catch {}
  }, []);

  useEffect(() => { load(); }, [load]);

  const setRole = useCallback(async (id, isAdmin) => {
    await api.patch('/api/admin/users/' + id, { isAdmin });
    setMembers(us => us.map(u => (u.id === id ? { ...u, isAdmin } : u)));
  }, []);

  const setBudget = useCallback(async (id, value) => {
    const budget = value === '' || value == null ? null : Math.max(0, Number(value) || 0);
    try {
      await api.patch('/api/admin/users/' + id + '/budget', { budget });
      setMembers(us => us.map(u => (u.id === id ? { ...u, budget } : u)));
    } catch {}
  }, []);

  const remove = useCallback((id, email) => {
    confirm({
      title: 'Remove member',
      message: `Removing ${email || 'this member'} deletes their account and every chat, file, and artifact they own. This cannot be undone.`,
      confirm: 'Remove member',
      onConfirm: async () => {
        await api.del('/api/admin/users/' + id);
        setMembers(us => us.filter(u => u.id !== id));
      }
    });
  }, [confirm]);

  return { members, setRole, setBudget, remove, reload: load };
}
