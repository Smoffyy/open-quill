export default function Tip({ label, keys, tone, toggle, children }) {
  return (
    <span className="tip-host" data-tip={label || undefined} data-tip-keys={keys} data-tip-tone={tone} data-tip-toggle={toggle ? '' : undefined}>
      {children}
    </span>
  );
}