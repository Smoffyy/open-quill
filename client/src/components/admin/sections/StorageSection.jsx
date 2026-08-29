import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Block, Field, Input, Btn, Table, Badge, KV, Empty, Note, fmtBytes } from '../ui.jsx';
import { Trash } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

export default function StorageSection() {
  const { confirm } = useAdmin();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try { setData(await api.get('/api/admin/databases')); setError(''); }
    catch (e) { setError(e.message || t('Could not read the database list.')); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function run(key, fn) {
    setBusy(key);
    setError('');
    try { setData(await fn()); }
    catch (e) { setError(e.message || t('That did not work.')); }
    finally { setBusy(''); }
  }

  function create() {
    const n = name.trim();
    if (!n) return;
    run('create', async () => {
      const d = await api.post('/api/admin/databases', { name: n });
      setName('');
      return d;
    });
  }

  function select(db) {
    confirm({
      title: t('Set startup database'),
      message: db.active
        ? t('This database is already running. Confirming just keeps it selected for the next start.')
        : t('The server will open “{name}” the next time it starts. Nothing changes until then, and the database running right now is left alone.', { name: db.name }),
      confirm: t('Select'),
      onConfirm: () => run('activate', () => api.post('/api/admin/databases/activate', { name: db.name }))
    });
  }

  function del(db) {
    confirm({
      title: t('Delete database'),
      message: t('This permanently erases “{name}” and everything in it: accounts, chats, uploads, artifacts, and memory. It cannot be undone.', { name: db.name }),
      confirm: t('Delete permanently'),
      onConfirm: () => run('del:' + db.name, () => api.del('/api/admin/databases/' + encodeURIComponent(db.name)))
    });
  }

  if (!data && !error) return <Block><Empty title={t('Loading')} /></Block>;

  const list = data?.databases || [];
  const restartNeeded = data?.requiresRestart;

  return (
    <>
      <Block title={t('Current')}>
        <KV items={[
          [t('running'), data?.active, true],
          [t('next start'), data?.pending || data?.active, true],
          ...(data?.envFile ? [[t('configured in'), data.envFile, true]] : []),
          [t('env key'), 'OPEN_QUILL_DB', true]
        ]} />
        <div style={{ marginTop: 14 }}>
          <Note tone={restartNeeded ? 'warn' : undefined}>
            {restartNeeded
              ? t('A different database is selected for the next start. Restart the server to switch to it.')
              : t('A database can only be swapped before the server opens it, so selecting one here takes effect on the next start. Each one is a fully separate world: its own accounts, chats, models, and uploads.')}
          </Note>
        </div>
      </Block>

      {error && <Block><Note tone="bad">{error}</Note></Block>}

      <Block title={t('Databases')}>
        <Table head={[
          { label: t('Name'), mono: true },
          { label: t('State'), fit: true },
          { label: t('Size'), num: true, fit: true },
          { label: '', fit: true }
        ]}>
          {list.map(db => (
            <tr key={db.name}>
              <td className="mono">{db.name}</td>
              <td className="fit">
                {db.active
                  ? <Badge tone="good">{t('running')}</Badge>
                  : db.pending
                    ? <Badge tone="warn">{t('next start')}</Badge>
                    : <Badge>{db.initialized ? t('idle') : t('not created yet')}</Badge>}
              </td>
              <td className="num mono">{fmtBytes(db.sizeBytes)}</td>
              <td className="acts">
                {!db.pending && (
                  <Btn size="sm" disabled={busy === 'activate'} onClick={() => select(db)}>{t('Use next start')}</Btn>
                )}
                {!db.active && !db.pending && db.name !== 'default' && (
                  <> <Btn size="sm" kind="danger" disabled={busy === 'del:' + db.name}
                    title={t('Delete database')} aria-label={t('Delete database')} onClick={() => del(db)}><Trash /></Btn></>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Block>

      <Block title={t('Create')} sub={t('Starts empty and initialises itself the first time the server opens it.')}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', maxWidth: 520 }}>
          <div style={{ flex: 1 }}>
            <Field label={t('Name')} hint={t('Lowercase letters, digits, dashes, and underscores.')}>
              <Input mono value={name} maxLength={40} placeholder="staging"
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
            </Field>
          </div>
          <Btn kind="primary" disabled={busy === 'create' || !name.trim()} onClick={create}>
            {busy === 'create' ? t('Creating…') : t('Create')}
          </Btn>
        </div>
      </Block>
    </>
  );
}
