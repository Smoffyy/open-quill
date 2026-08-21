import net from 'net';

// Deciding whether a request really came from this app's own UI.
//
// Auth is a cookie, so anything a hostile page makes the browser send arrives already
// authenticated. Both the HTTP guard and the websocket handshake ask this module.
//
// The naive check — compare Origin against Host — is wrong as soon as anything proxies.
// Vite's dev proxy rewrites Host to the backend (localhost:3001) while forwarding the
// browser's Origin (localhost:5173) untouched, and sets no x-forwarded-host; a reverse
// proxy in production can do the same. Comparing them there refuses every write from the
// real UI, which is exactly what it did.
//
// Sec-Fetch-Site is the header for this. The *browser* computes it from the document's
// origin against the request URL, before any proxy exists, and it is forwarded unchanged.
// It is the primary signal; everything below it is a fallback for callers that omit it.

const TRUSTED_ORIGINS = new Set(
  String(process.env.TRUSTED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().toLowerCase().replace(/\/+$/, ''))
    .filter(Boolean)
);

export function requestHost(req) {
  const forwarded = String(req?.headers?.['x-forwarded-host'] || '').split(',')[0].trim();
  return (forwarded || String(req?.headers?.host || '')).trim().toLowerCase();
}

function isLoopbackHost(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (net.isIPv6(h)) return h === '::1';
  if (net.isIPv4(h)) return h.startsWith('127.');
  return false;
}

function parseOrigin(value) {
  try {
    const u = new URL(String(value));
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u : null;
  } catch { return null; }
}

export function sameOrigin(req) {
  const headers = req?.headers || {};

  // 1. What the browser itself says. "none" is a user-initiated load (typed URL,
  //    bookmark); a cross-site page can never produce it for a write.
  const site = headers['sec-fetch-site'];
  if (typeof site === 'string' && site) {
    return site === 'same-origin' || site === 'same-site' || site === 'none';
  }

  // 2. No Origin at all: curl, scripts, the CI liveness probe. None of them can be
  //    driven by a hostile page, and refusing them would break every non-browser caller.
  const raw = headers.origin;
  if (raw === undefined || raw === null || raw === '') return true;

  // A literal "null" Origin (sandboxed iframe, data: document) parses as nothing here and
  // is refused: it is not absent, it is an origin that deliberately carries no identity.
  const origin = parseOrigin(raw);
  if (!origin) return false;

  // 3. Explicitly trusted by the operator, for a proxy that rewrites Host in front of a
  //    browser too old to send Sec-Fetch-Site.
  if (TRUSTED_ORIGINS.has(origin.origin.toLowerCase())) return true;

  // 4. The plain unproxied case.
  const host = requestHost(req);
  if (host && origin.host.toLowerCase() === host) return true;

  // 5. Loopback to loopback. This is the dev proxy on a browser that sends no
  //    Sec-Fetch-Site: the page is on localhost:5173 and we are answering on localhost.
  //    It widens the trust boundary only to other servers already running on this
  //    machine, which is the same boundary every local dev tool works within.
  const local = req?.socket?.localAddress;
  if (local && isLoopbackHost(local) && isLoopbackHost(origin.hostname)) return true;

  return false;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function sameOriginGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method) || sameOrigin(req)) return next();
  res.status(403).json({ error: 'cross-origin request refused' });
}
