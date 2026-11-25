import { describe, expect, test } from 'vitest';
import { connectionErrorMessage } from '../src/api/messages.js';

describe('connectionErrorMessage', () => {
  test('names the dev server port in development', () => {
    expect(connectionErrorMessage(true)).toMatch(/port 8787/);
  });

  test('never mentions the dev port in production', () => {
    // Regression: production users were told to check whether port 8787 was running.
    const message = connectionErrorMessage(false);
    expect(message).not.toMatch(/8787|port|running/i);
    expect(message).toMatch(/connect/i);
  });
});
