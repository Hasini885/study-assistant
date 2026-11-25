// Runs under `node --test` for now; moves to Vitest with the other frontend tests.
import test from 'node:test';
import assert from 'node:assert/strict';

import { connectionErrorMessage } from '../src/api/messages.js';

test('the connection error names the dev server port in development', () => {
  assert.match(connectionErrorMessage(true), /port 8787/);
});

test('the connection error never mentions the dev port in production', () => {
  // Regression: production users were told to check whether port 8787 was running.
  const message = connectionErrorMessage(false);
  assert.doesNotMatch(message, /8787|port|running/i);
  assert.match(message, /connect/i);
});
