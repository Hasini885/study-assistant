/**
 * Whether this browser has been through the landing page before.
 *
 * Returning visitors go straight to the app — the intro is a first
 * impression, not a gate to sit through every day. "Replay intro" in the
 * sidebar brings it back. Storage failures just mean the intro shows again.
 */

export const INTRO_KEY = 'study-assistant:intro-seen';

export function hasSeenIntro(storage = safeStorage()) {
  try {
    return storage?.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen(storage = safeStorage()) {
  try {
    storage?.setItem(INTRO_KEY, '1');
  } catch {
    /* the intro will just show again next time */
  }
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
