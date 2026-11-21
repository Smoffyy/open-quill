import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../lib/api.js';
import { notify } from '../../../lib/notify.js';
import { askConfirm } from '../../../lib/confirm.js';
import { Card, Rows, Row, Input, Seg, Select, Btn, IconBtn, Acts, Table, Badge, Dialog, Field, Fields, ToggleRow, Note, CopyBtn, Empty, Inline, SectionSkeleton, fmtAgo } from '../ui.jsx';
import { Trash, Refresh } from '../../ui/icons.jsx';
import { t, tk, tp, fmtDate } from '../../../i18n.jsx';

const PROVISION = [
  { value: 'user', label: tk('User'), note: tk('New people can use their account right away.') },
  { value: 'pending', label: tk('Pending'), note: tk('New people wait for an administrator to approve them.') }
];
const DEPROVISION = [
  { value: 'disable', label: tk('Disable'), note: tk('Removed people are turned off and their chats are kept. Provisioning them again restores the account.') },
  { value: 'delete', label: tk('Delete'), note: tk('Removed people are deleted with all their chats and files.') }
];
const ADOPT = [
  { value: 'off', label: tk('Off'), note: tk('An email that already has an account here is refused.') },
  { value: 'members', label: tk('Below admin'), note: tk('An existing account below admin is handed over: its password and sessions end, and its chats stay.') }
];
const LIFETIMES = [30, 90, 180, 365, 0];

const lifetimeLabel = (days) => (days ? tp(days, '{n} day', '{n} days') : t('Never expires'));
const noteOf = (list, value) => t((list.find(o => o.value === value) || list[0]).note);
const labelOf = (list, value) => t((list.find(o => o.value === value) || list[0]).label);

function TokenDialog({ onCreated, onClose }) {
  const [name, setName] = useState('');
  const [days, setDays] = useState(365);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');

  async function create() {
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/api/admin/auth/scim/tokens', { name, days });
      setToken(r.token);
      onCreated(r);
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  return (
    <Dialog title={token ? t('Copy your token') : t('New provisioning token')} onClose={onClose}
      foot={token
        ? <Btn kind="primary" onClick={onClose}>{t('Done')}</Btn>
        : <>
          <Btn onClick={onClose}>{t('Cancel')}</Btn>
          <Btn kind="primary" onClick={create} disabled={busy} aria-busy={busy}>{busy && <span className="btn-spin" aria-hidden="true" />}{t('Create token')}</Btn>
        </>}>
      {token ? (
        <>
          <Note tone="warn">{t('Copy it now and paste it into your identity provider as the bearer token. It is never shown again.')}</Note>
          <Inline>
            <Input mono readOnly value={token} aria-label={t('Provisioning token')} onFocus={(e) => e.target.select()} />
            <CopyBtn text={token} title={t('Copy')} />
          </Inline>
        </>
      ) : (
        <>
          <div role="alert">{error && <Note tone="warn">{error}</Note>}</div>
          <Fields>
            <Field label={t('Name')} hint={t('Who uses it, for example Okta or Microsoft Entra ID.')}>
              <Input value={name} autoFocus onChange={(e) => { setName(e.target.value); setError(''); }} aria-label={t('Name')}
                onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
            </Field>
          </Fields>
          <Rows>
            <Row label={t('Expires after')}>
              <Select value={days} label={t('Expires after')} onChange={setDays} options={LIFETIMES.map(d => ({ value: d, label: lifetimeLabel(d) }))} />
            </Row>
          </Rows>
        </>
      )}
    </Dialog>
  );
}

function detailOf(entry) {
  const m = entry.meta || {};
  return m.email || m.name || '';
}

export default function ProvisioningSection() {
  const [data, setData] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => api.get('/api/admin/auth/scim')
    .then(setData)
    .catch(e => notify(e?.message || t('Could not load the provisioning settings.'), { kind: 'error' })), []);
  useEffect(() => { load(); }, [load]);

  if (!data) return <SectionSkeleton />;
  const editable = data.editable;

  async function save(patch) {
    try { setData(await api.put('/api/admin/auth/scim', patch)); }
    catch (e) { notify(e.message, { kind: 'error' }); }
  }

  async function revoke(token) {
    if (!await askConfirm({
      title: t('Revoke {name}', { name: token.name }),
      message: t('Anything using this token stops provisioning at once. This cannot be undone.'),
      confirm: t('Revoke'), danger: true
    })) return;
    try { setData(await api.del(`/api/admin/auth/scim/tokens/${token.id}`)); }
    catch (e) { notify(e.message, { kind: 'error' }); }
  }

  return (
    <>
      <Card title={t('SCIM provisioning')}
        sub={editable
          ? t('Your identity provider creates, updates and removes accounts and groups here. It works with Okta, Microsoft Entra ID, OneLogin, JumpCloud and any SCIM 2.0 client.')
          : t('Only an owner can change provisioning.')}>
        <Rows>
          <ToggleRow label={t('Turned on')} on={data.enabled} onToggle={() => save({ enabled: !data.enabled })} disabled={!editable} />
          <Row label={t('New accounts')} note={noteOf(PROVISION, data.provision)}>
            {editable
              ? <Seg value={data.provision} label={t('New accounts')} onChange={(v) => save({ provision: v })} options={PROVISION.map(o => ({ value: o.value, label: t(o.label) }))} />
              : <span className="dim">{labelOf(PROVISION, data.provision)}</span>}
          </Row>
          <Row label={t('When someone is removed')} note={noteOf(DEPROVISION, data.deprovision)}>
            {editable
              ? <Seg value={data.deprovision} label={t('When someone is removed')} onChange={(v) => save({ deprovision: v })} options={DEPROVISION.map(o => ({ value: o.value, label: t(o.label) }))} />
              : <span className="dim">{labelOf(DEPROVISION, data.deprovision)}</span>}
          </Row>
          <Row label={t('Existing accounts with the same email')} note={noteOf(ADOPT, data.adopt)}>
            {editable
              ? <Seg value={data.adopt} label={t('Existing accounts with the same email')} onChange={(v) => save({ adopt: v })} options={ADOPT.map(o => ({ value: o.value, label: t(o.label) }))} />
              : <span className="dim">{labelOf(ADOPT, data.adopt)}</span>}
          </Row>
          <Row label={t('Provisioned accounts')} note={t('Roles are never set by provisioning. Change them under Users.')}>
            <span className="dim">{data.managed}</span>
          </Row>
        </Rows>
      </Card>
      <Card title={t('Base URL')} sub={t('Paste this into your identity provider as the SCIM connector base URL.')}>
        {data.baseFromRequest && <Note tone="warn">{t('Set the public address under Sign-in so this is an address your identity provider can reach.')}</Note>}
        <Inline>
          <Input mono readOnly value={data.baseUrl} aria-label={t('Base URL')} onFocus={(e) => e.target.select()} />
          <CopyBtn text={data.baseUrl} title={t('Copy')} />
        </Inline>
      </Card>
      <Card title={t('Tokens')} flush sub={t('Each identity provider gets its own token, so one can be revoked without touching the others.')}
        actions={editable && <Btn onClick={() => setCreating(true)}>{t('New token')}</Btn>}>
        {data.tokens.length === 0 ? (
          <Empty icon={Refresh} title={t('No tokens yet')}>{t('Create a token and paste it into your identity provider to start provisioning.')}</Empty>
        ) : (
          <Table head={[{ label: t('Name') }, { label: t('Created'), fit: true }, { label: t('Expires'), fit: true }, { label: t('Last used'), fit: true }, { label: '', fit: true }]}>
            {data.tokens.map(tok => (
              <tr key={tok.id}>
                <td>
                  <span className="cp-inline">{tok.name}<span className="dim mono">…{tok.hint}</span>{tok.expired && <Badge tone="bad">{t('expired')}</Badge>}</span>
                </td>
                <td className="fit dim">{fmtDate(tok.createdAt)}</td>
                <td className="fit dim">{tok.expiresAt ? fmtDate(tok.expiresAt) : t('never')}</td>
                <td className="fit dim">{tok.lastUsedAt ? fmtAgo(tok.lastUsedAt) : t('never')}</td>
                <td className="acts">
                  <Acts end>
                    {editable && <IconBtn kind="danger" label={t('Revoke {name}', { name: tok.name })} onClick={() => revoke(tok)}><Trash /></IconBtn>}
                  </Acts>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title={t('Recent activity')} flush sub={t('The latest changes your identity provider made. The event log keeps the full history.')}>
        {data.recent.length === 0 ? (
          <Empty icon={Refresh} title={t('Nothing provisioned yet')}>{t('Changes appear here as soon as your identity provider starts sending them.')}</Empty>
        ) : (
          <Table head={[{ label: t('Time'), fit: true }, { label: t('Action'), fit: true, mono: true }, { label: t('Detail'), mono: true }, { label: t('Token'), fit: true }]}>
            {data.recent.map(e => (
              <tr key={e.id}>
                <td className="fit dim">{fmtAgo(e.ts)}</td>
                <td className="fit mono">{e.action}</td>
                <td className="mono dim">{detailOf(e)}</td>
                <td className="fit dim">{e.actor.replace(/^SCIM: /, '')}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {creating && <TokenDialog onCreated={setData} onClose={() => setCreating(false)} />}
    </>
  );
}