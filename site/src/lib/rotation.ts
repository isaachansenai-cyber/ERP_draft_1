import { useCallback, useEffect, useState } from 'react';

/** Hero photos change every 5 seconds (BUILD_PLAN §6.3). */
export const ROTATE_MS = 5000;

export function nextIndex(index: number, count: number): number {
  return count > 0 ? (index + 1) % count : 0;
}

/**
 * Auto-advancing slide index with a pause control (WCAG 2.2.2). It starts
 * paused for visitors who prefer reduced motion, and stops if that preference
 * turns on while the page is open.
 */
export function useRotation(count: number, reducedMotion: boolean) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(!reducedMotion);

  useEffect(() => {
    if (reducedMotion) setPlaying(false);
  }, [reducedMotion]);

  useEffect(() => {
    if (!playing || count < 2) return;
    const timer = window.setInterval(() => setIndex((i) => nextIndex(i, count)), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [playing, count]);

  const toggle = useCallback(() => setPlaying((p) => !p), []);
  return { index, playing, toggle, goTo: setIndex };
}
