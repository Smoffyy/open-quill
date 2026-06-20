import React, { useState, useRef, useEffect } from 'react';

function bgStyle(css) {
  if (!css) return {};
  const v = String(css).trim();
  if (/^(https?:|data:|blob:|\/)/i.test(v)) return { backgroundImage: `url("${v}")`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' };
  return { background: v };
}

export default function AppBackground({ bg }) {
  const [st, setSt] = useState({ a: null, b: null, active: null });
  const ref = useRef(st);
  useEffect(() => {
    const cur = ref.current;
    const activeCss = cur.active ? cur[cur.active] : null;
    if ((bg || null) === (activeCss || null)) return;
    let next;
    if (!bg) next = { ...cur, active: null };
    else { const slot = cur.active === 'a' ? 'b' : 'a'; next = { ...cur, [slot]: bg, active: slot }; }
    ref.current = next;
    setSt(next);
  }, [bg]);
  return (
    <div className="app-bg-stack" aria-hidden="true">
      <div className={'app-bg-layer' + (st.active === 'a' ? ' on' : '')} style={bgStyle(st.a)} />
      <div className={'app-bg-layer' + (st.active === 'b' ? ' on' : '')} style={bgStyle(st.b)} />
      <div className="app-bg-scrim" />
    </div>
  );
}
