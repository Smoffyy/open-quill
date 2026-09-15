import { useSkeleton } from '../lib/skeleton.js';

export { LibraryGridSkeleton, LibraryListSkeleton } from './LibraryPage.jsx';

export function Skel({ when, children }) {
  const show = useSkeleton(when);
  return when && show ? children : null;
}

const width = (i, base, span) => base + ((i * 37) % span) + '%';

export function SkelLines({ count = 6, widths, className }) {
  const list = widths || Array.from({ length: count }, (_, i) => width(i, 42, 52));
  return (
    <div className={'skel-lines' + (className ? ' ' + className : '')} aria-hidden="true">
      {list.map((w, i) => <span key={i} className="skeleton" style={{ width: typeof w === 'number' ? w + '%' : w }} />)}
    </div>
  );
}

export function SkelRows({ count = 4, className }) {
  return (
    <div className={'skel-rows' + (className ? ' ' + className : '')} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skel-row">
          <span className="skeleton" style={{ width: width(i, 26, 22) }} />
          <span className="skeleton skel-row-v" style={{ width: width(i, 18, 26) }} />
        </div>
      ))}
    </div>
  );
}

export function SkelTable({ cols = 3, rows = 6, className }) {
  return (
    <div className={'skel-table' + (className ? ' ' + className : '')} aria-hidden="true">
      <div className="skel-tr skel-th">
        {Array.from({ length: cols }).map((_, c) => (
          <span key={c} className="skeleton" style={{ width: width(c, 34, 30) }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skel-tr">
          {Array.from({ length: cols }).map((_, c) => (
            <span key={c} className="skeleton" style={{ width: width(r + c * 3, 40, 48) }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkelStats({ count = 4, className }) {
  return (
    <div className={'skel-stats' + (className ? ' ' + className : '')} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skel-stat">
          <span className="skeleton" style={{ width: width(i, 44, 30) }} />
          <span className="skeleton skel-stat-v" style={{ width: width(i, 52, 28) }} />
        </div>
      ))}
    </div>
  );
}

export function SkelMenu({ count = 5, icons = true, className }) {
  return (
    <div className={'skel-menu' + (className ? ' ' + className : '')} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skel-menu-item">
          {icons && <span className="skeleton skel-menu-ic" />}
          <span className="skeleton" style={{ width: width(i, 40, 46) }} />
        </div>
      ))}
    </div>
  );
}
