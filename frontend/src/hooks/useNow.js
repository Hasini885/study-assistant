import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every `intervalMs`. Due counts depend on the
 * clock — a card answered "Again" comes due ten minutes later, and everything
 * scheduled for tomorrow comes due at midnight — so they re-evaluate on a slow
 * tick rather than only when something else happens to re-render.
 */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
