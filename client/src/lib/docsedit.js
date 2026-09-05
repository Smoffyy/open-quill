import { useState, useMemo, useCallback } from 'react';
import { t } from '../i18n.jsx';
import { api } from '../api.js';
import { docsModels, docsConfig, docsModelPatch } from './modeldocs.js';

export function useDocsEdit(models, cfg, { onSaved } = {}) {
  const [editing, setEditing] = useState(false);
  const [modelEdits, setModelEdits] = useState({});
  const [cfgEdit, setCfgEdit] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const baseModels = useMemo(() => docsModels(models), [models]);
  const liveModels = useMemo(() => {
    if (!editing) return baseModels;
    return baseModels.map(m => (modelEdits[m.id] ? { ...m, ...modelEdits[m.id] } : m));
  }, [baseModels, modelEdits, editing]);
  const liveCfg = cfgEdit || docsConfig(cfg);

  const setModelField = useCallback((id, key, value) => {
    setModelEdits(prev => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: value } }));
  }, []);
  const setCfgField = useCallback((key, value) => {
    setCfgEdit(prev => ({ ...docsConfig(prev || cfg), [key]: value }));
  }, [cfg]);

  const dirty = Object.keys(modelEdits).length > 0 || cfgEdit !== null;

  const start = useCallback(() => setEditing(true), []);
  const cancel = useCallback(() => { setEditing(false); setModelEdits({}); setCfgEdit(null); setError(''); }, []);

  const save = useCallback(async () => {
    setSaving(true);
    setError('');
    try {
      for (const [id, patch] of Object.entries(modelEdits)) {
        const base = baseModels.find(x => x.id === id);
        if (!base) continue;
        await api.patch('/api/admin/models/' + id, docsModelPatch({ ...base, ...patch }));
      }
      if (cfgEdit) await api.patch('/api/admin/app-config', { modelDocsConfig: cfgEdit });
      setModelEdits({});
      setCfgEdit(null);
      setEditing(false);
      if (onSaved) await onSaved();
    } catch (e) {
      setError(e?.message || t('Could not save these changes.'));
    } finally {
      setSaving(false);
    }
  }, [modelEdits, cfgEdit, baseModels, onSaved]);

  return {
    editing, modelEdits, baseModels, liveModels, liveCfg,
    setModelField, setCfgField, dirty, saving, error, start, cancel, save
  };
}
