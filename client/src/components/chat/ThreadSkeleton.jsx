
const LINES = [98, 89, 98, 72, 89, 98, 66, 89, 82, 38];

export default function ThreadSkeleton() {
  return (
    <div className="thread-skel" aria-hidden="true">
      <div className="ts-user"><span className="skeleton" /></div>
      <div className="ts-assistant">
        {LINES.map((w, i) => (
          <span key={i} className="skeleton" style={{ width: w + '%', opacity: 1 - i * 0.075 }} />
        ))}
      </div>
    </div>
  );
}
