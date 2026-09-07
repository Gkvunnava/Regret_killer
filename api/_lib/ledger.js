import { Redis } from '@upstash/redis';

export const COUNT_KEY = 'regrets:count';
export const WALL_KEY = 'regrets:wall';
export const MAX_WALL = 40;

// A used payment id is remembered for 90 days. Long enough that a stolen
// signature can never be replayed while anyone would still care.
const PAYMENT_TTL_SECONDS = 60 * 60 * 24 * 90;

// Vercel injects UPSTASH_REDIS_REST_* when the store comes from the Upstash
// marketplace entry and KV_REST_API_* when it is provisioned as Vercel KV.
// Redis.fromEnv() only knows the first pair, so accept either.
function credentials() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

let cached;

// Resolved once, and never throws on the hot path, so a missing ledger degrades
// quietly instead of turning a successful payment into a 500.
export function getRedis() {
  if (cached === undefined) {
    const creds = credentials();
    if (!creds) {
      console.error('ledger: no redis credentials (UPSTASH_REDIS_REST_* or KV_REST_API_*)');
      cached = null;
    } else {
      cached = new Redis(creds);
    }
  }
  if (!cached) throw new Error('Ledger is not configured.');
  return cached;
}

export function parseEntry(item) {
  if (item && typeof item === 'object') return item;
  try {
    return JSON.parse(item);
  } catch {
    return null;
  }
}

export async function readLedger() {
  const redis = getRedis();
  const [count, wall] = await Promise.all([
    redis.get(COUNT_KEY),
    redis.lrange(WALL_KEY, 0, MAX_WALL - 1),
  ]);
  return {
    count: Number(count) || 0,
    wall: (wall || []).map(parseEntry).filter(Boolean),
  };
}

// Returns true the first time a payment id is seen, false on every replay.
export async function claimPayment(paymentId) {
  const redis = getRedis();
  const claimed = await redis.set(`regrets:payment:${paymentId}`, 1, {
    nx: true,
    ex: PAYMENT_TTL_SECONDS,
  });
  return claimed === 'OK';
}

export async function recordRegret(hash) {
  const redis = getRedis();
  const entry = JSON.stringify({ h: hash, t: Date.now() });

  const [count] = await Promise.all([
    redis.incr(COUNT_KEY),
    redis.lpush(WALL_KEY, entry),
  ]);
  await redis.ltrim(WALL_KEY, 0, MAX_WALL - 1);

  const wall = await redis.lrange(WALL_KEY, 0, MAX_WALL - 1);

  return {
    count: Number(count) || 0,
    wall: (wall || []).map(parseEntry).filter(Boolean),
  };
}
