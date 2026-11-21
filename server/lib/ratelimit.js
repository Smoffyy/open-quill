export function rateLimiter({ windowMs, max, maxKeys = 5000 }) {
  const hits = new Map();
  return function allow(key) {
    const t = Date.now();
    const rec = hits.get(key);
    if (rec && t - rec.start < windowMs) {
      rec.n++;
      return rec.n <= max;
    }
    hits.set(key, { start: t, n: 1 });
    if (hits.size > maxKeys) {
      for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      if (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    }
    return true;
  };
}

export function throttle(limiter, message, keyOf = (req) => req.user?.id || '') {
  return (req, res, next) => (limiter(keyOf(req)) ? next() : res.status(429).json({ error: message }));
}