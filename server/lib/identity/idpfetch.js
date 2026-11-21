import net from 'net';
import dns from 'dns';
import { Agent } from 'undici';
import { directFetch, recordEgress, EgressBlockedError } from '../egress.js';

const TIMEOUT_MS = 10000;
const MAX_BYTES = 1024 * 1024;

const risky = new net.BlockList();
risky.addSubnet('169.254.0.0', 16, 'ipv4');
risky.addSubnet('fe80::', 10, 'ipv6');
risky.addAddress('100.100.100.200', 'ipv4');
risky.addAddress('168.63.129.16', 'ipv4');
risky.addAddress('fd00:ec2::254', 'ipv6');

const isLoopback = (host) => host === 'localhost' || host === '[::1]' || /^127\./.test(host);

function screened(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err);
    if (addrs.some(a => risky.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'))) {
      recordEgress(hostname, false, 'identity provider resolved to a metadata address');
      return callback(new EgressBlockedError(hostname));
    }
    if (options?.all) callback(null, addrs);
    else callback(null, addrs[0].address, addrs[0].family);
  });
}

const agent = new Agent({ connect: { lookup: screened } });

export const secureEnough = (url) => url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname));

export function identityFetch(hosts) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!hosts.has(url.host) || !secureEnough(url)) {
      recordEgress(url.hostname, false, 'not a configured identity provider');
      throw new EgressBlockedError(url.hostname);
    }
    const res = await directFetch('identity provider', input, { ...init, redirect: 'manual', dispatcher: agent, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (Number(res.headers.get('content-length')) > MAX_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new Error('idp_response_too_large');
    }
    return res;
  };
}