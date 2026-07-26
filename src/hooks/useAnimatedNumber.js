import { useEffect, useRef, useState } from 'react';

/** Shared check so motion code doesn't fight the user's OS setting. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Tweens a number toward its target with requestAnimationFrame.
 *
 * Used for the progress ring and score counters. A conic-gradient can't be
 * transitioned in CSS, so animating the *value* is what makes the arc sweep
 * instead of jumping. Anyone who has asked for reduced motion gets the final
 * value immediately.
 */
export function useAnimatedNumber(target, { duration = 650 } = {}) {
  const [value, setValue] = useState(target);
  const frameRef = useRef(0);
  const fromRef = useRef(target);

  useEffect(() => {
    if (prefersReducedMotion() || duration <= 0) {
      setValue(target);
      return undefined;
    }

    const from = fromRef.current;
    if (from === target) return undefined;

    const start = performance.now();

    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 3; // easeOutCubic
      const next = from + (target - from) * eased;

      setValue(next);
      fromRef.current = next;

      if (t < 1) frameRef.current = requestAnimationFrame(tick);
      else fromRef.current = target;
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return value;
}
