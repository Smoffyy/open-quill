import { useAdmin } from '../store.jsx';
import { Block, Row, Fields, Field, Input, Switch } from '../ui.jsx';
import { t } from '../../../i18n.jsx';

export default function QuotasSection() {
  const { workspace } = useAdmin();
  const { settings, set } = workspace;

  return (
    <>
      <Block title={t('Attachments')} sub={t('Ceilings on what members may attach to a message. Zero means no ceiling.')}>
        <Fields cols={2}>
          <Field label={t('Admin upload cap (MB)')}>
            <Input type="number" min="0" step="1" value={settings.uploadLimitAdminMb ?? 8}
              onChange={(e) => set('uploadLimitAdminMb', e.target.value)} />
          </Field>
          <Field label={t('Member upload cap (MB)')}>
            <Input type="number" min="0" step="1" value={settings.uploadLimitUserMb ?? 8}
              onChange={(e) => set('uploadLimitUserMb', e.target.value)} />
          </Field>
        </Fields>
      </Block>

      <Block title={t('Sandbox storage')} sub={t('Total size a single chat’s sandbox may hold. Writes past the ceiling are refused.')}>
        <Fields cols={2}>
          <Field label={t('Admin sandbox cap (MB)')}>
            <Input type="number" min="0" step="1" value={settings.sandboxLimitAdminMb ?? 1024}
              onChange={(e) => set('sandboxLimitAdminMb', e.target.value)} />
          </Field>
          <Field label={t('Member sandbox cap (MB)')}>
            <Input type="number" min="0" step="1" value={settings.sandboxLimitUserMb ?? 256}
              onChange={(e) => set('sandboxLimitUserMb', e.target.value)} />
          </Field>
        </Fields>
      </Block>

      <Block title={t('Scheduling')} sub={t('For single-GPU hosts that can only hold one model in memory at a time.')}>
        <Row label={t('Serialise across models')}
          note={t('Requests for the same model still run together. A request for a different model waits for the current one to finish instead of forcing a swap mid-reply.')}>
          <Switch on={!!settings.modelQueue} label={t('Serialise across models')}
            onToggle={() => set('modelQueue', !settings.modelQueue)} />
        </Row>
      </Block>

      <Block title={t('Spend caps')}
        sub={t('Monthly ceilings derived from per-model pricing. A member-specific override in Members wins over these. Zero means no cap.')}>
        <Fields cols={3}>
          <Field label={t('Member cap ($/month)')}>
            <Input type="number" min="0" step="any" value={settings.budgetUser ?? 0}
              onChange={(e) => set('budgetUser', e.target.value)} />
          </Field>
          <Field label={t('Admin cap ($/month)')}>
            <Input type="number" min="0" step="any" value={settings.budgetAdmin ?? 0}
              onChange={(e) => set('budgetAdmin', e.target.value)} />
          </Field>
          <Field label={t('Warn at fraction')} hint={t('The banner appears once this share of the cap is spent.')}>
            <Input type="number" min="0.1" max="0.99" step="0.05" value={settings.budgetWarnFraction ?? 0.8}
              onChange={(e) => set('budgetWarnFraction', e.target.value)} />
          </Field>
        </Fields>
        <div style={{ marginTop: 4 }}>
          <Row label={t('Block sending at the cap')}
            note={t('On, a member at or past their cap cannot send until the month rolls over. Off, the banner is advisory. Admins are never blocked either way.')}>
            <Switch on={!!settings.budgetEnforce} label={t('Block sending at the cap')}
              onToggle={() => set('budgetEnforce', !settings.budgetEnforce)} />
          </Row>
        </div>
      </Block>

      <Block title={t('Sessions')} sub={t('How long a sign-in survives, and how many a member may hold at once.')}>
        <Fields cols={2}>
          <Field label={t('Idle lifetime (days)')} hint={t('Activity resets the clock.')}>
            <Input type="number" min="1" max="365" step="1" value={settings.sessionTtlDays ?? 30}
              onChange={(e) => set('sessionTtlDays', e.target.value)} />
          </Field>
          <Field label={t('Concurrent sessions')} hint={t('Oldest sessions are signed out past this. Zero means no limit.')}>
            <Input type="number" min="0" max="50" step="1" value={settings.maxSessions ?? 0}
              onChange={(e) => set('maxSessions', e.target.value)} />
          </Field>
        </Fields>
      </Block>
    </>
  );
}
