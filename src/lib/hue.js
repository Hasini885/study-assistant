/**
 * Derives a stable hue from a string.
 *
 * Every study set gets its own accent colour, taken from its title. It's
 * deterministic, so reopening a saved session brings back the same colour and
 * "the blue set" stays a usable way to think about it.
 *
 * The green–yellow band around 70–150° is skipped: those hues read as
 * "correct" in this UI, and an accent that looks like the right-answer colour
 * would be actively confusing in a quiz.
 */
export function hueFromString(text) {
  const source = String(text || '').trim() || 'study set';

  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) % 100_000;
  }

  // Pick from 280° of usable arc, then push past the reserved green band.
  const hue = hash % 280;
  return hue < 70 ? hue : hue + 80;
}
