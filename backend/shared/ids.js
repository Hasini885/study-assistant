/**
 * Stable identities for flashcards and quiz questions.
 *
 * Study progress (known/review marks, spaced-repetition schedules) is keyed by
 * item id, so an id has to survive two things:
 *
 *  1. Refinement. The model is sent each item's id and asked to keep it on
 *     anything it doesn't delete. Models mostly comply.
 *  2. Models not complying. When an id comes back missing, invented or
 *     duplicated, the item is matched to the previous set by its content
 *     instead. Ids that the normalizer generates are themselves a hash of the
 *     content, so an unchanged card gets the same id even with no help at all.
 *
 * Pure and dependency-free, like the rest of the contract.
 */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Is this usable as an id we'd accept from the model or storage? */
export function isWellFormedId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** Case- and whitespace-insensitive form of a text, for matching. */
export function matchKey(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 32-bit FNV-1a, base 36. Not cryptographic — just short and stable. */
export function hashString(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** An id derived from an item's content: the same text always gets the same id. */
export function contentId(prefix, text) {
  return `${prefix}-${hashString(matchKey(text))}`;
}

/** `base`, or `base-2`, `base-3`… — whichever isn't in `used` yet. Adds it to `used`. */
export function claimUniqueId(base, used) {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

/**
 * Gives items in a refined set the ids of the items they came from.
 *
 * Three passes, most trustworthy first:
 *  1. an id the model kept that exists in the previous set (first claim wins)
 *  2. the same main text as an unclaimed previous item (front / question)
 *  3. the same answer text as an unclaimed previous item (back) — catches a
 *     card whose question was reworded but whose answer wasn't
 * Anything left is new; it keeps its own id unless that collides with an id
 * already in use, in which case it gets a fresh one.
 *
 * @returns {{studySet: object, matched: number}} a new set (inputs are not mutated)
 */
export function reconcileIds(previous, next) {
  const flash = reconcileList(previous?.flashcards ?? [], next.flashcards, 'c', [
    (item) => item.front,
    (item) => item.back,
  ]);
  const quiz = reconcileList(previous?.quiz ?? [], next.quiz, 'q', [(item) => item.question]);

  return {
    studySet: { ...next, flashcards: flash.items, quiz: quiz.items },
    matched: flash.matched + quiz.matched,
  };
}

function reconcileList(previousItems, nextItems, prefix, textGetters) {
  const previousIds = new Set(previousItems.map((item) => item.id).filter(isWellFormedId));
  const claimed = new Set();
  const ids = new Array(nextItems.length).fill(null);

  // Pass 1: ids the model kept.
  nextItems.forEach((item, i) => {
    if (previousIds.has(item.id) && !claimed.has(item.id)) {
      ids[i] = item.id;
      claimed.add(item.id);
    }
  });

  // Passes 2+: content matches against previous items nobody has claimed.
  for (const getText of textGetters) {
    const unclaimedByText = new Map();
    for (const item of previousItems) {
      if (!isWellFormedId(item.id) || claimed.has(item.id)) continue;
      const key = matchKey(getText(item));
      if (key && !unclaimedByText.has(key)) unclaimedByText.set(key, item.id);
    }
    nextItems.forEach((item, i) => {
      if (ids[i]) return;
      const id = unclaimedByText.get(matchKey(getText(item)));
      if (id && !claimed.has(id)) {
        ids[i] = id;
        claimed.add(id);
      }
    });
  }

  // New items: keep their own id unless something already holds it.
  const used = new Set([...previousIds, ...claimed]);
  let matched = 0;
  const items = nextItems.map((item, i) => {
    if (ids[i]) {
      matched++;
      return { ...item, id: ids[i] };
    }
    const own = isWellFormedId(item.id) && !used.has(item.id) ? item.id : null;
    const id = own ? claimUniqueId(own, used) : claimUniqueId(contentId(prefix, textGetters[0](item)), used);
    return { ...item, id };
  });

  return { items, matched };
}
