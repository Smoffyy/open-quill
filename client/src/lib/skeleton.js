import { useState, useEffect } from 'react';

export const SKELETON_DELAY = 100;

export function useSkeleton(loading, delay = SKELETON_DELAY) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!loading) { setShow(false); return; }
    const id = setTimeout(() => setShow(true), delay);
    return () => clearTimeout(id);
  }, [loading, delay]);
  return show;
}
