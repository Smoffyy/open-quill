import { useRef, useState, useLayoutEffect } from 'react';

export default function Segmented({ value, onChange, options, className, role = 'tablist', label }) {
  const wrapRef = useRef(null);
  const [ind, setInd] = useState(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const btn = wrap.querySelector('[data-seg="' + value + '"]');
      if (!btn) { setInd(null); return; }
      const w = wrap.getBoundingClientRect();
      const b = btn.getBoundingClientRect();
      setInd({ left: b.left - w.left, width: b.width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    for (const b of wrap.querySelectorAll('[data-seg]')) ro.observe(b);
    return () => ro.disconnect();
  }, [value, options]);

  const itemRole = role === 'tablist' ? 'tab' : 'radio';
  return (
    <div className={className} ref={wrapRef} role={role} aria-label={label}>
      <span className={className + '-ind'} aria-hidden="true"
        style={ind ? { transform: 'translateX(' + ind.left + 'px)', width: ind.width } : { opacity: 0 }} />
      {options.map(o => {
        const on = o.id === value;
        const props = itemRole === 'tab' ? { 'aria-selected': on } : { 'aria-checked': on };
        return (
          <button key={o.id} type="button" role={itemRole} data-seg={o.id} {...props}
            className={className + '-btn' + (on ? ' on' : '')}
            title={o.title || undefined} disabled={o.disabled}
            onClick={() => !o.disabled && onChange && onChange(o.id)}>
            {o.Icon && <o.Icon />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
