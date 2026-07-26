import { useEffect, useMemo, useState } from 'react';
import { prefersReducedMotion } from '../hooks/useAnimatedNumber.js';

const PIECES = 26;
const LIFETIME_MS = 2400;

/**
 * A short confetti burst for a perfect round.
 *
 * Deliberately DOM + CSS rather than a canvas library: 26 absolutely
 * positioned spans with per-piece custom properties, animated by one keyframe
 * rule. It costs nothing to ship, unmounts itself when the animation is over,
 * and renders nothing at all under prefers-reduced-motion.
 */
export function Confetti({ trigger }) {
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!trigger || prefersReducedMotion()) return undefined;
    setLive(true);
    const timer = setTimeout(() => setLive(false), LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [trigger]);

  // Regenerated per burst so two bursts don't look identical.
  const pieces = useMemo(() => {
    if (!live) return [];
    return Array.from({ length: PIECES }, (_, i) => ({
      id: i,
      x: Math.round((Math.random() - 0.5) * 320),
      y: Math.round(-120 - Math.random() * 180),
      turn: Math.round(Math.random() * 720 - 360),
      delay: Math.round(Math.random() * 220),
      scale: (0.6 + Math.random() * 0.7).toFixed(2),
      hue: [0, 1, 2, 3][i % 4],
    }));
  }, [live]);

  if (!live) return null;

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className={`confetti__bit confetti__bit--${piece.hue}`}
          style={{
            '--x': `${piece.x}px`,
            '--y': `${piece.y}px`,
            '--turn': `${piece.turn}deg`,
            '--delay': `${piece.delay}ms`,
            '--scale': piece.scale,
          }}
        />
      ))}
    </div>
  );
}
