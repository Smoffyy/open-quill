import dns from 'dns';
import net from 'net';
import { getSetting } from '../db.js';

const lookup = dns.promises.lookup;

export function isPrivateAddress(addr) {
  const ip = String(addr || '').trim().replace(/^\[|\]$/g, '').split('%')[0];
  const v = net.isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return false;
}

function isPrivateV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateV6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateV4(mapped[1]);
  const head = lower.split(':')[0];
  if (!head) return false;
  const n = parseInt(head, 16);
  if (Number.isNaN(n)) return false;
  if ((n & 0xfe00) === 0xfc00) return true;
  if ((n & 0xffc0) === 0xfe80) return true;
  if ((n & 0xff00) === 0xff00) return true;
  return false;
}

let rawFetch = null;

export function unguardedFetch(input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
  try { if (url) recordEgress(new URL(url).hostname, true, 'web search'); } catch {}
  return (rawFetch || globalThis.fetch)(input, init);
}

export function webSearchEgressAllowed() {
  return getSetting('egress_allow_websearch', '1') === '1';
}

export function egressLocalOnly() {
  return getSetting('egress_local_only', '1') === '1';
}

export function egressAllowlist() {
  try {
    const raw = JSON.parse(getSetting('egress_allowlist', '[]'));
    return Array.isArray(raw) ? raw.map(h => String(h).trim().toLowerCase()).filter(Boolean) : [];
  } catch { return []; }
}

export function hostAllowed(host, list) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  return list.some(entry => {
    if (entry === '*') return true;
    if (entry.startsWith('*.')) {
      const base = entry.slice(2);
      return h === base || h.endsWith('.' + base);
    }
    return h === entry;
  });
}

const LOG_MAX = 500;
const log = [];
const counts = { allowed: 0, blocked: 0 };

export function recordEgress(host, allowed, reason) {
  counts[allowed ? 'allowed' : 'blocked']++;
  const last = log[log.length - 1];
  if (last && last.host === host && last.allowed === allowed && Date.now() - last.last < 60000) {
    last.count++;
    last.last = Date.now();
    return;
  }
  log.push({ host, allowed, reason: reason || '', count: 1, first: Date.now(), last: Date.now() });
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
}

export function egressLog() {
  return { entries: log.slice().reverse(), allowed: counts.allowed, blocked: counts.blocked };
}

export function clearEgressLog() {
  log.length = 0;
  counts.allowed = 0;
  counts.blocked = 0;
}

export class EgressBlockedError extends Error {
  constructor(host) {
    super(`Blocked outbound connection to "${host}". Local only is on, so this server may reach loopback and private network addresses but not the internet. Add the host under Admin > Safety to allow it.`);
    this.name = 'EgressBlockedError';
    this.code = 'EGRESS_BLOCKED';
    this.host = host;
  }
}

export async function assertAllowed(url) {
  if (!egressLocalOnly()) return;
  let parsed;
  try { parsed = new URL(String(url)); } catch { return; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (hostAllowed(host, egressAllowlist())) { recordEgress(host, true, 'allowlisted'); return; }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) { recordEgress(host, true, 'private address'); return; }
    recordEgress(host, false, 'public address');
    throw new EgressBlockedError(host);
  }
  let addrs;
  try { addrs = await lookup(host, { all: true }); }
  catch { recordEgress(host, false, 'name did not resolve'); throw new EgressBlockedError(host); }
  if (!addrs.length || !addrs.every(a => isPrivateAddress(a.address))) {
    recordEgress(host, false, 'resolves to a public address');
    throw new EgressBlockedError(host);
  }
  recordEgress(host, true, 'resolves to a private address');
}

export function installEgressGuard(target = globalThis) {
  if (target.__oqEgressGuard) return target.fetch;
  const inner = target.fetch;
  rawFetch = inner;
  const guarded = async function fetch(input, init) {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : input && typeof input.url === 'string' ? input.url : '';
    if (url) await assertAllowed(url);
    return inner(input, init);
  };
  target.fetch = guarded;
  target.__oqEgressGuard = true;
  return guarded;
}
