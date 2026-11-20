import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../lib/api.js';
import { notify } from '../../../lib/notify.js';
import { askConfirm } from '../../../lib/confirm.js';
import { Card, Rows, Row, Input, Area, Seg, Select, Btn, IconBtn, Acts, Table, Badge, Dialog, Field, Fields, ToggleRow, Note, CopyBtn, Empty, SectionSkeleton } from '../ui.jsx';
import { Trash, Pencil, Link } from '../../ui/icons.jsx';
import { t, tk } from '../../../i18n.jsx';

const TYPES = [
  { value: 'google', label: 'Google' },
  { value: 'microsoft', label: 'Microsoft' },
  { value: 'github', label: 'GitHub' },
  { value: 'oidc', label: tk('OpenID Connect'), translate: true }
];
const PROVISION = [
  { value: 'off', label: tk('Off'), note: tk('Only people who already have an account here can use this provider.') },
  { value: 'pending', label: tk('Pending'), note: tk('New people get an account that waits for approval.') },
  { value: 'user', label: tk('User'), note: tk('New people get an account they can use right away.') }
];
const AUTH_METHODS = [{ value: 'post', label: tk('In the request body') }, { value: 'basic', label: tk('HTTP Basic') }];

const typeName = (type) => {
  const found = TYPES.find(x => x.value === type);
  return found?.translate ? t(found.label) : found?.label || type;
};

function draftOf(p) {
  return {
    label: p.label, clientId: p.clientId, clientSecret: '', tenant: p.tenant || '', issuer: p.type === 'oidc' ? p.issuer : '',
    scopes: p.scopes || '', authMethod: p.authMethod, domains: (p.domains || []).join('\n'), linkByEmail: p.linkByEmail,
    provision: p.provision, requireMfa: p.requireMfa, syncGroups: p.syncGroups, groupsClaim: p.groupsClaim,
    requiredGroup: p.requiredGroup, githubOrg: p.githubOrg, enabled: p.enabled
  };
}

function ProviderDialog({ provider, editable, onSaved, onClose }) {
  const [draft, setDraft] = useState(() => draftOf(provider));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState(null);
  const set = (key) => (e) => setDraft(d => ({ ...d, [key]: e?.target ? e.target.value : e }));
  const flip = (key) => () => setDraft(d => ({ ...d, [key]: !d[key] }));
  const oidc = provider.type === 'oidc';
  const provision = PROVISION.find(p => p.value === draft.provision) || PROVISION[0];

  async function save() {
    setBusy(true);
    setError('');
    try {
      const body = { ...draft, domains: draft.domains.split(/\s+/).filter(Boolean) };
      if (!body.clientSecret) delete body.clientSecret;
      onSaved(await api.patch(`/api/admin/auth/providers/${provider.id}`, body));
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function test() {
    setCheck(null);
    try {
      const r = await api.post(`/api/admin/auth/providers/${provider.id}/test`, {});
      setCheck({ ok: true, text: t('Reached {issuer}.', { issuer: r.issuer }) });
    } catch (e) {
      setCheck({ ok: false, text: e.message });
    }
  }

  return (
    <Dialog title={t('{name} sign-in', { name: provider.label })} size="wide" onClose={onClose}
      foot={<>
        {editable && <Btn onClick={test} disabled={busy}>{t('Test saved settings')}</Btn>}
        <Btn onClick={onClose}>{editable ? t('Cancel') : t('Close')}</Btn>
        {editable && <Btn kind="primary" onClick={save} disabled={busy} aria-busy={busy}>{busy && <span className="btn-spin" aria-hidden="true" />}{t('Save')}</Btn>}
      </>}>
      <div role="alert">{error && <Note tone="warn">{error}</Note>}</div>
      {check && <Note tone={check.ok ? 'ok' : 'warn'}>{check.text}</Note>}
      <Fields>
        <Field label={t('Redirect address')} hint={provider.callback ? t('Register this exact address with the provider.') : t('Set the public address first; the redirect address is built from it.')}>
          <div className="cp-inline">
            <Input mono readOnly value={provider.callback} aria-label={t('Redirect address')} />
            {provider.callback && <CopyBtn text={provider.callback} title={t('Copy')} />}
          </div>
        </Field>
        <Field label={t('Button label')}>
          <Input value={draft.label} disabled={!editable} onChange={set('label')} aria-label={t('Button label')} />
        </Field>
        <Field label={t('Client ID')}>
          <Input mono value={draft.clientId} disabled={!editable} onChange={set('clientId')} aria-label={t('Client ID')} />
        </Field>
        <Field label={t('Client secret')}>
          <Input mono type="password" autoComplete="off" value={draft.clientSecret} disabled={!editable} onChange={set('clientSecret')}
            placeholder={provider.hasSecret ? t('A secret is saved. Type to replace it.') : ''} aria-label={t('Client secret')} />
        </Field>
        {provider.type === 'microsoft' && (
          <Field label={t('Directory (tenant) ID')} hint={t('The GUID on the app registration’s overview page. Only people in this directory can sign in.')}>
            <Input mono value={draft.tenant} disabled={!editable} onChange={set('tenant')} aria-label={t('Directory (tenant) ID')} />
          </Field>
        )}
        {oidc && (
          <>
            <Field label={t('Issuer')} hint={t('The address the provider’s discovery document lives under, for example https://login.example.com/realms/acme.')}>
              <Input mono value={draft.issuer} disabled={!editable} onChange={set('issuer')} aria-label={t('Issuer')} />
            </Field>
            <Field label={t('Extra scopes')} optional hint={t('Separated by spaces, for example groups. openid, email and profile are always asked for.')}>
              <Input mono value={draft.scopes} disabled={!editable} onChange={set('scopes')} aria-label={t('Extra scopes')} />
            </Field>
            <Field label={t('Groups claim')}>
              <Input mono value={draft.groupsClaim} disabled={!editable} onChange={set('groupsClaim')} aria-label={t('Groups claim')} />
            </Field>
            <Field label={t('Only members of this group')} optional>
              <Input value={draft.requiredGroup} disabled={!editable} onChange={set('requiredGroup')} aria-label={t('Only members of this group')} />
            </Field>
          </>
        )}
        {provider.type === 'github' && (
          <Field label={t('Only members of this organization')} optional>
            <Input mono value={draft.githubOrg} disabled={!editable} onChange={set('githubOrg')} aria-label={t('Only members of this organization')} />
          </Field>
        )}
        <Field label={t('Allowed email domains')} optional hint={t('One per line. Leave empty to accept the domains the sign-up settings accept.')}>
          <Area mono rows={3} value={draft.domains} disabled={!editable} onChange={set('domains')} aria-label={t('Allowed email domains')} />
        </Field>
      </Fields>
      <Rows>
        <Row label={t('New accounts')} note={t(provision.note)}>
          {editable
            ? <Seg value={draft.provision} label={t('New accounts')} onChange={set('provision')} options={PROVISION.map(p => ({ value: p.value, label: t(p.label) }))} />
            : <span className="dim">{t(provision.label)}</span>}
        </Row>
        <ToggleRow label={t('Link existing accounts by email')} on={draft.linkByEmail} onToggle={flip('linkByEmail')} disabled={!editable}
          note={t('Only when the provider has verified the email, and never for an account with a password, an admin role or another sign-in method.')} />
        <ToggleRow label={t('Also ask for this server’s two-factor')} on={draft.requireMfa} onToggle={flip('requireMfa')} disabled={!editable}
          note={t('Off trusts the provider’s own sign-in checks.')} />
        {oidc && (
          <>
            <ToggleRow label={t('Keep groups in sync')} on={draft.syncGroups} onToggle={flip('syncGroups')} disabled={!editable}
              note={t('The groups in the claim become directory groups, updated at every sign-in.')} />
            <Row label={t('Client authentication')}>
              {editable
                ? <Seg value={draft.authMethod} label={t('Client authentication')} onChange={set('authMethod')} options={AUTH_METHODS.map(m => ({ value: m.value, label: t(m.label) }))} />
                : <span className="dim">{t(AUTH_METHODS.find(m => m.value === draft.authMethod)?.label || AUTH_METHODS[0].label)}</span>}
            </Row>
          </>
        )}
        <ToggleRow label={t('Turned on')} on={draft.enabled} onToggle={flip('enabled')} disabled={!editable} />
      </Rows>
    </Dialog>
  );
}

export default function SignInSection() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);
  const [url, setUrl] = useState('');

  const load = useCallback(() => api.get('/api/admin/auth/providers')
    .then(d => { setData(d); setUrl(d.publicUrl); })
    .catch(e => notify(e?.message || t('Could not load the sign-in settings.'), { kind: 'error' })), []);
  useEffect(() => { load(); }, [load]);

  if (!data) return <SectionSkeleton />;

  async function saveUrl() {
    try {
      const d = await api.put('/api/admin/auth/public-url', { url });
      setData(d);
      setUrl(d.publicUrl);
      notify(t('Public address saved'), { kind: 'success' });
    } catch (e) {
      notify(e.message, { kind: 'error' });
    }
  }

  async function add(type) {
    try {
      const d = await api.post('/api/admin/auth/providers', { type });
      setData(d);
      setEditing(d.providers.find(p => p.id === d.created) || null);
    } catch (e) {
      notify(e.message, { kind: 'error' });
    }
  }

  async function remove(p) {
    if (!await askConfirm({
      title: t('Remove {name}', { name: p.label }),
      message: t('Every account loses its link to {name}, and people who sign in only through it lose their way in. This cannot be undone.', { name: p.label }),
      confirm: t('Remove'), danger: true
    })) return;
    try { setData(await api.del(`/api/admin/auth/providers/${p.id}`)); }
    catch (e) { notify(e.message, { kind: 'error' }); }
  }

  return (
    <>
      <Card title={t('Public address')} sub={t('The address people use to reach this server. Providers send people back to it, so it must match what you register with them.')}>
        {data.publicUrlFromEnv
          ? <Note>{t('Set by PUBLIC_URL in the server’s environment: {url}', { url: data.publicUrl })}</Note>
          : (
            <div className="cp-inline">
              <Input mono value={url} placeholder="https://chat.example.com" disabled={!data.editable} aria-label={t('Public address')}
                onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveUrl(); }} />
              {data.editable && <Btn onClick={saveUrl}>{t('Save')}</Btn>}
            </div>
          )}
      </Card>
      <Card title={t('Sign-in providers')} flush
        sub={data.editable ? t('People can sign in with these as well as with a password.') : t('Only an owner can change how people sign in.')}
        actions={data.editable && (
          <Select value="" label={t('Add a provider')} onChange={(v) => { if (v) add(v); }}
            options={[{ value: '', label: t('Add a provider') }, ...TYPES.map(x => ({ value: x.value, label: x.translate ? t(x.label) : x.label }))]} />
        )}>
        {data.providers.length === 0 ? (
          <Empty icon={Link} title={t('No sign-in providers yet')}>
            {t('Add Google, Microsoft, GitHub or any OpenID Connect provider such as Okta or Keycloak.')}
          </Empty>
        ) : (
          <Table head={[{ label: t('Provider') }, { label: t('Type'), fit: true }, { label: t('Status'), fit: true }, { label: '', fit: true }]}>
            {data.providers.map(p => (
              <tr key={p.id}>
                <td>{p.label}</td>
                <td className="fit dim">{typeName(p.type)}</td>
                <td className="fit">{p.enabled ? <Badge tone="on">{t('On')}</Badge> : <Badge>{t('Off')}</Badge>}</td>
                <td className="acts">
                  <Acts end>
                    <IconBtn label={t('Edit {name}', { name: p.label })} onClick={() => setEditing(p)}><Pencil /></IconBtn>
                    {data.editable && <IconBtn kind="danger" label={t('Remove {name}', { name: p.label })} onClick={() => remove(p)}><Trash /></IconBtn>}
                  </Acts>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {editing && <ProviderDialog provider={editing} editable={data.editable} onSaved={setData} onClose={() => setEditing(null)} />}
    </>
  );
}