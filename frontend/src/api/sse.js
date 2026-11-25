/**
 * Incremental server-sent-events parsing for a fetch() body.
 *
 * EventSource can't send a POST body, so the stream is read from fetch and
 * parsed here. Pure: feed it text as it arrives and it returns the complete
 * events plus whatever is left over for next time.
 *
 * @param {string} buffer text received so far that hasn't been parsed yet
 * @returns {{events: Array<{event: string, data: string}>, rest: string}}
 */
export function parseSseChunk(buffer) {
  const normalized = buffer.replace(/\r\n?/g, '\n');
  const blocks = normalized.split('\n\n');
  const rest = blocks.pop(); // incomplete until a blank line ends it
  const events = [];

  for (const block of blocks) {
    let event = 'message';
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue; // comment / keep-alive
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) events.push({ event, data: data.join('\n') });
  }

  return { events, rest };
}
