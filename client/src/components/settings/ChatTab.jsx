import { t } from '../../i18n.jsx';
import { SwitchRow } from '../ui/controls.jsx';
import { STATUS_DELAY_SECS } from '../../lib/status.js';

export default function ChatTab({ prefs, setPref, cfg }) {
  const flip = (k) => () => setPref(k, !prefs[k]);
  const flipOnByDefault = (k) => () => setPref(k, prefs[k] === false);
  return (
    <>
      <div className="hint">{t("How responses look, move, and feel.")}</div>
      <div className="me-section-h">{t("Streaming")}</div>
      <SwitchRow label={t("Auto-scroll")} desc={t("Keep the latest text in view unless you scroll up.")}
        on={prefs.autoscroll !== false} onToggle={flipOnByDefault('autoscroll')} />
      <div className="me-section-h">{t("Tools and context")}</div>
      {cfg?.webSearchAvailable && (
        <SwitchRow label={t("Web search on by default")} desc={t("Start every new chat with web search enabled, when the model allows it.")}
          on={prefs.webSearchDefault} onToggle={flip('webSearchDefault')} />
      )}
      <SwitchRow label={t("Engine telemetry")} desc={t("Live speed and context fill above the message bar while a reply streams.")}
        on={prefs.engineStrip === true} onToggle={flip('engineStrip')} />
      <SwitchRow label={t("Context gauge")} desc={t("A how-full-is-the-window meter beside the model picker, updated every message.")}
        on={prefs.ctxGauge} onToggle={flip('ctxGauge')} />
      <SwitchRow label={t("Speed on each reply")} desc={t("Keep the tokens per second beside each reply, so models stay comparable.")}
        on={prefs.msgSpeed} onToggle={flip('msgSpeed')} />
      <SwitchRow label={t("Progress line")} desc={t("Shows what the model is doing beside its logo if a reply takes more than {n}s.", { n: STATUS_DELAY_SECS })}
        on={prefs.statusDelay !== false} onToggle={flipOnByDefault('statusDelay')} />
      <SwitchRow label={t("Context ledger on open")} desc={t("Open chats with the per-message token ledger already showing.")}
        on={prefs.ledgerDefault} onToggle={flip('ledgerDefault')} />
      <SwitchRow label={t("Mid-stream steering")} desc={t("Correct a reply mid-stream. Restarts from the cut point and costs an extra request.")}
        on={prefs.steering} onToggle={flip('steering')} />
    </>
  );
}
