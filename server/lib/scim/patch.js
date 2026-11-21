import { ScimError } from './errors.js';
import { parseFilter, matches, splitPath, getKey } from './filter.js';

export const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const MAX_OPERATIONS = 1000;
const READ_ONLY = new Set(['id', 'meta', 'schemas', 'groups']);

const syntax = (detail) => new ScimError(400, 'invalidSyntax', detail);
const badPath = (detail) => new ScimError(400, 'invalidPath', detail);

function closingBracket(text, from) {
  let quoted = false;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '"' && text[i - 1] !== '\\') quoted = !quoted;
    else if (!quoted && text[i] === ']') return i;
  }
  return -1;
}

export function parsePath(raw, schemas) {
  const text = String(raw ?? '').trim();
  if (!text || text.length > 1000) throw badPath('The path is empty or too long.');
  let attr = text;
  let filter = null;
  let sub = null;
  const open = text.indexOf('[');
  if (open !== -1) {
    const close = closingBracket(text, open + 1);
    if (close === -1) throw badPath('A bracket in the path is not closed.');
    attr = text.slice(0, open);
    filter = parseFilter(text.slice(open + 1, close));
    const rest = text.slice(close + 1);
    if (rest) {
      if (!rest.startsWith('.') || rest.length < 2) throw badPath('The path has text after its filter.');
      sub = rest.slice(1);
    }
  }
  const { schema, parts } = splitPath(attr, schemas);
  if (!parts.length) throw badPath('The path names no attribute.');
  if (filter && parts.length > 1) throw badPath('A filter must follow a top-level attribute.');
  if (!filter && parts.length > 2) throw badPath('The path is nested too deeply.');
  if (!filter && parts.length === 2) sub = parts.pop();
  const extension = schema && schema !== schemas[0] ? schema : null;
  return { extension, attr: parts[0], filter, sub };
}

function containerOf(resource, extension, create) {
  if (!extension) return resource;
  let key = getKey(resource, extension);
  if (key === undefined) {
    if (!create) return null;
    key = extension;
    resource[key] = {};
  }
  return resource[key];
}

function keyIn(obj, name) {
  return getKey(obj, name) ?? name;
}

const sameValue = (a, b) => a && b && typeof a === 'object' && typeof b === 'object' && 'value' in a && 'value' in b && String(a.value) === String(b.value);

function addValues(list, values) {
  for (const v of values) {
    if (!list.some(existing => sameValue(existing, v) || existing === v)) list.push(v);
  }
  return list;
}

function seedFromFilter(filter) {
  if (filter?.op !== 'eq' || filter.path.includes('.')) return null;
  return { [filter.path]: filter.value };
}

function applyOne(resource, op, path, value, schemas) {
  const { extension, attr, filter, sub } = parsePath(path, schemas);
  if (!extension && READ_ONLY.has(attr.toLowerCase())) throw new ScimError(400, 'mutability', `"${attr}" cannot be changed.`);
  const container = containerOf(resource, extension, op !== 'remove');
  if (!container) return;
  const key = keyIn(container, attr);

  if (filter) {
    const list = Array.isArray(container[key]) ? container[key] : [];
    const hits = list.filter(item => item && typeof item === 'object' && matches(filter, item, schemas));
    if (op === 'remove') {
      if (sub) hits.forEach(item => { delete item[keyIn(item, sub)]; });
      else container[key] = list.filter(item => !hits.includes(item));
      return;
    }
    if (!hits.length) {
      const seed = seedFromFilter(filter);
      if (!seed) throw new ScimError(400, 'noTarget', 'Nothing matches the filter in the path.');
      const item = sub ? { ...seed, [sub]: value } : { ...seed, ...(value && typeof value === 'object' ? value : {}) };
      container[key] = [...list, item];
      return;
    }
    for (const item of hits) {
      if (sub) item[keyIn(item, sub)] = value;
      else if (value && typeof value === 'object' && !Array.isArray(value)) Object.assign(item, value);
    }
    container[key] = list;
    return;
  }

  if (sub) {
    const parent = container[key] && typeof container[key] === 'object' ? container[key] : null;
    if (op === 'remove') {
      if (parent) delete parent[keyIn(parent, sub)];
      return;
    }
    if (Array.isArray(parent)) {
      parent.forEach(item => { if (item && typeof item === 'object') item[keyIn(item, sub)] = value; });
      return;
    }
    container[key] = { ...(parent || {}), [keyIn(parent || {}, sub)]: value };
    return;
  }

  if (op === 'remove') {
    if (Array.isArray(container[key]) && value !== undefined) {
      const drop = Array.isArray(value) ? value : [value];
      container[key] = container[key].filter(item => !drop.some(d => sameValue(item, d) || item === d));
    } else {
      delete container[key];
    }
    return;
  }
  if (op === 'add' && Array.isArray(container[key])) {
    container[key] = addValues(container[key], Array.isArray(value) ? value : [value]);
    return;
  }
  if (op === 'add' && container[key] && typeof container[key] === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    container[key] = { ...container[key], ...value };
    return;
  }
  container[key] = value;
}

function applyWithoutPath(resource, op, value, schemas) {
  if (op === 'remove') throw new ScimError(400, 'noTarget', 'A remove operation needs a path.');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw syntax('An operation without a path needs an object value.');
  for (const [name, v] of Object.entries(value)) {
    if (READ_ONLY.has(name.toLowerCase())) continue;
    const extension = schemas.slice(1).find(urn => urn.toLowerCase() === name.toLowerCase());
    if (extension && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [inner, iv] of Object.entries(v)) applyOne(resource, op, `${extension}:${inner}`, iv, schemas);
    } else {
      applyOne(resource, op, name, v, schemas);
    }
  }
}

export function applyPatch(resource, body, schemas) {
  if (!body || typeof body !== 'object') throw syntax('The request body is not a PatchOp message.');
  const declared = Array.isArray(body.schemas) ? body.schemas : [];
  if (!declared.some(s => String(s).toLowerCase() === PATCH_SCHEMA.toLowerCase())) throw syntax('The request is missing the PatchOp schema.');
  const ops = body[getKey(body, 'Operations') ?? 'Operations'];
  if (!Array.isArray(ops) || !ops.length) throw syntax('The request has no operations.');
  if (ops.length > MAX_OPERATIONS) throw syntax('The request has too many operations.');
  const next = structuredClone(resource);
  for (const raw of ops) {
    const op = String(raw?.[getKey(raw, 'op') ?? 'op'] ?? '').toLowerCase();
    if (!['add', 'replace', 'remove'].includes(op)) throw syntax(`"${raw?.op ?? ''}" is not a patch operation.`);
    const path = raw[getKey(raw, 'path') ?? 'path'];
    const value = raw[getKey(raw, 'value') ?? 'value'];
    if (path === undefined || path === null || path === '') applyWithoutPath(next, op, value, schemas);
    else applyOne(next, op, path, value, schemas);
  }
  return next;
}