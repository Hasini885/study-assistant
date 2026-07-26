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

/** Last-resort fixes for output that is *nearly* JSON. */
function repairCommonBreakage(text) {
  let out = text;

  // Smart quotes from models that "helpfully" prettify text.
  out = out.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  // JS literals that aren't valid JSON.
  out = out.replace(/:\s*(NaN|Infinity|-Infinity|undefined)\s*([,}\]])/g, ': null$2');

  // Trailing commas before a closing brace/bracket.
  out = out.replace(/,\s*([}\]])/g, '$1');

  // Truncated output: close whatever is still open. Recovers a partial deck
  // instead of throwing the whole response away.
  out = closeUnterminated(out);

  return out;
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
