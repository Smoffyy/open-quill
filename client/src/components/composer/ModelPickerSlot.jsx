import { useLayout } from '../../lib/uselayout.js';

export default function ModelPickerSlot({ at, children }) {
  return useLayout().modelPicker === at ? children : null;
}