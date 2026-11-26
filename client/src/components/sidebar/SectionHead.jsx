import { ChevDown } from '../ui/icons.jsx';

export default function SectionHead({ id, label, folded, onToggle, children }) {
  return (
    <div className="section-label recents-label has-head">
      <button className="sec-head" aria-expanded={!folded} onClick={() => onToggle(id)}>
        <span className="sec-head-label">{label}</span>
        <ChevDown className="sec-head-chev" aria-hidden="true" />
      </button>
      <span className="sec-head-actions">{children}</span>
    </div>
  );
}