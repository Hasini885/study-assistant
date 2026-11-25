import test from 'node:test';
import assert from 'node:assert/strict';

import { clientIpFromHeaders, createRateLimiter, rateLimitConfig, secondsUntil } from '../rateLimit.js';

const UPSTASH = { UPSTASH_REDIS_REST_URL: 'https://example.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'token' };

/* --------------------------------- config --------------------------------- */

test('rate limiting is disabled when the Upstash env vars are absent', () => {
  assert.equal(rateLimitConfig({}).enabled, false);
  assert.equal(rateLimitConfig({ UPSTASH_REDIS_REST_URL: 'https://x' }).enabled, false);
  assert.equal(rateLimitConfig({ UPSTASH_REDIS_REST_TOKEN: 't' }).enabled, false);
  assert.equal(rateLimitConfig({ UPSTASH_REDIS_REST_URL: '  ', UPSTASH_REDIS_REST_TOKEN: '﻿' }).enabled, false);
});

test('rate limiting is enabled with either naming of the Upstash env vars', () => {
  assert.equal(rateLimitConfig(UPSTASH).enabled, true);
  assert.equal(rateLimitConfig({ KV_REST_API_URL: 'https://x', KV_REST_API_TOKEN: 't' }).enabled, true);
});

test('config strips BOMs, quotes and whitespace from the env values', () => {
  const config = rateLimitConfig({ UPSTASH_REDIS_REST_URL: '﻿"https://x" ', UPSTASH_REDIS_REST_TOKEN: " 'tok'\n" });
  assert.equal(config.url, 'https://x');
  assert.equal(config.token, 'tok');
});

test('config uses sensible defaults and ignores invalid overrides', () => {
  assert.deepEqual(
    { requests: rateLimitConfig({}).requests, window: rateLimitConfig({}).window },
    { requests: 10, window: '60 s' }
  );
  const custom = rateLimitConfig({ RATE_LIMIT_REQUESTS: '25', RATE_LIMIT_WINDOW: '10 m' });
  assert.equal(custom.requests, 25);
  assert.equal(custom.window, '10 m');

  for (const bad of ['0', '-3', '2.5', 'lots']) {
    assert.equal(rateLimitConfig({ RATE_LIMIT_REQUESTS: bad }).requests, 10, bad);
  }
  for (const bad of ['forever', '10', '5 weeks']) {
    assert.equal(rateLimitConfig({ RATE_LIMIT_WINDOW: bad }).window, '60 s', bad);
  }
});

/* --------------------------------- limiter -------------------------------- */

test('a disabled limiter allows everything without creating a client', async () => {
  let created = false;
  const limiter = createRateLimiter({
    env: {},
    createLimiter: async () => {
      created = true;
    },
  });
  assert.equal(limiter.enabled, false);
  assert.deepEqual(await limiter.check('ip:1.2.3.4'), { success: true });
  assert.equal(created, false);
});

test('an enabled limiter passes the identifier through and reports the result', async () => {
  const seen = [];
  let configSeen;
  const limiter = createRateLimiter({
    env: { ...UPSTASH, RATE_LIMIT_REQUESTS: '3' },
    createLimiter: async (config) => {
      configSeen = config;
      return {
        limit: async (id) => {
          seen.push(id);
          return { success: seen.length <= 1, limit: 3, remaining: 0, reset: 123, pending: Promise.resolve() };
        },
      };
    },
  });

  assert.equal(limiter.enabled, true);
  assert.deepEqual(await limiter.check('ip:a'), { success: true, limit: 3, remaining: 0, reset: 123 });
  assert.deepEqual(await limiter.check('ip:a'), { success: false, limit: 3, remaining: 0, reset: 123 });
  assert.deepEqual(seen, ['ip:a', 'ip:a']);
  assert.equal(configSeen.requests, 3);
});

test('the client is created once and reused', async () => {
  let creations = 0;
  const limiter = createRateLimiter({
    env: UPSTASH,
    createLimiter: async () => {
      creations++;
      return { limit: async () => ({ success: true }) };
    },
  });
  await Promise.all([limiter.check('a'), limiter.check('b'), limiter.check('c')]);
  assert.equal(creations, 1);
});

test('the limiter fails open when Upstash errors', async (t) => {
  t.mock.method(console, 'error', () => {});
  const limiter = createRateLimiter({
    env: UPSTASH,
    createLimiter: async () => ({
      limit: async () => {
        throw new Error('ECONNRESET');
      },
    }),
  });
  assert.deepEqual(await limiter.check('ip:a'), { success: true });
  assert.equal(console.error.mock.callCount(), 1);
});

test('a failed client setup is retried on the next request', async (t) => {
  t.mock.method(console, 'error', () => {});
  let attempts = 0;
  const limiter = createRateLimiter({
    env: UPSTASH,
    createLimiter: async () => {
      attempts++;
      if (attempts === 1) throw new Error('import failed');
      return { limit: async () => ({ success: false, reset: 0 }) };
    },
  });
  assert.equal((await limiter.check('a')).success, true); // failed open
  assert.equal((await limiter.check('a')).success, false); // second setup worked
  assert.equal(attempts, 2);
});

/* ------------------------------- client IP -------------------------------- */

test('clientIpFromHeaders prefers x-real-ip', () => {
  assert.equal(clientIpFromHeaders({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }), '1.1.1.1');
});

test('clientIpFromHeaders takes the first x-forwarded-for entry', () => {
  assert.equal(clientIpFromHeaders({ 'x-forwarded-for': ' 3.3.3.3 , 10.0.0.1' }), '3.3.3.3');
  assert.equal(clientIpFromHeaders({ 'x-forwarded-for': ['4.4.4.4, 10.0.0.1'] }), '4.4.4.4');
});

test('clientIpFromHeaders falls back to the socket address, then to "unknown"', () => {
  assert.equal(clientIpFromHeaders({}, '::1'), '::1');
  assert.equal(clientIpFromHeaders({ 'x-forwarded-for': '  ' }, '127.0.0.1'), '127.0.0.1');
  assert.equal(clientIpFromHeaders(undefined), 'unknown');
});

/* ------------------------------ secondsUntil ------------------------------ */

test('secondsUntil rounds up and never returns less than one second', () => {
  assert.equal(secondsUntil(10_500, 0), 11);
  assert.equal(secondsUntil(1_000, 0), 1);
  assert.equal(secondsUntil(0, 5_000), 1); // already passed
  assert.equal(secondsUntil(undefined, 0), 1);
});
