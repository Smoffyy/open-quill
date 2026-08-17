import { useAdmin } from '../store.jsx';
import { Card } from '../widgets.jsx';
import { Cube, Plus, Trash } from '../../icons.jsx';
import { t } from '../../../i18n.jsx';

function EngineFacts({ e }) {
  const num = (n) => Number(n || 0).toLocaleString();
  const facts = [];
  if (e.ctx > 0) facts.push([t('Context per slot'), num(e.ctx) + ' ' + t('tokens')]);
  if (e.slots > 0) facts.push([t('Slots'), e.slotsBusy == null ? String(e.slots) : `${e.slotsBusy} ${t('busy of')} ${e.slots}`]);
  facts.push([t('Image input'), e.vision ? t('Supported') : t('Not supported')]);
  return (
    <div className="engine-facts">
      <div className="ef-grid">
        {facts.map(([k, v]) => (
          <div key={k} className="ef-item"><span className="ef-k">{k}</span><span className="ef-v">{v}</span></div>
        ))}
      </div>
      {e.models.length > 0 && (
        <div className="ef-models">
          <span className="ef-k">{t('Loaded')}</span>
          {e.models.map(m => (
            <span key={m.id} className="ef-model" title={m.trained > 0 ? `${t('Trained for')} ${num(m.trained)} ${t('tokens')}` : undefined}>
              {m.id}{m.ctx > 0 && e.models.length > 1 ? ` · ${num(m.ctx)}` : ''}
            </span>
          ))}
        </div>
      )}
      {e.slotsHidden && <div className="muted-note">{t('This server was started with slots hidden, so how many are in use cannot be read.')}</div>}
    </div>
  );
}

export default function ProvidersSection() {
  const A = useAdmin();
  const { providers, providerTypes, provTest, models } = A;
  return (
    <div className="provider-list">
      {providers.map((p, idx) => {
        const pt = providerTypes[p.type] || {};
        const test = provTest[p.id];
        const count = models.filter(m => (m.provider_id || providers[0]?.id) === p.id).length;
        return (
          <Card key={p.id} className="provider-card2"
            title={p.name || t('Provider ') + (idx + 1)}
            sub={`${pt.label || p.type}${count ? ` · ${count} model${count === 1 ? '' : 's'} attached` : ''}`}
            right={test && !test.busy && (
              test.ok
                ? <span className="pv-status ok">Reachable · {test.count} model{test.count === 1 ? '' : 's'}</span>
                : <span className="pv-status err">{test.err}</span>
            )}>
            <div className="two-col">
              <div className="field"><label>{t("Name")}</label>
                <input value={p.name || ''} onChange={(e) => A.patchProvider(p.id, { name: e.target.value })} placeholder={t("My provider")} /></div>
              <div className="field"><label>{t("Provider type")}</label>
                <select value={p.type} onChange={(e) => A.patchProvider(p.id, { type: e.target.value })}>
                  {Object.entries(providerTypes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select></div>
            </div>
            <div className="field"><label>{t("API base URL")}</label>
              <input value={p.base_url || ''} onChange={(e) => A.patchProvider(p.id, { base_url: e.target.value })} placeholder={pt.defaultBaseUrl || ''} /></div>
            <div className="field"><label>{t("API key")} {pt.keyOptional && <span className="muted-note" style={{ display: 'inline' }}>{t("(optional)")}</span>}</label>
              <input value={p.api_key || ''} onChange={(e) => A.patchProvider(p.id, { api_key: e.target.value })} placeholder={pt.keyOptional ? t('Not required for local servers') : t('Required')} /></div>
            <div className="btn-row">
              <button className="btn ghost" onClick={() => A.testProvider(p.id)} disabled={test?.busy}>{test?.busy ? t('Testing…') : t('Test connection')}</button>
              <button className="btn ghost" onClick={() => A.openDiscover(p.id)}><Cube style={{ width: 13, verticalAlign: '-2px' }} /> {t("Discover models")}</button>
              <button className="btn danger" disabled={providers.length <= 1} onClick={() => A.deleteProvider(p.id)}><Trash style={{ width: 13 }} /></button>
            </div>
            {test?.engine?.ok && <EngineFacts e={test.engine} />}
          </Card>
        );
      })}
      <button className="btn add-model" onClick={A.addProvider}><Plus style={{ width: 15, verticalAlign: '-2px' }} /> {t("Add provider")}</button>
    </div>
  );
}
