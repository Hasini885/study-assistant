import { isValidStudySet, studySetLimitViolation } from '@contract/normalize.js';
import { claimUniqueId, contentId, isWellFormedId } from '@contract/ids.js';

/**
 * Share links: the whole set, compressed, in the URL fragment.
 *
 * No backend storage — nothing to host, nothing to expire, nothing anyone
 * else can read. The fragment (after #) is never sent to the server either,
 * so the set only ever exists in the two browsers that open the link.
 *
 *   #set=d.<base64url of deflate-raw(JSON)>   when CompressionStream exists
 *   #set=j.<base64url of JSON>                otherwise (larger, still works)
 *
 * The receiving side treats the link as untrusted input: size-capped before
 * and after decompression, then validated with the same contract checks as
 * anything from the network or storage.
 */

const PREFIX = 'set=';
const VERSION = 1;
/** Far above any real set (8 cards + 5 questions compresses to ~2 KB) but bounded. */
export const MAX_FRAGMENT_CHARS = 200_000;
const MAX_JSON_BYTES = 1_000_000;

/** @returns {Promise<string>} the fragment, without the leading '#' */
export async function encodeShareFragment(studySet) {
  const json = JSON.stringify(shareablePayload(studySet));
  const bytes = new TextEncoder().encode(json);
  if (typeof CompressionStream === 'function') {
    return `${PREFIX}d.${toBase64Url(await transform(bytes, new CompressionStream('deflate-raw')))}`;
  }
  return `${PREFIX}j.${toBase64Url(bytes)}`;
}

export function isShareFragment(hash) {
  return String(hash ?? '')
    .replace(/^#/, '')
    .startsWith(PREFIX);
}

/**
 * @returns {Promise<{ok: true, studySet: object} | {ok: false, reason: string}>}
 */
export async function decodeShareFragment(hash) {
  const fragment = String(hash ?? '').replace(/^#/, '');
  if (!fragment.startsWith(PREFIX)) return { ok: false, reason: 'This isn’t a study-set link.' };
  if (fragment.length > MAX_FRAGMENT_CHARS) return { ok: false, reason: 'That link is too long to be a study set.' };

  const body = fragment.slice(PREFIX.length);
  const mode = body.slice(0, 2);
  let json;
  try {
    const bytes = fromBase64Url(body.slice(2));
    if (mode === 'd.') {
      if (typeof DecompressionStream !== 'function') {
        return { ok: false, reason: 'This browser can’t open compressed links. Try a newer browser.' };
      }
      json = new TextDecoder().decode(await transform(bytes, new DecompressionStream('deflate-raw'), MAX_JSON_BYTES));
    } else if (mode === 'j.') {
      json = new TextDecoder().decode(bytes);
    } else {
      return { ok: false, reason: 'That link is from a newer version of the app, or was cut short.' };
    }
  } catch {
    return { ok: false, reason: 'That link is damaged — it may have been cut short when it was copied.' };
  }

  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'That link is damaged — it may have been cut short when it was copied.' };
  }

  const studySet = payload && payload.v === VERSION ? fromPayload(payload) : null;
  if (!studySet || !isValidStudySet(studySet) || studySetLimitViolation(studySet)) {
    return { ok: false, reason: 'That link doesn’t contain a usable study set.' };
  }
  return { ok: true, studySet: withIds(studySet) };
}

/**
 * Progress and React keys rely on unique, well-formed ids. Sets this app made
 * always have them; a hand-made link might not, so missing, malformed or
 * repeated ids are replaced.
 */
function withIds(studySet) {
  const fix = (items, prefix, textOf) => {
    const used = new Set();
    return items.map((item) => ({
      ...item,
      id: claimUniqueId(isWellFormedId(item.id) ? item.id : contentId(prefix, textOf(item)), used),
    }));
  };
  return {
    ...studySet,
    flashcards: fix(studySet.flashcards, 'c', (c) => c.front),
    quiz: fix(studySet.quiz, 'q', (q) => q.question),
  };
}

/**
 * Only the content travels. Progress stays with whoever studied it, and
 * `grounded` is dropped: it's the sender's server's verdict about the
 * sender's notes, which the receiver has no way to check.
 */
function shareablePayload(studySet) {
  return {
    v: VERSION,
    title: studySet.title,
    summary: studySet.summary,
    flashcards: studySet.flashcards.map(({ grounded: _g, ...card }) => card),
    quiz: studySet.quiz.map(({ grounded: _g, ...q }) => q),
  };
}

function fromPayload(payload) {
  if (!Array.isArray(payload.flashcards) || !Array.isArray(payload.quiz)) return null;
  const strip = (item) => {
    if (!item || typeof item !== 'object') return item;
    const { grounded: _g, ...rest } = item;
    return rest;
  };
  return {
    title: typeof payload.title === 'string' ? payload.title : 'Shared set',
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    flashcards: payload.flashcards.map(strip),
    quiz: payload.quiz.map(strip),
  };
}

/** Pipes bytes through a (De)CompressionStream, refusing output past `limit`. */
async function transform(bytes, stream, limit = Infinity) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});

  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text) {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('not base64url');
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
