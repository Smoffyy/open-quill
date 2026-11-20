import { ScimError } from './errors.js';

const MAX_LENGTH = 2000;
const MAX_NODES = 200;
const COMPARE = new Set(['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'ge', 'lt', 'le']);
const EXACT = new Set(['id', 'externalid']);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

const invalid = (detail) => new ScimError(400, 'invalidFilter', detail);

function tokenize(text) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if ('()[]'.includes(ch)) { tokens.push({ kind: ch }); i++; continue; }
    if (ch === '"') {
      let end = i + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
      if (end >= text.length) throw invalid('A quoted value is not closed.');
      try { tokens.push({ kind: 'value', value: JSON.parse(text.slice(i, end + 1)) }); } catch { throw invalid('A quoted value is not valid.'); }
      i = end + 1;
      continue;
    }
    let end = i;
    while (end < text.length && !/[\s()[\]"]/.test(text[end])) end++;
    tokens.push({ kind: 'word', value: text.slice(i, end) });
    i = end;
  }
  return tokens;
}

function literal(token) {
  if (!token) throw invalid('A comparison is missing its value.');
  if (token.kind === 'value') return token.value;
  if (token.kind !== 'word') throw invalid('A comparison is missing its value.');
  const word = token.value.toLowerCase();
  if (word === 'true') return true;
  if (word === 'false') return false;
  if (word === 'null') return null;
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(token.value)) return Number(token.value);
  throw invalid(`"${token.value}" is not a value.`);
}

export function parseFilter(text) {
  const source = String(text ?? '').trim();
  if (!source) throw invalid('The filter is empty.');
  if (source.length > MAX_LENGTH) throw invalid('The filter is too long.');
  const tokens = tokenize(source);
  let at = 0;
  let nodes = 0;
  const peekWord = () => (tokens[at]?.kind === 'word' ? tokens[at].value.toLowerCase() : null);
  const count = () => { if (++nodes > MAX_NODES) throw invalid('The filter is too complex.'); };

  function or() {
    let left = and();
    while (peekWord() === 'or') { at++; count(); left = { op: 'or', left, right: and() }; }
    return left;
  }

  function and() {
    let left = unary();
    while (peekWord() === 'and') { at++; count(); left = { op: 'and', left, right: unary() }; }
    return left;
  }

  function unary() {
    count();
    if (peekWord() === 'not') {
      at++;
      if (tokens[at]?.kind !== '(') throw invalid('"not" must be followed by a group in parentheses.');
      return { op: 'not', expr: unary() };
    }
    if (tokens[at]?.kind === '(') {
      at++;
      const expr = or();
      if (tokens[at]?.kind !== ')') throw invalid('A parenthesis is not closed.');
      at++;
      return expr;
    }
    const token = tokens[at];
    if (token?.kind !== 'word') throw invalid('An attribute name is expected.');
    at++;
    const path = token.value;
    if (tokens[at]?.kind === '[') {
      at++;
      const inner = or();
      if (tokens[at]?.kind !== ']') throw invalid('A bracket is not closed.');
      at++;
      const next = tokens[at];
      if (next?.kind === 'word' && next.value.startsWith('.') && next.value.length > 1) {
        at++;
        return { op: 'where', path, expr: inner, then: comparison(next.value.slice(1)) };
      }
      return { op: 'where', path, expr: inner };
    }
    return comparison(path);
  }

  function comparison(path) {
    const op = peekWord();
    if (op === 'pr') { at++; return { op: 'pr', path }; }
    if (!COMPARE.has(op)) throw invalid(`"${tokens[at]?.value ?? ''}" is not a comparison operator.`);
    at++;
    const value = literal(tokens[at]);
    at++;
    return { op, path, value };
  }

  const tree = or();
  if (at < tokens.length) throw invalid('The filter has text after its end.');
  return tree;
}

export function splitPath(path, schemas = []) {
  let rest = String(path);
  let schema = null;
  for (const urn of schemas) {
    if (rest.toLowerCase().startsWith(urn.toLowerCase() + ':')) {
      schema = urn;
      rest = rest.slice(urn.length + 1);
      break;
    }
    if (rest.toLowerCase() === urn.toLowerCase()) return { schema: urn, parts: [] };
  }
  return { schema, parts: rest.split('.').filter(Boolean) };
}

export function getKey(obj, name) {
  if (!obj || typeof obj !== 'object') return undefined;
  const lower = name.toLowerCase();
  return Object.keys(obj).find(k => k.toLowerCase() === lower);
}

function resolve(resource, path, schemas) {
  const { schema, parts } = splitPath(path, schemas);
  let values = [resource];
  const core = schemas[0];
  if (schema && schema !== core) {
    const key = getKey(resource, schema);
    values = key ? [resource[key]] : [];
  }
  for (const part of parts) {
    const next = [];
    for (const v of values) {
      const items = Array.isArray(v) ? v : [v];
      for (const item of items) {
        const key = getKey(item, part);
        if (key !== undefined) next.push(item[key]);
      }
    }
    values = next;
  }
  const flat = values.flatMap(v => (Array.isArray(v) ? v : [v]));
  return flat.map(v => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v ? v.value : v));
}

function compare(op, actual, expected, exact) {
  if (actual === undefined || actual === null) return op === 'ne' ? expected !== null : false;
  if (typeof expected === 'boolean' || typeof actual === 'boolean') {
    const a = typeof actual === 'string' ? actual.toLowerCase() === 'true' : actual;
    if (op === 'eq') return a === expected;
    if (op === 'ne') return a !== expected;
    throw invalid('Booleans can only be compared with eq or ne.');
  }
  if (expected === null) return op === 'ne';
  if (typeof expected === 'number' && typeof actual === 'number') {
    return { eq: actual === expected, ne: actual !== expected, gt: actual > expected, ge: actual >= expected, lt: actual < expected, le: actual <= expected }[op] ?? false;
  }
  let a = String(actual);
  let b = String(expected);
  if (ISO_TIME.test(a) && ISO_TIME.test(b) && ['gt', 'ge', 'lt', 'le', 'eq', 'ne'].includes(op)) {
    const x = Date.parse(a);
    const y = Date.parse(b);
    return { eq: x === y, ne: x !== y, gt: x > y, ge: x >= y, lt: x < y, le: x <= y }[op];
  }
  if (!exact) { a = a.toLowerCase(); b = b.toLowerCase(); }
  switch (op) {
    case 'eq': return a === b;
    case 'ne': return a !== b;
    case 'co': return a.includes(b);
    case 'sw': return a.startsWith(b);
    case 'ew': return a.endsWith(b);
    case 'gt': return a > b;
    case 'ge': return a >= b;
    case 'lt': return a < b;
    case 'le': return a <= b;
    default: return false;
  }
}

export function matches(tree, resource, schemas) {
  switch (tree.op) {
    case 'and': return matches(tree.left, resource, schemas) && matches(tree.right, resource, schemas);
    case 'or': return matches(tree.left, resource, schemas) || matches(tree.right, resource, schemas);
    case 'not': return !matches(tree.expr, resource, schemas);
    case 'pr': return resolve(resource, tree.path, schemas).some(v => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
    case 'where': {
      const { schema, parts } = splitPath(tree.path, schemas);
      const base = schema && schema !== schemas[0] ? resource[getKey(resource, schema)] : resource;
      let items = [base];
      for (const part of parts) items = items.flatMap(item => { const key = getKey(item, part); return key === undefined ? [] : [item[key]]; });
      const hits = items.flat().filter(item => item && typeof item === 'object' && matches(tree.expr, item, schemas));
      return tree.then ? hits.some(item => matches(tree.then, item, schemas)) : hits.length > 0;
    }
    default: {
      const exact = EXACT.has(splitPath(tree.path, schemas).parts.join('.').toLowerCase());
      const values = resolve(resource, tree.path, schemas);
      if (tree.op === 'ne') return !values.some(v => compare('eq', v, tree.value, exact));
      return values.some(v => compare(tree.op, v, tree.value, exact));
    }
  }
}

export function simpleEquality(tree) {
  if (tree?.op !== 'eq' || typeof tree.value !== 'string') return null;
  return { path: tree.path.toLowerCase(), value: tree.value };
}