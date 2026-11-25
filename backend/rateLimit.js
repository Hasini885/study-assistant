/**
 * Per-IP rate limiting for the endpoints that spend model quota.
 *
 * WHY UPSTASH
 * Serverless functions share no memory: every instance (and every cold start)
 * would get its own in-memory counter, so a limit kept in process is no limit
 * at all on Vercel. The count has to live somewhere shared. Upstash Redis is
 * reached over HTTPS — no connection pool to keep warm between invocations —
 * and its free tier comfortably covers a project like this.
 *
 * OPTIONAL BY DESIGN
 * Without UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN this is a no-op,
 * so local development and forks work with nothing but a Groq key. (Vercel's
 * Upstash integration names the same values KV_REST_API_URL / _TOKEN; either
 * pair works.)
 *
 * FAILS OPEN
 * If Upstash is unreachable or slow, the request is allowed through and the
 * failure is logged. Rate limiting protects the quota; it must never be the
 * reason the app is down.
 */

const DEFAULT_REQUESTS = 10;
const DEFAULT_WINDOW = '60 s';
const UPSTASH_TIMEOUT_MS = 2000;

/** Upstash's duration syntax: "60 s", "10m", "1 h", "500 ms", "1 d". */
const WINDOW_PATTERN = /^\d+\s*(ms|s|m|h|d)$/;

/**
 * Reads the limiter configuration from the environment.
 * @returns {{enabled: boolean, url: string, token: string, requests: number, window: string}}
 */
export function rateLimitConfig(env = {}) {
  const url = cleanEnvValue(env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL);
  const token = cleanEnvValue(env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN);

  const requested = Number(cleanEnvValue(env.RATE_LIMIT_REQUESTS));
  const requests = Number.isInteger(requested) && requested > 0 ? requested : DEFAULT_REQUESTS;

  const windowValue = cleanEnvValue(env.RATE_LIMIT_WINDOW);
  const window = WINDOW_PATTERN.test(windowValue) ? windowValue : DEFAULT_WINDOW;

  return { enabled: Boolean(url && token), url, token, requests, window };
}

/**
 * @param {object} [options]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {(config: ReturnType<typeof rateLimitConfig>) => Promise<{limit: (id: string) => Promise<{success: boolean, limit: number, remaining: number, reset: number}>}>} [options.createLimiter]
 *   injectable for tests; defaults to Upstash
 */
export function createRateLimiter({ env = process.env, createLimiter = createUpstashLimiter } = {}) {
  const config = rateLimitConfig(env);

  if (!config.enabled) {
    return { enabled: false, check: async () => ({ success: true }) };
  }

  let limiterPromise = null;

  return {
    enabled: true,
    /** @returns {Promise<{success: boolean, limit?: number, remaining?: number, reset?: number}>} */
    async check(identifier) {
      try {
        limiterPromise ??= createLimiter(config);
        const limiter = await limiterPromise;
        const { success, limit, remaining, reset } = await limiter.limit(identifier);
        return { success, limit, remaining, reset };
      } catch (error) {
        limiterPromise = null; // let the next request try to set it up again
        console.error('[ratelimit] check failed, allowing the request:', error?.message ?? error);
        return { success: true };
      }
    },
  };
}

/**
 * The client's IP as reported by the platform's proxy.
 *
 * Only use this where a trusted proxy sets these headers — on Vercel the edge
 * overwrites both, so a client can't spoof them. A bare Node server exposed to
 * the internet must use the socket address instead, or anyone could pick
 * their own bucket by sending a header.
 */
export function clientIpFromHeaders(headers = {}, fallback = '') {
  const realIp = headerValue(headers, 'x-real-ip');
  if (realIp) return realIp;

  const forwarded = headerValue(headers, 'x-forwarded-for');
  const first = forwarded.split(',')[0].trim();
  if (first) return first;

  return fallback || 'unknown';
}

/** Seconds until `resetAt` (epoch ms), at least 1 — a Retry-After of 0 invites a hot loop. */
export function secondsUntil(resetAt, now = Date.now()) {
  if (!Number.isFinite(resetAt)) return 1;
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

async function createUpstashLimiter({ url, token, requests, window }) {
  // Imported lazily so deployments without Upstash never load it.
  const [{ Ratelimit }, { Redis }] = await Promise.all([import('@upstash/ratelimit'), import('@upstash/redis')]);
  return new Ratelimit({
    redis: new Redis({ url, token }),
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix: 'study-assistant:ratelimit',
    // Upstash's own fail-open: past this, the request is allowed through.
    timeout: UPSTASH_TIMEOUT_MS,
  });
}

function headerValue(headers, name) {
  const value = headers?.[name];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' ? single.trim() : '';
}

/** Same passengers as the Groq key: a BOM, whitespace, wrapping quotes. */
function cleanEnvValue(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}
