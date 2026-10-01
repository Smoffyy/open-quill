import { ModelMark } from './Weave.jsx';
import { BRAND_FRAME, MODEL_WEAVE } from '../../lib/brand.js';

export default function BrandMark({ src, className = '', state = 'idle', still = false }) {
  return <ModelMark src={src || MODEL_WEAVE} at={BRAND_FRAME} state={state} still={still} className={'brand-mark' + (className ? ' ' + className : '')} />;
}