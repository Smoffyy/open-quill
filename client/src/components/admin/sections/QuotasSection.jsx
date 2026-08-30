import { useAdmin } from '../store.jsx';
import { Card, Rows, ToggleRow, Fields, Field, Input } from '../ui.jsx';
import { t } from '../../../i18n.jsx';

export default function QuotasSection() {
  const { workspace } = useAdmin();
  const { settings, set } = workspace;

  // Every quota is the same control, so the whole page is a table of them.
  const num = (key, fallback, extra) => (
    <Input type="number" min="0" step="1" value={settings[key] ?? fallback}
      onChange={(e) => set(key, e.target.value)} {...extra} />
  );

  return (
    <>
      <Card title={t('Attachments')} sub={t('Ceilings on what members may attach to a message. Zero means no ceiling.')}>
        <Fields cols={2}>
          <Field label={t('Admin upload cap (MB)')}>{num('uploadLimitAdminMb', 8)}</Field>
          <Field label={t('Member upload cap (MB)')}>{num('uploadLimitUserMb', 8)}</Field>
        </Fields>
      </Card>

      <Card title={t('Sandbox storage')} sub={t('Total size a single chat’s sandbox may hold. Writes past the ceiling are refused.')}>
        <Fields cols={2}>
          <Field label={t('Admin sandbox cap (MB)')}>{num('sandboxLimitAdminMb', 1024)}</Field>
          <Field label={t('Member sandbox cap (MB)')}>{num('sandboxLimitUserMb', 256)}</Field>
        </Fields>
      </Card>

      <Card title={t('Spend caps')}
        sub={t('Monthly ceilings derived from per-model pricing. A member-specific override in Members wins over these. Zero means no cap.')}>
        <Fields cols={3}>
          <Field label={t('Member cap ($/month)')}>{num('budgetUser', 0, { step: 'any' })}</Field>
          <Field label={t('Admin cap ($/month)')}>{num('budgetAdmin', 0, { step: 'any' })}</Field>
          <Field label={t('Warn at fraction')} hint={t('The banner appears once this share of the cap is spent.')}>
            {num('budgetWarnFraction', 0.8, { min: '0.1', max: '0.99', step: '0.05' })}
          </Field>
        </Fields>
        <Rows>
          <ToggleRow label={t('Block sending at the cap')} on={!!settings.budgetEnforce}
            onToggle={() => set('budgetEnforce', !settings.budgetEnforce)}
            note={t('On, a member at or past their cap cannot send until the month rolls over. Off, the banner is advisory. Admins are never blocked either way.')} />
        </Rows>
      </Card>

      <Card title={t('Sessions')} sub={t('How long a sign-in survives, and how many a member may hold at once.')}>
        <Fields cols={2}>
          <Field label={t('Idle lifetime (days)')} hint={t('Activity resets the clock.')}>
            {num('sessionTtlDays', 30, { min: '1', max: '365' })}
          </Field>
          <Field label={t('Concurrent sessions')} hint={t('Oldest sessions are signed out past this. Zero means no limit.')}>
            {num('maxSessions', 0, { max: '50' })}
          </Field>
        </Fields>
      </Card>

      <Card title={t('Scheduling')} sub={t('For single-GPU hosts that can only hold one model in memory at a time.')}>
        <Rows>
          <ToggleRow label={t('Serialise across models')} on={!!settings.modelQueue}
            onToggle={() => set('modelQueue', !settings.modelQueue)}
            note={t('Requests for the same model still run together. A request for a different model waits for the current one to finish instead of forcing a swap mid-reply.')} />
        </Rows>
      </Card>
    </>
  );
}
