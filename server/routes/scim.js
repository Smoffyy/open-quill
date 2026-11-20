import express from 'express';
import { db } from '../db.js';
import { logAudit, clientIp } from '../lib/audit.js';
import { isHttps } from '../lib/origin.js';
import { rateLimiter } from '../lib/ratelimit.js';
import { publicBase } from '../lib/identity/providers.js';
import { ScimError, errorBody } from '../lib/scim/errors.js';
import { parseFilter, matches, simpleEquality, splitPath } from '../lib/scim/filter.js';
import { applyPatch } from '../lib/scim/patch.js';
import { scimConfig, tokenFor, touchToken } from '../lib/scim/config.js';
import { SCHEMA_LIST, RESOURCE_TYPES, serviceProviderConfig } from '../lib/scim/schemas.js';
import {
  SCIM, USER_SCHEMA, GROUP_SCHEMA, USER_SCHEMAS, GROUP_SCHEMAS, userFromScim, userToScim, managedUser, createUser, replaceUser, removeUser,
  managedGroup, scimGroups, groupToScim, groupFromScim, createGroup, replaceGroup, removeGroup
} from '../lib/scim/resources.js';

const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const MAX_RESULTS = 200;
const perToken = rateLimiter({ windowMs: 60 * 1000, max: 1200 });
const perAddress = rateLimiter({ windowMs: 60 * 1000, max: 60 });

const send = (res, status, body) => res.status(status).type('application/scim+json').send(JSON.stringify(body));
const fail = (res, status, scimType, detail) => send(res, status, errorBody(status, scimType, detail));
const notFound = () => new ScimError(404, null, 'No such resource.');

function baseUrl(req) {
  const configured = publicBase();
  return (configured || `${isHttps(req) ? 'https' : 'http'}://${req.get('host')}`) + '/scim/v2';
}

const listParam = (v) => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

function topName(attr, schemas) {
  const { schema, parts } = splitPath(attr, schemas);
  return (schema && schema !== schemas[0] ? schema : parts[0] || '').toLowerCase();
}

function project(resource, query, schemas) {
  const wanted = listParam(query.attributes).map(a => topName(a, schemas));
  const dropped = new Set(listParam(query.excludedAttributes).map(a => topName(a, schemas)));
  const out = {};
  for (const [key, value] of Object.entries(resource)) {
    const lower = key.toLowerCase();
    const always = lower === 'id' || lower === 'schemas';
    if (!always && (wanted.length ? !wanted.includes(lower) : dropped.has(lower))) continue;
    out[key] = value;
  }
  return out;
}

function paging(query) {
  const start = Math.max(1, parseInt(query.startIndex, 10) || 1);
  const asked = parseInt(query.count, 10);
  const count = Number.isNaN(asked) ? 100 : Math.min(MAX_RESULTS, Math.max(0, asked));
  return { start, count };
}

function listResponse(items, query, toResource, schemas) {
  const { start, count } = paging(query);
  const page = items.slice(start - 1, start - 1 + count).map(item => project(toResource(item), query, schemas));
  return { schemas: [LIST_SCHEMA], totalResults: items.length, startIndex: start, itemsPerPage: page.length, Resources: page };
}

function filterOf(query) {
  return query.filter ? parseFilter(query.filter) : null;
}

function isPath(eq, name, schema) {
  return eq && (eq.path === name || eq.path === `${schema.toLowerCase()}:${name}`);
}

function fastUsers(eq) {
  if (isPath(eq, 'username', USER_SCHEMA)) return db.users.byScimName(eq.value);
  if (isPath(eq, 'externalid', USER_SCHEMA)) return db.users.byExternalId(eq.value);
  if (isPath(eq, 'id', USER_SCHEMA)) return [db.users.byId(eq.value)];
  return null;
}

function audit(req, action, target, meta = {}) {
  logAudit(req, action, { ...target, meta });
}

function authenticate(req, res, next) {
  if (!scimConfig().enabled) return fail(res, 403, null, 'Provisioning is turned off on this server.');
  const token = tokenFor(req.headers.authorization);
  if (!token) {
    if (!perAddress(clientIp(req))) return fail(res, 429, null, 'Too many requests. Try again in a minute.');
    res.setHeader('WWW-Authenticate', 'Bearer realm="scim"');
    return fail(res, 401, null, 'A valid provisioning token is required.');
  }
  if (!perToken(token.id)) return fail(res, 429, null, 'Too many requests. Try again in a minute.');
  touchToken(token, clientIp(req));
  req.user = { id: null, email: `SCIM: ${token.name}` };
  req.scimToken = token;
  next();
}

export default function register(app) {
  const router = express.Router();
  router.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(authenticate);
  router.use(express.json({ type: ['application/scim+json', 'application/json'], limit: '1mb' }));

  router.get('/ServiceProviderConfig', (req, res) => send(res, 200, serviceProviderConfig(baseUrl(req))));
  router.get('/ResourceTypes', (req, res) => {
    const base = baseUrl(req);
    const all = RESOURCE_TYPES.map(r => ({ ...r, meta: { resourceType: 'ResourceType', location: `${base}/ResourceTypes/${r.id}` } }));
    send(res, 200, { schemas: [LIST_SCHEMA], totalResults: all.length, startIndex: 1, itemsPerPage: all.length, Resources: all });
  });
  router.get('/ResourceTypes/:id', (req, res) => {
    const found = RESOURCE_TYPES.find(r => r.id === req.params.id);
    if (!found) throw notFound();
    send(res, 200, { ...found, meta: { resourceType: 'ResourceType', location: `${baseUrl(req)}/ResourceTypes/${found.id}` } });
  });
  router.get('/Schemas', (req, res) => {
    const base = baseUrl(req);
    const all = SCHEMA_LIST.map(s => ({ ...s, meta: { resourceType: 'Schema', location: `${base}/Schemas/${s.id}` } }));
    send(res, 200, { schemas: [LIST_SCHEMA], totalResults: all.length, startIndex: 1, itemsPerPage: all.length, Resources: all });
  });
  router.get('/Schemas/:id', (req, res) => {
    const found = SCHEMA_LIST.find(s => s.id === req.params.id);
    if (!found) throw notFound();
    send(res, 200, { ...found, meta: { resourceType: 'Schema', location: `${baseUrl(req)}/Schemas/${found.id}` } });
  });

  router.get('/Users', (req, res) => {
    const base = baseUrl(req);
    const tree = filterOf(req.query);
    const fast = fastUsers(simpleEquality(tree));
    if (fast) return send(res, 200, listResponse(fast.filter(u => u?.source === SCIM), req.query, u => userToScim(u, base), USER_SCHEMAS));
    const users = db.users.bySource(SCIM);
    if (!tree) return send(res, 200, listResponse(users, req.query, u => userToScim(u, base), USER_SCHEMAS));
    const resources = users.map(u => userToScim(u, base)).filter(r => matches(tree, r, USER_SCHEMAS));
    send(res, 200, listResponse(resources, req.query, r => r, USER_SCHEMAS));
  });

  router.post('/Users', (req, res) => {
    const { user, outcome } = createUser(userFromScim(req.body), scimConfig());
    audit(req, outcome === 'created' ? 'scim.user_create' : outcome === 'adopted' ? 'scim.user_adopt' : 'scim.user_restore', { type: 'user', id: user.id }, { email: user.email });
    const body = userToScim(user, baseUrl(req));
    res.setHeader('Location', body.meta.location);
    send(res, 201, project(body, req.query, USER_SCHEMAS));
  });

  router.get('/Users/:id', (req, res) => {
    const user = managedUser(req.params.id);
    if (!user) throw notFound();
    send(res, 200, project(userToScim(user, baseUrl(req)), req.query, USER_SCHEMAS));
  });

  const changeUser = (req, res, user, attrs) => {
    const before = user.status;
    const saved = replaceUser(user, attrs);
    audit(req, 'scim.user_update', { type: 'user', id: saved.id }, { email: saved.email, ...(before !== saved.status ? { status: saved.status } : {}) });
    send(res, 200, project(userToScim(saved, baseUrl(req)), req.query, USER_SCHEMAS));
  };

  router.put('/Users/:id', (req, res) => {
    const user = managedUser(req.params.id);
    if (!user) throw notFound();
    changeUser(req, res, user, userFromScim(req.body));
  });

  router.patch('/Users/:id', (req, res) => {
    const user = managedUser(req.params.id);
    if (!user) throw notFound();
    const patched = applyPatch(userToScim(user, baseUrl(req)), req.body, USER_SCHEMAS);
    changeUser(req, res, user, userFromScim(patched));
  });

  router.delete('/Users/:id', (req, res) => {
    const user = managedUser(req.params.id);
    if (!user) throw notFound();
    const outcome = removeUser(user, scimConfig());
    audit(req, outcome === 'deleted' ? 'scim.user_delete' : 'scim.user_remove', { type: 'user', id: user.id }, { email: user.email });
    res.status(204).end();
  });

  router.get('/Groups', (req, res) => {
    const base = baseUrl(req);
    const tree = filterOf(req.query);
    const eq = simpleEquality(tree);
    const excluded = new Set(listParam(req.query.excludedAttributes).map(a => topName(a, GROUP_SCHEMAS)));
    const wanted = listParam(req.query.attributes).map(a => topName(a, GROUP_SCHEMAS));
    const withMembers = (wanted.length ? wanted.includes('members') : !excluded.has('members')) || /members/i.test(String(req.query.filter || ''));
    let groups = scimGroups();
    if (isPath(eq, 'displayname', GROUP_SCHEMA)) groups = groups.filter(g => g.name_key === eq.value.trim().toLowerCase());
    else if (isPath(eq, 'externalid', GROUP_SCHEMA)) groups = groups.filter(g => g.external_id === eq.value);
    else if (isPath(eq, 'id', GROUP_SCHEMA)) groups = groups.filter(g => g.id === eq.value);
    else if (tree) {
      const resources = groups.map(g => groupToScim(g, base, withMembers)).filter(r => matches(tree, r, GROUP_SCHEMAS));
      return send(res, 200, listResponse(resources, req.query, r => r, GROUP_SCHEMAS));
    }
    send(res, 200, listResponse(groups, req.query, g => groupToScim(g, base, withMembers), GROUP_SCHEMAS));
  });

  router.post('/Groups', (req, res) => {
    const group = createGroup(groupFromScim(req.body));
    audit(req, 'scim.group_create', { type: 'group', id: group.id }, { name: group.name });
    const body = groupToScim(group, baseUrl(req));
    res.setHeader('Location', body.meta.location);
    send(res, 201, project(body, req.query, GROUP_SCHEMAS));
  });

  router.get('/Groups/:id', (req, res) => {
    const group = managedGroup(req.params.id);
    if (!group) throw notFound();
    const excluded = new Set(listParam(req.query.excludedAttributes).map(a => topName(a, GROUP_SCHEMAS)));
    send(res, 200, project(groupToScim(group, baseUrl(req), !excluded.has('members')), req.query, GROUP_SCHEMAS));
  });

  const changeGroup = (req, res, group, attrs) => {
    const saved = replaceGroup(group, attrs);
    audit(req, 'scim.group_update', { type: 'group', id: saved.id }, { name: saved.name, members: attrs.members.length });
    if (req.method === 'PATCH' && !req.query.attributes && !req.query.excludedAttributes) return res.status(204).end();
    send(res, 200, project(groupToScim(saved, baseUrl(req)), req.query, GROUP_SCHEMAS));
  };

  router.put('/Groups/:id', (req, res) => {
    const group = managedGroup(req.params.id);
    if (!group) throw notFound();
    changeGroup(req, res, group, groupFromScim(req.body));
  });

  router.patch('/Groups/:id', (req, res) => {
    const group = managedGroup(req.params.id);
    if (!group) throw notFound();
    const patched = applyPatch(groupToScim(group, baseUrl(req)), req.body, GROUP_SCHEMAS);
    changeGroup(req, res, group, groupFromScim(patched));
  });

  router.delete('/Groups/:id', (req, res) => {
    const group = managedGroup(req.params.id);
    if (!group) throw notFound();
    removeGroup(group);
    audit(req, 'scim.group_delete', { type: 'group', id: group.id }, { name: group.name });
    res.status(204).end();
  });

  router.use(() => { throw notFound(); });

  router.use((err, req, res, _next) => {
    if (err instanceof ScimError) return fail(res, err.status, err.scimType, err.message);
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'invalidSyntax', 'The request body is not valid JSON.');
    if (err?.type === 'entity.too.large') return fail(res, 413, null, 'The request body is too large.');
    if (err?.status >= 400 && err?.status < 500) return fail(res, err.status, null, 'The request could not be read.');
    console.error('[scim]', req.method, req.path, err);
    fail(res, 500, null, 'Something went wrong on the server.');
  });

  app.use('/scim/v2', router);
}