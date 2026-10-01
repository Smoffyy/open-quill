const MAX_LENGTH = 500;
const MAX_DEPTH = 64;

const CONSTANTS = { __proto__: null, pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error('factorial needs a whole number of 0 or more.');
  if (n > 170) throw new Error('factorial is only defined here up to 170.');
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function choose(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0) throw new Error('ncr needs whole numbers of 0 or more.');
  if (k > n) return 0;
  let r = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) r = r * (n - i + 1) / i;
  return Math.round(r);
}

function roundTo(x, digits = 0) {
  if (!Number.isInteger(digits) || digits < 0 || digits > 15) throw new Error('round digits must be a whole number from 0 to 15.');
  const f = 10 ** digits;
  return Math.round((x + Number.EPSILON * Math.sign(x)) * f) / f;
}

const FUNCTIONS = {
  __proto__: null,
  sqrt: [1, 1, Math.sqrt], cbrt: [1, 1, Math.cbrt], abs: [1, 1, Math.abs], sign: [1, 1, Math.sign],
  exp: [1, 1, Math.exp], ln: [1, 1, Math.log], log10: [1, 1, Math.log10], log2: [1, 1, Math.log2],
  log: [1, 2, (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b))],
  sin: [1, 1, Math.sin], cos: [1, 1, Math.cos], tan: [1, 1, Math.tan],
  asin: [1, 1, Math.asin], acos: [1, 1, Math.acos], atan: [1, 1, Math.atan], atan2: [2, 2, Math.atan2],
  sinh: [1, 1, Math.sinh], cosh: [1, 1, Math.cosh], tanh: [1, 1, Math.tanh],
  floor: [1, 1, Math.floor], ceil: [1, 1, Math.ceil], trunc: [1, 1, Math.trunc], round: [1, 2, roundTo],
  min: [1, Infinity, Math.min], max: [1, Infinity, Math.max], hypot: [1, Infinity, Math.hypot],
  pow: [2, 2, Math.pow], mod: [2, 2, (a, b) => a % b], factorial: [1, 1, factorial], ncr: [2, 2, choose]
};

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
    if (num) {
      const value = Number(num[0].replace(/_/g, ''));
      if (!Number.isFinite(value)) throw new Error(`"${num[0]}" is not a valid number.`);
      out.push({ t: 'num', v: value, at: i });
      i += num[0].length;
      continue;
    }
    const id = /^[a-z][a-z0-9]*/i.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0].toLowerCase(), at: i }); i += id[0].length; continue; }
    if (src.startsWith('**', i)) { out.push({ t: 'op', v: '^', at: i }); i += 2; continue; }
    const op = { '×': '*', '·': '*', '÷': '/', '−': '-' }[c] || c;
    if ('+-*/%^!(),'.includes(op)) { out.push({ t: 'op', v: op, at: i }); i++; continue; }
    throw new Error(`Unexpected character "${c}" at position ${i + 1}.`);
  }
  return out;
}

export function evaluate(expression) {
  const src = String(expression ?? '').trim();
  if (!src) throw new Error('The expression is empty.');
  if (src.length > MAX_LENGTH) throw new Error(`The expression is longer than ${MAX_LENGTH} characters.`);
  const toks = tokenize(src);
  let pos = 0, depth = 0;
  const peek = () => toks[pos];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new Error(peek() ? `Expected "${v}" at position ${peek().at + 1}.` : `Expected "${v}" before the end.`);
    pos++;
  };
  const nest = (fn) => {
    if (++depth > MAX_DEPTH) throw new Error('The expression is nested too deeply.');
    try { return fn(); } finally { depth--; }
  };

  const additive = () => nest(() => {
    let v = multiplicative();
    while (isOp('+') || isOp('-')) {
      const op = toks[pos++].v;
      const r = multiplicative();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  });
  const multiplicative = () => {
    let v = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = toks[pos++].v;
      const r = unary();
      if ((op === '/' || op === '%') && r === 0) throw new Error('Division by zero.');
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  };
  const unary = () => nest(() => {
    if (isOp('-')) { pos++; return -unary(); }
    if (isOp('+')) { pos++; return unary(); }
    return power();
  });
  const power = () => {
    const base = postfix();
    if (isOp('^')) { pos++; return base ** unary(); }
    return base;
  };
  const postfix = () => {
    let v = primary();
    while (isOp('!')) { pos++; v = factorial(v); }
    return v;
  };
  const primary = () => {
    const tok = peek();
    if (!tok) throw new Error('The expression ends too early.');
    if (tok.t === 'num') { pos++; return tok.v; }
    if (isOp('(')) { pos++; const v = additive(); expect(')'); return v; }
    if (tok.t === 'id') {
      pos++;
      if (isOp('(')) {
        const fn = FUNCTIONS[tok.v];
        if (!fn) throw new Error(`Unknown function "${tok.v}". Available: ${Object.keys(FUNCTIONS).join(', ')}.`);
        pos++;
        const args = [];
        if (!isOp(')')) {
          args.push(additive());
          while (isOp(',')) { pos++; args.push(additive()); }
        }
        expect(')');
        const [min, max, impl] = fn;
        if (args.length < min || args.length > max) {
          const want = min === max ? String(min) : max === Infinity ? `at least ${min}` : `${min} or ${max}`;
          throw new Error(`${tok.v} takes ${want} argument${want === '1' ? '' : 's'}, got ${args.length}.`);
        }
        return impl(...args);
      }
      if (tok.v in CONSTANTS) return CONSTANTS[tok.v];
      if (tok.v in FUNCTIONS) throw new Error(`${tok.v} is a function; call it as ${tok.v}(...).`);
      throw new Error(`Unknown name "${tok.v}". Constants: ${Object.keys(CONSTANTS).join(', ')}.`);
    }
    throw new Error(`Unexpected "${tok.v}" at position ${tok.at + 1}.`);
  };

  const value = additive();
  if (pos < toks.length) throw new Error(`Unexpected "${toks[pos].v}" at position ${toks[pos].at + 1}.`);
  if (!Number.isFinite(value)) throw new Error('The result is not a finite number.');
  return value;
}

export function formatNumber(n) {
  if (Object.is(n, -0)) return '0';
  if (Number.isInteger(n) && Math.abs(n) < 1e21) return String(n);
  return String(Number(n.toPrecision(15)));
}

export function runCalculator(call) {
  const expression = String(call?.expression ?? '').trim();
  try {
    const value = evaluate(expression);
    return { ok: true, expression, result: formatNumber(value) };
  } catch (e) {
    return { ok: false, expression, error: String(e.message || e) };
  }
}

export function formatCalculatorResult(r) {
  return r.ok ? `calculator "${r.expression}" → ${r.result}` : `calculator "${r.expression}" → ERROR: ${r.error}`;
}