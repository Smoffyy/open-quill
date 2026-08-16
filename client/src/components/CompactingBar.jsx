import { useState, useEffect } from 'react';
import { t } from '../i18n.jsx';

export default function CompactingBar() {
  const [pct, setPct] = useState(6);
  useEffect(() => {
    const t = setInterval(() => setPct(p => (p < 92 ? p + Math.max(0.6, (92 - p) * 0.05) : p)), 220);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="compacting">
      <span className="compacting-spin" />
      <div className="compacting-body">
        <div className="compacting-text">{t("Compacting our conversation so we can keep chatting…")}</div>
        <div className="compacting-row">
          <div className="compacting-bar"><div className="compacting-fill" style={{ width: pct + '%' }} /></div>
          <span className="compacting-pct">{Math.round(pct)}%</span>
        </div>
      </div>
    </div>
  );
}
