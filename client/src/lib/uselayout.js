import { createContext, useContext } from 'react';
import { LAYOUTS } from './layout.js';

export const LayoutContext = createContext(LAYOUTS.card);

export function useLayout() {
  return useContext(LayoutContext);
}