/**
 * What to say when the browser can't reach the API at all.
 *
 * In development that almost always means the Express process isn't running,
 * so naming the port is the most useful thing we can say. In production the
 * API is on the same origin as the page — the user has never heard of port
 * 8787 and can't do anything about it — so the message is about their
 * connection instead.
 *
 * @param {boolean} isDev pass `import.meta.env.DEV`
 */
export function connectionErrorMessage(isDev) {
  return isDev
    ? 'Could not reach the server. Is it running on port 8787?'
    : 'Could not connect. Check your internet connection and try again.';
}
