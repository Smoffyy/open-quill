import { useState, useRef, useEffect } from 'react';
import { api } from '../../lib/api.js';
import { FileText, Copy, Check } from '../ui/icons.jsx';
import Markdown from '../chat/Markdown.jsx';
import { t, fmtDate } from '../../i18n.jsx';
import { parseVersion } from '../../lib/appversion.js';
import { channelLabel } from '../../lib/channel.js';
import { copyText } from '../../lib/clipboard.js';
import { Skel, SkelLines } from '../ui/Skeleton.jsx';
import { toast } from '../../lib/toast.js';
import { BRAND_ICON } from '../../lib/brand.js';

// The server hands back a plain YYYY-MM-DD. Splitting it by hand rather than passing it to
// Date() keeps it off the UTC-parsing path, which would render the day before east of Greenwich.
function formatReleased(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return '';
  return fmtDate(d, { year: 'numeric', month: 'long', day: 'numeric' });
}

function VersionBadge({ label, icon }) {
  const textRef = useRef(null);
  const [box, setBox] = useState(null);
  useEffect(() => {
    let alive = true;
    const measure = () => {
      if (!alive || !textRef.current) return;
      try {
        const b = textRef.current.getBBox();
        if (b.width && b.height) setBox(`${b.x} ${b.y} ${b.width} ${b.height}`);
      } catch { }
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => { });
    return () => { alive = false; };
  }, [label]);
  return (
    <div className="vh-badge">
      <svg className="vh-badge-num" viewBox={box || undefined} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <text ref={textRef} x="0" y="0" dominantBaseline="text-before-edge">{label}</text>
      </svg>
      <span className="vh-badge-wm" aria-hidden="true"><img src={icon} alt="" /></span>
    </div>
  );
}

export default function VersionTab({ cfg, onChangelog }) {
  const [release, setRelease] = useState(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);

  useEffect(() => {
    let alive = true;
    api.get('/api/release').then(d => { if (alive) setRelease(d); }).catch(() => { if (alive) setRelease({}); });
    return () => { alive = false; clearTimeout(copyTimer.current); };
  }, []);

  const appName = cfg?.appName || 'open-quill';
  const vp = parseVersion(release?.version || cfg?.version || '');
  const line = release?.line || (vp ? vp.base.split('.')[0] : '');
  const channel = channelLabel(vp?.channel);
  const released = formatReleased(release?.released);
  const notes = (release?.notes || '').trim();

  async function copyDetails() {
    const head = `${appName} ${vp ? vp.full : ''}`.trim();
    const lines = [release?.codename ? `${head} (${release.codename})` : head];
    if (release?.released) lines.push(`Released ${release.released}`);
    if (!await copyText(lines.join('\n'))) return;
    setCopied(true);
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1400);
    toast(t('Version details copied'), { icon: 'copy' });
  }

  return (
    <div className="vh">
      <div className="vh-top">
        {line && <VersionBadge label={line} icon={cfg?.appIcon || BRAND_ICON} />}
        <div className="vh-id">
          <div className="vh-name">{appName}</div>
          <div className="vh-meta">
            {release?.codename && <span className="vh-code">{release.codename}</span>}
            <span>{t("Version")} {vp ? vp.full : '—'}</span>
            {channel && <span className="vh-pill">{channel}{vp.build ? ' ' + vp.build : ''}</span>}
          </div>
          {released && <div className="vh-sub">{t("Released")} {released}</div>}
        </div>
      </div>
      <div className="vh-actions">
        <button className="btn ghost" onClick={onChangelog}><FileText className="btn-ic" /> {t("Changelog")}</button>
        <button className="btn ghost" onClick={copyDetails}>
          {copied ? <Check className="btn-ic" /> : <Copy className="btn-ic" />} {t("Copy details")}
        </button>
      </div>
      <div className="vh-notes" aria-busy={!release || undefined}>
        <div className="vh-notes-h">{t("Release notes")}</div>
        {!release
          ? <Skel when><SkelLines className="vh-notes-skel" count={6} /></Skel>
          : notes
            ? <div className="version-desc"><Markdown>{notes}</Markdown></div>
            : <div className="vh-empty">{t("No release notes for this build.")}</div>}
      </div>
    </div>
  );
}
