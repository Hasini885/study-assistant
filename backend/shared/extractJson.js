/**
 * Tolerant JSON extraction.
 *
 * Even with JSON mode enabled, models leak prose, wrap output in markdown
 * fences, emit trailing commas, or use smart quotes. Each strategy below is a
 * real failure I hit while testing; they run cheapest-first and stop at the
 * first one that parses.
 *
 * Pure, dependency-free, and used on both the server and the client.
 */

/** @returns {{ok: true, value: unknown, strategy: string} | {ok: false, error: string}} */
export function extractJson(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, error: 'Model returned an empty response.' };
  }

  const strategies = [
    ['direct', (s) => s],
    ['unfenced', stripCodeFences],
    ['sliced', sliceToOutermostJson],
    ['repaired', (s) => repairCommonBreakage(sliceToOutermostJson(stripCodeFences(s)))],
  ];

  for (const [strategy, transform] of strategies) {
    let candidate;
    try {
      candidate = transform(text);
    } catch {
      continue; // A transform that can't find anything just means: try the next one.
    }
    if (typeof candidate !== 'string' || candidate.trim() === '') continue;
    try {
      return { ok: true, value: JSON.parse(candidate), strategy };
    } catch {
      /* try the next strategy */
    }
  }

  return { ok: false, error: 'Model response was not valid JSON.' };
}

/** Remove ```json ... ``` (or bare ```) wrappers. */
function stripCodeFences(text) {
  const fenced = text.match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1];
  // An unterminated fence happens when the response is cut off by max_tokens.
  return text.replace(/^\s*```(?:json|javascript|js)?\s*/i, '');
}

/**
 * Grab the outermost {...} or [...] and drop any prose around it
 * ("Sure! Here are your flashcards:"). Brace counting is string- and
 * escape-aware, so a `}` inside a value doesn't end the scan early.
 */
function sliceToOutermostJson(text) {
  const start = firstIndexOfAny(text, ['{', '[']);
  if (start === -1) return text;

  const opener = text[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === opener) depth++;
    else if (char === closer) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  // Unbalanced: the response was truncated mid-object. Return what we have so
  // repairCommonBreakage gets a chance to close it.
  return text.slice(start);
}

/**
 * Last-resort fixes for output that is *nearly* JSON.
 *
 * Every rewrite here applies only to the structure *between* string values.
 * Inside a string, “curly quotes”, a ", ]" or the word NaN are just content —
 * rewriting them there corrupts the text at best and, for quotes, ends the
 * string early and breaks the very parse this is trying to rescue.
 */
function repairCommonBreakage(text) {
  // Smart quotes used *as* JSON delimiters, from models that "helpfully"
  // prettify text. Curly quotes inside a value are left alone.
  let out = normaliseQuoteDelimiters(text);

  out = mapOutsideStrings(out, (segment) =>
    segment
      // JS literals that aren't valid JSON.
      .replace(/:\s*(NaN|Infinity|-Infinity|undefined)\s*([,}\]])/g, ': null$2')
      // Trailing commas before a closing brace/bracket.
      .replace(/,\s*([}\]])/g, '$1')
  );

  // Truncated output: close whatever is still open. Recovers a partial deck
  // instead of throwing the whole response away.
  out = closeUnterminated(out);

  return out;
}

const CURLY_DOUBLE = new Set(['“', '”']);

/**
 * Turns curly quotes that delimit a string into straight ones, without
 * touching curly quotes that are part of a string's content.
 *
 * Three states: between values, inside a "straight" string, and inside a
 * string that a curly quote opened. Only the last needs rewriting — its
 * delimiters become `"`, and any straight `"` inside it is escaped so it stays
 * content.
 */
function normaliseQuoteDelimiters(text) {
  let out = '';
  let mode = 'outside'; // outside | straight | curly

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (mode === 'outside') {
      if (char === '"') mode = 'straight';
      else if (CURLY_DOUBLE.has(char)) {
        out += '"';
        mode = 'curly';
        continue;
      }
      out += char;
    } else if (char === '\\') {
      // Copy an escape sequence verbatim, whichever kind of string we're in.
      out += char + (text[i + 1] ?? '');
      i++;
    } else if (mode === 'straight') {
      out += char;
      if (char === '"') mode = 'outside';
    } else if (CURLY_DOUBLE.has(char)) {
      out += '"';
      mode = 'outside';
    } else {
      out += char === '"' ? '\\"' : char;
    }
  }

  return out;
}

/**
 * Applies `transform` to the parts of `text` that are not inside a string
 * literal. An unterminated string at the end (a truncated response) counts as
 * string content and is passed through untouched.
 */
function mapOutsideStrings(text, transform) {
  let out = '';
  let segmentStart = 0;
  let inString = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === '\\') i++;
      else if (char === '"') {
        inString = false;
        out += text.slice(segmentStart, i + 1);
        segmentStart = i + 1;
      }
    } else if (char === '"') {
      out += transform(text.slice(segmentStart, i));
      segmentStart = i;
      inString = true;
    }
  }

  const rest = text.slice(segmentStart);
  return out + (inString ? rest : transform(rest));
}

function closeUnterminated(text) {
  const stack = [];
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{' || char === '[') stack.push(char);
    else if (char === '}' || char === ']') stack.pop();
  }

  if (!inString && stack.length === 0) return text;

  let out = text;
  if (inString) out += '"';
  // Drop a dangling `"key":` or trailing comma left by the truncation.
  out = out.replace(/,?\s*"[^"]*"\s*:\s*$/, '').replace(/,\s*$/, '');

  while (stack.length) {
    out += stack.pop() === '{' ? '}' : ']';
  }
  return out;
}

function firstIndexOfAny(text, chars) {
  const found = chars.map((c) => text.indexOf(c)).filter((i) => i !== -1);
  return found.length ? Math.min(...found) : -1;
}
