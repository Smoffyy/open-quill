import { useState, useEffect, useRef } from 'react';
import { api } from '../../../api.js';
import { useAdmin } from '../store.jsx';
import { Block, Row, Field, Area, Switch, Btn, Table, Stats, Badge, Empty, Note, fmtAgo, fmtInt } from '../ui.jsx';
import { t } from '../../../i18n.jsx';

export default function NetworkSection() {
  const { workspace } = useAdmin();
  const { config, setCfg } = workspace;
  const [log, setLog] = useState(null);
  const alive = useRef(true);
  const busy = useRef(false);

  async function load() {
    if (busy.current) return;
    busy.current = true;
    try {
      const next = await api.get('/api/admin/egress-log');
      if (alive.current) setLog(next);
    } catch {
      if (alive.current) setLog(l => l || { entries: [], allowed: 0, blocked: 0 });
    } finally { busy.current = false; }
  }

  useEffect(() => {
    alive.current = true;
    const tick = () => { if (!document.hidden) load(); };
    tick();
    const id = setInterval(tick, 5000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive.current = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const blocking = config.egressLocalOnly !== false;

  return (
    <>
      <Block title={t('Outbound policy')}
        sub={t('Applies to connections this server opens. Loopback and private ranges stay reachable either way, so local model backends and a LAN search engine keep working.')}>
        <Row label={t('Block public internet')}
          note={t('Refuses connections to public addresses. A hostname must resolve entirely to private addresses to pass, which also defeats DNS rebinding.')}>
          <Switch on={blocking} label={t('Block public internet')}
            onToggle={() => setCfg('egressLocalOnly', !blocking)} />
        </Row>
        <Row label={t('Exempt web search')}
          note={t('Search has to open the pages it finds, and those are public even when the search engine is local. The exemption covers web search alone.')}>
          <Switch on={config.egressAllowWebSearch !== false} label={t('Exempt web search')}
            onToggle={() => setCfg('egressAllowWebSearch', config.egressAllowWebSearch === false)} />
        </Row>
        <div style={{ paddingTop: 14 }}>
          <Field label={t('Host allowlist')}
            hint={t('One host per line. A leading {star} covers subdomains. Needed to reach a cloud model provider while the block is on.', { star: '*.' })}>
            <Area mono rows={4} spellCheck={false} placeholder={'api.openai.com\n*.anthropic.com'}
              value={(config.egressAllowlist || []).join('\n')}
              onChange={(e) => setCfg('egressAllowlist', e.target.value.split('\n').map(x => x.trim()).filter(Boolean))} />
          </Field>
        </div>
      </Block>

      <Block title={t('Browser policy')}>
        <Row label={t('Serve every asset from this origin')}
          note={t('Sets a content policy that stops the page loading fonts, scripts, or images from anywhere else. Turn it off only if you point the app icon or a background at a remote URL, or if artifact previews need a CDN. Requests your server makes are unaffected.')}>
          <Switch on={config.localOnly !== false} label={t('Serve every asset from this origin')}
            onToggle={() => setCfg('localOnly', config.localOnly === false)} />
        </Row>
      </Block>

      <Block title={t('Connection log')}
        sub={t('Every host this server has tried to reach since it started. Held in memory, so it empties on restart.')}
        actions={log && log.entries?.length
          ? <Btn kind="danger" size="sm" onClick={async () => { try { await api.del('/api/admin/egress-log'); load(); } catch {} }}>{t('Clear log')}</Btn>
          : null}>
        <Stats items={[
          { k: t('Policy'), v: blocking ? t('blocking') : t('open'), n: blocking ? t('public addresses refused') : t('nothing is being refused') },
          { k: t('Allowed'), v: fmtInt(log?.allowed ?? 0) },
          { k: t('Blocked'), v: fmtInt(log?.blocked ?? 0) }
        ]} />
        {!blocking && (
          <div style={{ marginTop: 14 }}>
            <Note tone="warn">{t('The block is off, so nothing is being restricted. Attempts are still recorded below.')}</Note>
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          {log && !log.entries.length
            ? <Empty title={t('No outbound attempts')}>{t('Nothing has tried to leave this machine since the server started.')}</Empty>
            : (
              <Table head={[
                { label: t('Verdict'), fit: true },
                { label: t('Host'), mono: true },
                { label: t('Reason') },
                { label: t('Last'), fit: true, mono: true },
                { label: t('Count'), num: true, fit: true }
              ]}>
                {(log?.entries || []).map((e, i) => (
                  <tr key={e.host + i}>
                    <td className="fit"><Badge tone={e.allowed ? 'good' : 'bad'}>{e.allowed ? t('allow') : t('block')}</Badge></td>
                    <td className="mono">{e.host}</td>
                    <td className="dim">{e.reason}</td>
                    <td className="mono dim">{fmtAgo(e.last)}</td>
                    <td className="num mono">{fmtInt(e.count)}</td>
                  </tr>
                ))}
              </Table>
            )}
        </div>
      </Block>
    </>
  );
}
