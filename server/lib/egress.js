import dns from 'dns';
import net from 'net';
import { Agent } from 'undici';
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
  if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return true;
  if (a >= 224) return true;
  return false;
}

function expandV6(ip) {
  let text = ip;
  let embedded = null;
  const dotted = /:((?:\d{1,3}\.){3}\d{1,3})$/.exec(text);
  if (dotted) {
    const parts = dotted[1].split('.').map(Number);
    if (parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    embedded = dotted[1];
    text = text.slice(0, dotted.index) + ':' +
      ((parts[0] << 8) | parts[1]).toString(16) + ':' + ((parts[2] << 8) | parts[3]).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let words;
  if (halves.length === 1) {
    if (head.length !== 8) return null;
    words = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    words = [...head, ...Array(fill).fill('0'), ...tail];
  }
  const groups = words.map(h => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return groups.some(g => !Number.isInteger(g)) ? null : { groups, embedded };
}

function isPrivateV6(ip) {
  const parsed = expandV6(ip.toLowerCase());
  if (!parsed) return false;
  const { groups, embedded } = parsed;
  if (embedded && groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) return isPrivateV4(embedded);
  if (groups.every(g => g === 0)) return true;
  if (groups.slice(0, 7).every(g => g === 0) && groups[7] === 1) return true;
  const n = groups[0];
  if ((n & 0xfe00) === 0xfc00) return true;
  if ((n & 0xffc0) === 0xfe80) return true;
  if ((n & 0xff00) === 0xff00) return true;
  return false;
}

let rawFetch = null;

export function directFetch(reason, input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input?.url || '';
  try { if (url) recordEgress(new URL(url).hostname, true, reason); } catch {}
  return (rawFetch || globalThis.fetch)(input, init);
}

export function unguardedFetch(input, init) {
  return directFetch('web search', input, init);
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

const MAX_REDIRECTS = 5;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

export function connectLookup(hostname, options, callback) {
  lookup(hostname, { ...options, all: true }).then(addrs => {
    if (egressLocalOnly() && !hostAllowed(hostname, egressAllowlist()) && (!addrs.length || !addrs.every(a => isPrivateAddress(a.address)))) {
      recordEgress(hostname, false, 'resolved to a public address on connect');
      return callback(new EgressBlockedError(hostname));
    }
    if (options?.all) callback(null, addrs);
    else callback(null, addrs[0].address, addrs[0].family);
  }, callback);
}

const guardedAgent = new Agent({ connect: { lookup: connectLookup } });

function urlOf(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input && typeof input.url === 'string' ? input.url : '';
}

function redirected(request, status, from, to) {
  const headers = new Headers(request.headers);
  if (to.origin !== from.origin) for (const h of CREDENTIAL_HEADERS) headers.delete(h);
  const method = String(request.method || 'GET').toUpperCase();
  if ((status === 303 && method !== 'HEAD') || ((status === 301 || status === 302) && method === 'POST')) {
    headers.delete('content-type');
    headers.delete('content-length');
    return { ...request, method: 'GET', body: undefined, headers };
  }
  return { ...request, headers };
}

async function guardedRequest(inner, input, init = {}) {
  let url = urlOf(input);
  if (url) await assertAllowed(url);
  if (!egressLocalOnly()) return inner(input, init);
  if (typeof input !== 'string' && !(input instanceof URL) && url) {
    init = { method: input.method, headers: input.headers, body: input.body, signal: input.signal, ...(input.body ? { duplex: 'half' } : {}), ...init };
    input = url;
  }
  if (init.redirect === 'manual' || init.redirect === 'error') return inner(input, { ...init, dispatcher: init.dispatcher || guardedAgent });
  let request = { ...init, redirect: 'manual', dispatcher: init.dispatcher || guardedAgent };
  let res = await inner(input, request);
  for (let hop = 0; REDIRECTS.has(res.status) && res.headers.has('location'); hop++) {
    if (hop >= MAX_REDIRECTS) throw new TypeError('fetch failed: too many redirects');
    const from = new URL(url);
    const to = new URL(res.headers.get('location'), from);
    await res.body?.cancel().catch(() => {});
    await assertAllowed(to.href);
    request = redirected(request, res.status, from, to);
    url = to.href;
    res = await inner(url, request);
  }
  return res;
}

export function installEgressGuard(target = globalThis) {
  if (target.__oqEgressGuard) return target.fetch;
  const inner = target.fetch;
  rawFetch = inner;
  const guarded = function fetch(input, init) {
    return guardedRequest(inner, input, init);
  };
  target.fetch = guarded;
  target.__oqEgressGuard = true;
  return guarded;
}