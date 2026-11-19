import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../lib/api.js';
import { t } from '../../../i18n.jsx';
import { notify } from '../../../lib/notify.js';

export const USERS_PAGE = 50;

const EMPTY_COUNTS = { all: 0, pending: 0, disabled: 0 };

export function useUsers({ confirm, enabled }) {
  const [filter, setFilterRaw] = useState({ q: '', role: '', status: '' });
  const [state, setState] = useState({ users: [], total: 0, counts: EMPTY_COUNTS, ready: false, loading: false });
  const [roles, setRoles] = useState([]);
  const [signup, setSignup] = useState(null);
  const seq = useRef(0);

  const fetchPage = useCallback(async (offset, append) => {
    if (!enabled) return;
    const n = ++seq.current;
    setState(s => ({ ...s, loading: true }));
    const qs = new URLSearchParams({ ...filter, offset: String(offset), limit: String(USERS_PAGE) });
    try {
      const d = await api.get('/api/admin/users?' + qs);
      if (n !== seq.current) return;
      setState(s => ({ users: append ? [...s.users, ...d.users] : d.users, total: d.total, counts: d.counts || EMPTY_COUNTS, ready: true, loading: false }));
    } catch {
      if (n === seq.current) setState(s => ({ ...s, ready: true, loading: false }));
    }
  }, [enabled, filter]);

  const reload = useCallback(() => fetchPage(0, false), [fetchPage]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!enabled) return;
    api.get('/api/admin/roles').then(d => setRoles(d.roles || [])).catch(() => {});
    api.get('/api/admin/auth/signup').then(setSignup).catch(() => {});
  }, [enabled]);

  const setFilter = useCallback((patch) => setFilterRaw(f => ({ ...f, ...patch })), []);
  const loadMore = useCallback(() => fetchPage(state.users.length, true), [fetchPage, state.users.length]);

  const act = useCallback(async (run, fallback) => {
    try {
      await run();
      await reload();
      return true;
    } catch (e) {
      notify(e?.message || fallback, { kind: 'error' });
      return false;
    }
  }, [reload]);

  const setRole = useCallback((id, role) => act(() => api.patch('/api/admin/users/' + id, { role }), t('The role could not be changed.')), [act]);
  const setStatus = useCallback((id, status) => act(() => api.patch('/api/admin/users/' + id, { status }), t('The account could not be changed.')), [act]);

  const revokeSessions = useCallback(async (id) => {
    if (await act(() => api.del('/api/admin/users/' + id + '/sessions'), t('The sessions could not be ended.'))) {
      notify(t('Signed out everywhere'), { kind: 'success' });
    }
  }, [act]);

  const setBudget = useCallback(async (id, value) => {
    const budget = value === '' || value == null ? null : Math.max(0, Number(value) || 0);
    try {
      await api.patch('/api/admin/users/' + id + '/budget', { budget });
      setState(s => ({ ...s, users: s.users.map(u => (u.id === id ? { ...u, budget } : u)) }));
    } catch (e) {
      notify(e?.message || t('The cap could not be saved.'), { kind: 'error' });
    }
  }, []);

  const remove = useCallback((user) => {
    confirm({
      title: t('Remove account'),
      message: t('Removing {who} deletes their account and every chat, file, and artifact they own. This cannot be undone.', { who: user.email || t('this account') }),
      confirm: t('Remove account'),
      onConfirm: () => act(() => api.del('/api/admin/users/' + user.id), t('The account could not be removed.'))
    });
  }, [confirm, act]);

  const saveSignup = useCallback(async (patch) => {
    try { setSignup(await api.put('/api/admin/auth/signup', patch)); }
    catch (e) { notify(e?.message || t('The sign-up policy could not be saved.'), { kind: 'error' }); }
  }, []);

  return {
    ...state, filter, setFilter, loadMore, reload, roles, signup,
    setRole, setStatus, revokeSessions, setBudget, remove, saveSignup
  };
}