import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../lib/api.js';
import { notify } from '../../../lib/notify.js';
import { Card, Rows, Row, Input, Area, Seg, Select, Btn, Badge, Dialog, Field, Fields, ToggleRow, Note, Inline, fmtAgo } from '../ui.jsx';
import { t, tk, tp } from '../../../i18n.jsx';

const SECURITY = [
  { value: 'ldaps', label: 'LDAPS' },
  { value: 'starttls', label: 'StartTLS' },
  { value: 'none', label: tk('None'), translate: true }
];
const GROUP_MODES = [
  { value: 'none', label: tk('Ignore groups') },
  { value: 'memberOf', label: 'memberOf' },
  { value: 'search', label: tk('Search for groups') }
];
const PRESET_NAMES = [{ value: 'openldap', label: 'OpenLDAP' }, { value: 'activedirectory', label: 'Active Directory' }];
const SYNC_HOURS = [0, 1, 6, 12, 24];
const ATTRS = [
  { key: 'login', label: tk('Username attribute') },
  { key: 'email', label: tk('Email attribute') },
  { key: 'name', label: tk('Name attribute') },
  { key: 'id', label: tk('Unique ID attribute') }
];

const label = (o) => (o.translate ? t(o.label) : o.label);
const syncLabel = (h) => (h ? tp(h, 'Every hour', 'Every {n} hours') : t('Off'));

function draftOf(c) {
  return {
    url: c.url, security: c.security, ca: c.ca, bindDn: c.bindDn, bindPassword: '', userBase: c.userBase, userFilter: c.userFilter,
    attrs: { ...c.attrs }, groupMode: c.groupMode, groupBase: c.groupBase, groupFilter: c.groupFilter, groupNameAttr: c.groupNameAttr,
    provision: c.provision, linkByEmail: c.linkByEmail, syncHours: c.syncHours, syncDisable: c.syncDisable,
    syncMaxDisablePct: c.syncMaxDisablePct, enabled: c.enabled
  };
}

function DirectoryDialog({ config, editable, provision: provisionOptions, onSaved, onClose }) {
  const [draft, setDraft] = useState(() => draftOf(config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState(null);
  const set = (key) => (e) => setDraft(d => ({ ...d, [key]: e?.target ? e.target.value : e }));
  const flip = (key) => () => setDraft(d => ({ ...d, [key]: !d[key] }));
  const setAttr = (key) => (e) => setDraft(d => ({ ...d, attrs: { ...d.attrs, [key]: e.target.value } }));
  const provision = provisionOptions.find(p => p.value === draft.provision) || provisionOptions[0];

  function applyPreset(id) {
    const p = config.presets[id];
    if (p) setDraft(d => ({ ...d, ...p, attrs: { ...p.attrs } }));
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = { ...draft, syncHours: Number(draft.syncHours), syncMaxDisablePct: Number(draft.syncMaxDisablePct) };
      if (!body.bindPassword) delete body.bindPassword;
      onSaved(await api.put('/api/admin/auth/ldap', body));
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function test() {
    setCheck(null);
    try {
      const r = await api.post('/api/admin/auth/ldap/test', {});
      setCheck(r.base ? { ok: true, text: t('Connected, and the user base was found.') } : { ok: false, text: t('Connected, but the user base was not found.') });
    } catch (e) {
      setCheck({ ok: false, text: e.message });
    }
  }

  return (
    <Dialog title={t('Directory sign-in')} size="wide" onClose={onClose}
      foot={<>
        {editable && <Btn onClick={test} disabled={busy}>{t('Test saved settings')}</Btn>}
        <Btn onClick={onClose}>{editable ? t('Cancel') : t('Close')}</Btn>
        {editable && <Btn kind="primary" onClick={save} disabled={busy} aria-busy={busy}>{busy && <span className="btn-spin" aria-hidden="true" />}{t('Save')}</Btn>}
      </>}>
      <div role="alert">{error && <Note tone="warn">{error}</Note>}</div>
      {check && <Note tone={check.ok ? 'ok' : 'warn'}>{check.text}</Note>}
      {editable && (
        <Rows>
          <Row label={t('Fill in defaults for')}>
            <Select value="" label={t('Fill in defaults for')} onChange={(v) => { if (v) applyPreset(v); }}
              options={[{ value: '', label: t('Choose a directory') }, ...PRESET_NAMES]} />
          </Row>
        </Rows>
      )}
      <Fields>
        <Field label={t('Address')} hint={t('For example ldaps://ldap.example.com or ldap://dc1.corp.example.com:389.')}>
          <Input mono value={draft.url} disabled={!editable} onChange={set('url')} placeholder="ldaps://ldap.example.com" aria-label={t('Address')} />
        </Field>
        <Field label={t('Certificate authority')} optional hint={t('A PEM certificate, for a directory signed by your own authority. Leave empty to trust the system’s authorities.')}>
          <Area mono rows={3} value={draft.ca} disabled={!editable} onChange={set('ca')} aria-label={t('Certificate authority')} />
        </Field>
      </Fields>
      <Rows>
        <Row label={t('Encryption')} note={draft.security === 'none' ? t('Only allowed for a directory on this machine.') : ''}>
          {editable
            ? <Seg value={draft.security} label={t('Encryption')} onChange={set('security')} options={SECURITY.map(o => ({ value: o.value, label: label(o) }))} />
            : <span className="dim">{label(SECURITY.find(o => o.value === draft.security) || SECURITY[0])}</span>}
        </Row>
      </Rows>
      <Fields cols={2}>
        <Field label={t('Service account')} hint={t('The DN this server searches with. Read access to people and groups is enough.')}>
          <Input mono value={draft.bindDn} disabled={!editable} onChange={set('bindDn')} aria-label={t('Service account')} />
        </Field>
        <Field label={t('Service account password')}>
          <Input mono type="password" autoComplete="off" value={draft.bindPassword} disabled={!editable} onChange={set('bindPassword')}
            placeholder={config.hasPassword ? t('A password is saved. Type to replace it.') : ''} aria-label={t('Service account password')} />
        </Field>
      </Fields>
      <Fields>
        <Field label={t('User base')} hint={t('Where people are searched for, for example ou=people,dc=example,dc=com.')}>
          <Input mono value={draft.userBase} disabled={!editable} onChange={set('userBase')} aria-label={t('User base')} />
        </Field>
        <Field label={t('User filter')} hint={t('{{username}} becomes what the person types, escaped. It must match exactly one entry.')}>
          <Input mono value={draft.userFilter} disabled={!editable} onChange={set('userFilter')} aria-label={t('User filter')} />
        </Field>
      </Fields>
      <Fields cols={2}>
        {ATTRS.map(a => (
          <Field key={a.key} label={t(a.label)}>
            <Input mono value={draft.attrs[a.key] || ''} disabled={!editable} onChange={setAttr(a.key)} aria-label={t(a.label)} />
          </Field>
        ))}
      </Fields>
      <Rows>
        <Row label={t('Groups')} note={draft.groupMode === 'memberOf' ? t('Read from the memberOf attribute on each person.') : draft.groupMode === 'search' ? t('Found by searching for groups that list the person.') : ''}>
          {editable
            ? <Seg value={draft.groupMode} label={t('Groups')} onChange={set('groupMode')} options={GROUP_MODES.map(o => ({ value: o.value, label: t(o.label) }))} />
            : <span className="dim">{t((GROUP_MODES.find(o => o.value === draft.groupMode) || GROUP_MODES[0]).label)}</span>}
        </Row>
      </Rows>
      {draft.groupMode === 'search' && (
        <Fields cols={2}>
          <Field label={t('Group base')}>
            <Input mono value={draft.groupBase} disabled={!editable} onChange={set('groupBase')} aria-label={t('Group base')} />
          </Field>
          <Field label={t('Group name attribute')}>
            <Input mono value={draft.groupNameAttr} disabled={!editable} onChange={set('groupNameAttr')} aria-label={t('Group name attribute')} />
          </Field>
          <Field label={t('Group filter')} hint={t('{{dn}} becomes the person’s DN.')}>
            <Input mono value={draft.groupFilter} disabled={!editable} onChange={set('groupFilter')} aria-label={t('Group filter')} />
          </Field>
        </Fields>
      )}
      <Rows>
        <Row label={t('New accounts')} note={t(provision.note)}>
          {editable
            ? <Seg value={draft.provision} label={t('New accounts')} onChange={set('provision')} options={provisionOptions.map(p => ({ value: p.value, label: t(p.label) }))} />
            : <span className="dim">{t(provision.label)}</span>}
        </Row>
        <ToggleRow label={t('Link existing accounts by email')} on={draft.linkByEmail} onToggle={flip('linkByEmail')} disabled={!editable}
          note={t('Never for an account with a password, an admin role or another sign-in method.')} />
        <Row label={t('Sync with the directory')} note={t('Updates names, emails and groups of linked accounts.')}>
          {editable
            ? <Select value={draft.syncHours} label={t('Sync with the directory')} onChange={set('syncHours')} options={SYNC_HOURS.map(h => ({ value: h, label: syncLabel(h) }))} />
            : <span className="dim">{syncLabel(draft.syncHours)}</span>}
        </Row>
        <ToggleRow label={t('Disable accounts that leave the directory')} on={draft.syncDisable} onToggle={flip('syncDisable')} disabled={!editable}
          note={t('Applies to manual and scheduled syncs.')} />
        {draft.syncDisable && (
          <Row label={t('Most accounts one sync may disable')} note={t('A sync that would disable a larger share of linked accounts changes nothing.')}>
            <Inline>
              <Input type="number" min={0} max={100} value={draft.syncMaxDisablePct} disabled={!editable} onChange={set('syncMaxDisablePct')} aria-label={t('Most accounts one sync may disable')} />
              <span className="dim">%</span>
            </Inline>
          </Row>
        )}
        <ToggleRow label={t('Turned on')} on={draft.enabled} onToggle={flip('enabled')} disabled={!editable} />
      </Rows>
    </Dialog>
  );
}

function syncSummary(s) {
  if (!s.ok) return t(s.error);
  return t('Checked {checked}, updated {updated}, disabled {disabled}, missing {missing}.', s);
}

export default function DirectoryCard({ editable, provision }) {
  const [config, setConfig] = useState(null);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [found, setFound] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(() => api.get('/api/admin/auth/ldap')
    .then(setConfig)
    .catch(e => notify(e?.message || t('Could not load the directory settings.'), { kind: 'error' })), []);
  useEffect(() => { load(); }, [load]);

  if (!config) return null;

  async function lookup() {
    if (!username.trim()) return;
    setFound(null);
    try {
      setFound(await api.post('/api/admin/auth/ldap/lookup', { username: username.trim() }));
    } catch (e) {
      setFound({ error: e.message });
    }
  }

  async function sync() {
    setSyncing(true);
    const job = notify(t('Syncing with the directory'), { progress: true });
    try {
      const report = await api.post('/api/admin/auth/ldap/sync', {});
      setConfig(c => ({ ...c, lastSync: report }));
      if (report.ok) job.done(syncSummary(report));
      else job.fail(t(report.error));
    } catch (e) {
      job.fail(e.message);
    } finally {
      setSyncing(false);
    }
  }

  function foundText() {
    if (found.error) return found.error;
    if (!found.found) return found.ambiguous ? t('More than one entry matches. Narrow the user filter.') : t('No entry matches.');
    const groups = found.groups.length ? found.groups.join(', ') : t('none');
    return t('{name} ({email}), groups: {groups}', { name: found.name || found.login, email: found.email || t('no email'), groups });
  }

  const last = config.lastSync;
  return (
    <>
      <Card title={t('Directory (LDAP)')}
        sub={t('People sign in with their username and password from OpenLDAP, Active Directory or another LDAP directory. The password is checked by the directory and never stored here.')}
        actions={<Btn onClick={() => setOpen(true)}>{editable ? t('Configure') : t('View')}</Btn>}>
        <Rows>
          <Row label={t('Status')}>{config.enabled ? <Badge tone="on">{t('On')}</Badge> : <Badge>{t('Off')}</Badge>}</Row>
          {config.url && <Row label={t('Address')}><span className="dim mono">{config.url}</span></Row>}
          <Row label={t('Last sync')} note={last ? syncSummary(last) : ''}>
            <Inline>
              <span className="dim">{last ? fmtAgo(last.at) : t('never')}</span>
              {editable && config.enabled && <Btn onClick={sync} disabled={syncing} aria-busy={syncing}>{syncing && <span className="btn-spin" aria-hidden="true" />}{t('Sync now')}</Btn>}
            </Inline>
          </Row>
          {editable && config.url && (
            <Row label={t('Look up a person')} note={found ? foundText() : t('Shows what this server would see when they sign in, without signing them in.')}>
              <Inline>
                <Input mono value={username} placeholder={t('Username')} aria-label={t('Username')}
                  onChange={(e) => { setUsername(e.target.value); setFound(null); }} onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }} />
                <Btn onClick={lookup}>{t('Look up')}</Btn>
              </Inline>
            </Row>
          )}
        </Rows>
      </Card>
      {open && <DirectoryDialog config={config} editable={editable} provision={provision} onSaved={setConfig} onClose={() => setOpen(false)} />}
    </>
  );
}