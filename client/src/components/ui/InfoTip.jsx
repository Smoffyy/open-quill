import Tip from './Tip.jsx';
import { Info } from './icons.jsx';

export default function InfoTip({ text }) {
  if (!text) return null;
  return (
    <Tip label={text} tone="docs" toggle>
      <button className="mdoc-info" aria-label={text}>
        <Info />
      </button>
    </Tip>
  );
}