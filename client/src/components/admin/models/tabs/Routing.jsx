import { useAdmin } from '../../store.jsx';
import { Card, Fields, Btn, IconBtn, Input, Select, Empty, Table, Acts, Note } from '../../ui.jsx';
import { Plus, Up, Down, X } from '../../../ui/icons.jsx';
import { useEditor, useField, useChange, CardMark, Choice } from '../bind.jsx';
import { t, tk } from '../../../../i18n.jsx';

const MATCHERS = [
  ['keyword', tk('contains any of these words')],
  ['regex', tk('matches this regular expression')],
  ['hasImage', tk('has an image attached')],
  ['hasFile', tk('has a file attached')],
  ['hasCode', tk('looks like code')],
  ['shorterThan', tk('is shorter than N characters')],
  ['longerThan', tk('is longer than N characters')],
  ['always', tk('always (catch-all)')]
];
const NEEDS_VALUE = new Set(['keyword', 'regex', 'shorterThan', 'longerThan']);
const HINT = { __proto__: null, keyword: 'translate, traducir', regex: '^\\s*(fix|debug)\\b' };

function Rules({ targets, pickable }) {
  const { edit } = useEditor();
  const { value, mixed } = useField('router_rules');
  const change = useChange('router_rules');
  const rules = Array.isArray(value) ? value : [];
  const put = (next) => edit({ router_rules: next });
  const upd = (i, patch) => put(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const swap = (i, j) => {
    const next = rules.slice();
    [next[i], next[j]] = [next[j], next[i]];
    put(next);
  };

  return (
    <Card title={<CardMark label={t('Rules')} k="router_rules" />} className={change.changed ? 'mc-changed' : undefined}
      sub={t('Checked from the top. The first match wins.')}
      actions={!mixed && (
        <Btn size="sm" onClick={() => put([...rules, { match: 'keyword', value: '', modelId: targets[0]?.id || '', label: '' }])}>
          <Plus /> {t('Add rule')}
        </Btn>
      )}>
      {mixed ? (
        <Note>{t('The selected routers have different rules. Pick one set from Mixed to give all of them the same rules.')}</Note>
      ) : rules.length === 0 ? (
        <Empty title={t('No rules')}>{t('Every turn will go straight to the fallback.')}</Empty>
      ) : (
        <Table head={[
          { label: '#', fit: true, mono: true },
          { label: t('When the message') },
          { label: t('Value') },
          { label: t('Send to') },
          { label: t('Shown as') },
          { label: '', fit: true }
        ]}>
          {rules.map((r, i) => (
            <tr key={i}>
              <td className="mono dim">{i + 1}</td>
              <td>
                <Select value={r.match} label={t('When the message')} onChange={(v) => upd(i, { match: v })}
                  options={MATCHERS.map(([v, l]) => ({ value: v, label: t(l) }))} />
              </td>
              <td>
                {NEEDS_VALUE.has(r.match)
                  ? <Input mono value={r.value || ''} aria-label={t('Value')} placeholder={HINT[r.match] || '400'}
                    onChange={(e) => upd(i, { value: e.target.value })} />
                  : <span className="dim">—</span>}
              </td>
              <td>
                <Select value={r.modelId || ''} label={t('Send to')} onChange={(v) => upd(i, { modelId: v })}
                  options={[{ value: '', label: t('choose a model') }, ...pickable]} />
              </td>
              <td>
                <Input value={r.label || ''} placeholder={t('optional')} aria-label={t('Shown as')}
                  onChange={(e) => upd(i, { label: e.target.value })} />
              </td>
              <td className="acts">
                <Acts end>
                  <IconBtn label={t('Move up')} disabled={i === 0} onClick={() => swap(i, i - 1)}><Up /></IconBtn>
                  <IconBtn label={t('Move down')} disabled={i === rules.length - 1} onClick={() => swap(i, i + 1)}><Down /></IconBtn>
                  <IconBtn kind="danger" label={t('Remove')} onClick={() => put(rules.filter((_, j) => j !== i))}><X /></IconBtn>
                </Acts>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

export default function Routing() {
  const { catalog } = useAdmin();
  const { ids } = useEditor();
  const kind = useField('kind');
  const others = catalog.models.filter(m => !ids.includes(m.id));
  const label = (m) => (m.display_name || m.internal_name) + (m.kind === 'router' ? ' ' + t('(router)') : '');
  const pickable = others.map(m => ({ value: m.id, label: label(m) }));
  const targets = others.filter(m => m.kind !== 'router');

  return (
    <>
      {kind.mixed && <Note>{t('Only the routers in this selection use these settings.')}</Note>}
      <Rules targets={targets} pickable={pickable} />
      <Card title={t('Fallback')}>
        <Fields cols={2}>
          <Choice k="router_default" label={t('Fallback')} fallback=""
            hint={t('Used when no rule matches. Without one, a router refuses the turn rather than guessing.')}
            options={[{ value: '', label: t('none') }, ...pickable]} />
        </Fields>
      </Card>
    </>
  );
}