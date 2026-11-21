import { Card, Rows, ToggleRow } from '../ui.jsx';
import { t } from '../../../i18n.jsx';
import { PERMISSION_CATEGORIES, PERMISSION_LABELS } from '../../../lib/permissionlabels.js';

export function permissionLabel(id) {
  return t(PERMISSION_LABELS[id]?.label || id);
}

export default function PermissionPicker({ registry, tier, value, locked, lockedNote, disabled, onChange }) {
  const chosen = new Set(value);
  const rows = registry.filter(p => !tier || p.tier === tier);
  const toggle = (id) => onChange(chosen.has(id) ? value.filter(x => x !== id) : [...value, id]);
  return PERMISSION_CATEGORIES.map(cat => {
    const inCategory = rows.filter(p => p.category === cat.id);
    if (!inCategory.length) return null;
    return (
      <Card key={cat.id} title={t(cat.label)}>
        <Rows>
          {inCategory.map(p => {
            const fixed = !!locked?.has(p.id);
            return (
              <ToggleRow key={p.id} label={permissionLabel(p.id)} on={fixed || chosen.has(p.id)} disabled={disabled || fixed}
                note={fixed ? lockedNote : t(PERMISSION_LABELS[p.id]?.note || '')} onToggle={() => toggle(p.id)} />
            );
          })}
        </Rows>
      </Card>
    );
  });
}