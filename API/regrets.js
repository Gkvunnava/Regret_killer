import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const COUNT_KEY = 'regrets:count';
const WALL_KEY = 'regrets:wall';
const MAX_WALL = 40;

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const [count, wall] = await Promise.all([
        redis.get(COUNT_KEY),
        redis.lrange(WALL_KEY, 0, MAX_WALL - 1),
      ]);

      return res.status(200).json({
        count: Number(count) || 0,
        wall: (wall || []).map(parseEntry).filter(Boolean),
      });
    }

    if (req.method === 'POST') {
      const { hash } = req.body || {};

      if (typeof hash !== 'string' || !/^[a-f0-9]{12}$/.test(hash)) {
        return res.status(400).json({ error: 'Send a 12-character hex hash.' });
      }

      const entry = JSON.stringify({ h: hash, t: Date.now() });

      const [count] = await Promise.all([
        redis.incr(COUNT_KEY),
        redis.lpush(WALL_KEY, entry),
      ]);
      await redis.ltrim(WALL_KEY, 0, MAX_WALL - 1);

      const wall = await redis.lrange(WALL_KEY, 0, MAX_WALL - 1);

      return res.status(200).json({
        count: Number(count) || 0,
        wall: (wall || []).map(parseEntry).filter(Boolean),
      });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  } catch (err) {
    console.error('ledger error:', err);
    return res.status(500).json({ error: 'Ledger unavailable.' });
  }
}

function parseEntry(item) {
  if (item && typeof item === 'object') return item;
  try {
    return JSON.parse(item);
  } catch {
    return null;
  }
}
