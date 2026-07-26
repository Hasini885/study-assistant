import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './useAnimatedNumber.js';

/**
 * Normalised pointer position, -1 to 1 on each axis, origin at screen centre.
 *
 * Feeds parallax on the landing page. Three things keep it cheap and polite:
 * updates are coalesced into one rAF per frame, coarse pointers (touch) opt
 * out entirely since there is no hover to track, and anyone who asked for
 * reduced motion gets a permanent { x: 0, y: 0 }.
 */
export function usePointerParallax() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const frameRef = useRef(0);
  const pendingRef = useRef(null);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    if (window.matchMedia('(pointer: coarse)').matches) return undefined;

    const flush = () => {
      frameRef.current = 0;
      if (pendingRef.current) setOffset(pendingRef.current);
    };

    const onMove = (event) => {
      pendingRef.current = {
        x: (event.clientX / window.innerWidth - 0.5) * 2,
        y: (event.clientY / window.innerHeight - 0.5) * 2,
      };
      // One state update per painted frame, however fast the mouse moves.
      if (!frameRef.current) frameRef.current = requestAnimationFrame(flush);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return offset;
}
