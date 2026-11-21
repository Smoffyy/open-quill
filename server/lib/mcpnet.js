import net from 'net';
import os from 'os';
import dns from 'dns';
import { Agent, buildConnector } from 'undici';
import { getSetting, setSetting } from '../db.js';
import { connectLookup, hostAllowed, EgressBlockedError } from './egress.js';

const HOSTS_MAX = 100;

const risky = new net.BlockList();
risky.addSubnet('169.254.0.0', 16, 'ipv4');
risky.addSubnet('fe80::', 10, 'ipv6');
risky.addAddress('100.100.100.200', 'ipv4');
risky.addAddress('168.63.129.16', 'ipv4');
risky.addAddress('fd00:ec2::254', 'ipv6');

const loopback = new net.BlockList();
loopback.addSubnet('127.0.0.0', 8, 'ipv4');
loopback.addAddress('0.0.0.0', 'ipv4');
loopback.addAddress('::1', 'ipv6');
loopback.addAddress('::', 'ipv6');

export class MemberTargetError extends Error {
  constructor(message, host) {
    super(message);
    this.name = 'MemberTargetError';
    this.code = 'MCP_TARGET_BLOCKED';
    this.host = host;
  }
}

function plainIp(address) {
  const ip = String(address || '').replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  return mapped ? mapped[1] : ip;
}

function family(ip) {
  return net.isIP(ip) === 6 ? 'ipv6' : 'ipv4';
}

function ownPort() {
  return Number(process.env.PORT) || 3001;
}

function ownAddress(ip) {
  if (loopback.check(ip, family(ip))) return true;
  return Object.values(os.networkInterfaces()).flat().some(i => i && plainIp(i.address) === ip);
}

export function memberPolicy() {
  const raw = getSetting('mcp_member_hosts', []);
  const hosts = Array.isArray(raw) ? raw.map(h => String(h).trim().toLowerCase()).filter(Boolean) : [];
  return { allowed: getSetting('mcp_member_servers', true) !== false, hosts };
}

export function setMemberPolicy({ allowed, hosts }) {
  const cur = memberPolicy();
  const next = {
    allowed: allowed === undefined ? cur.allowed : !!allowed,
    hosts: hosts === undefined ? cur.hosts : [...new Set((Array.isArray(hosts) ? hosts : [])
      .map(h => String(h).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0])
      .filter(h => h && /^[a-z0-9.*:_[\]-]+$/.test(h)))].slice(0, HOSTS_MAX)
  };
  setSetting('mcp_member_servers', next.allowed);
  setSetting('mcp_member_hosts', next.hosts);
  return next;
}

export function screenAddress(address, port) {
  const ip = plainIp(address);
  if (!net.isIP(ip)) return '';
  if (risky.check(ip, family(ip))) return 'Member connectors cannot reach link-local or cloud metadata addresses.';
  if (Number(port) === ownPort() && ownAddress(ip)) return 'Member connectors cannot point at this server itself.';
  return '';
}

function hostOf(url) {
  return url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
}

function portOf(url) {
  return Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
}

function screenTarget(host, port) {
  const policy = memberPolicy();
  if (!policy.allowed) return 'An admin has turned off member connectors.';
  if (policy.hosts.length && !hostAllowed(host, policy.hosts)) return 'An admin limits member connectors to approved hosts, and this host is not one of them.';
  if (net.isIP(host)) return screenAddress(host, port);
  if (host === 'localhost' && port === ownPort()) return 'Member connectors cannot point at this server itself.';
  return '';
}

export function memberRequest(raw) {
  const url = new URL(String(raw));
  const reason = screenTarget(hostOf(url), portOf(url));
  if (reason) throw new MemberTargetError(reason, hostOf(url));
  return { dispatcher: memberAgent };
}

export async function checkMemberUrl(raw) {
  let url;
  try { url = new URL(String(raw)); } catch { return 'A valid http(s) URL is required for HTTP servers.'; }
  const host = hostOf(url);
  const early = screenTarget(host, portOf(url));
  if (early || net.isIP(host)) return early;
  let addrs;
  try { addrs = await dns.promises.lookup(host, { all: true }); }
  catch { return 'That host name did not resolve.'; }
  for (const a of addrs) {
    const reason = screenAddress(a.address, portOf(url));
    if (reason) return reason;
  }
  return '';
}

function screenedLookup(port) {
  return (hostname, options, callback) => {
    connectLookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return callback(err);
      const reason = addrs.map(a => screenAddress(a.address, port)).find(Boolean);
      if (reason) return callback(new MemberTargetError(reason, hostname));
      if (options?.all) callback(null, addrs);
      else callback(null, addrs[0].address, addrs[0].family);
    });
  };
}

function screenedConnect(opts, callback) {
  const port = Number(opts.port) || (opts.protocol === 'https:' ? 443 : 80);
  const host = plainIp(opts.hostname);
  const reason = screenTarget(host, port);
  if (reason) return callback(new MemberTargetError(reason, host));
  return buildConnector({ lookup: screenedLookup(port) })(opts, callback);
}

const memberAgent = new Agent({ connect: screenedConnect });

export function isBlockedError(e) {
  for (let cur = e; cur; cur = cur.cause) {
    if (cur instanceof MemberTargetError || cur instanceof EgressBlockedError) return cur;
  }
  return null;
}