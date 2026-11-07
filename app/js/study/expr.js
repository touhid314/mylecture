// Safe math expressions for the tutor's plots: "a*sin(b*x) + x^2".
// Only numbers, operators, parentheses, known functions/constants and the
// allowed variable names get through; anything else is rejected.

const FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, exp: Math.exp, ln: Math.log, log: Math.log10,
  log10: Math.log10, log2: Math.log2, sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, sign: Math.sign, min: Math.min, max: Math.max, pow: Math.pow, cbrt: Math.cbrt,
  sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

function tokenize(s) {
  const tokens = [];
  const re = /\s*(\d*\.?\d+(?:e[+-]?\d+)?|[A-Za-z_]\w*|\^|[-+*\/(),|!])/giy;
  let m, pos = 0;
  s = s.trim();
  while (pos < s.length) {
    re.lastIndex = pos;
    m = re.exec(s);
    if (!m) throw new Error(`Unexpected "${s[pos]}"`);
    tokens.push(m[1]);
    pos = re.lastIndex;
    while (pos < s.length && /\s/.test(s[pos])) pos++;
  }
  return tokens;
}

// Grammar: expr = term (("+"|"-") term)*; term = unary (("*"|"/"|implicit) unary)*;
// unary = "-" unary | power; power = atom ("^" unary)?; atom = num | var | const | fn(args) | (expr) | |expr|
export function compileExpr(src, vars = ["x"]) {
  let s = String(src || "").trim();
  s = s.replace(/^\s*(?:y|[a-zA-Z]\s*\(\s*x\s*\))\s*=\s*/, "");
  s = s.replace(/\*\*/g, "^").replace(/·|×/g, "*").replace(/−/g, "-").replace(/π/g, "pi");
  const allowed = new Set(vars);
  const t = tokenize(s);
  let i = 0;
  const peek = () => t[i];
  const eat = (x) => {
    if (t[i] !== x) throw new Error(`Expected "${x}"`);
    i++;
  };
  const startsAtom = (tok) => tok != null && (/^[\d.]/.test(tok) || /^[A-Za-z_]/.test(tok) || tok === "(");
  function expr() {
    let left = term();
    while (peek() === "+" || peek() === "-") {
      const op = t[i++], a = left, b = term();
      left = op === "+" ? (v) => a(v) + b(v) : (v) => a(v) - b(v);
    }
    return left;
  }
  function term() {
    let left = unary();
    for (;;) {
      const op = peek();
      if (op === "*" || op === "/") {
        i++;
        const a = left, b = unary();
        left = op === "*" ? (v) => a(v) * b(v) : (v) => a(v) / b(v);
      } else if (startsAtom(op)) {
        const a = left, b = unary();
        left = (v) => a(v) * b(v);
      } else return left;
    }
  }
  function unary() {
    if (peek() === "-") { i++; const a = unary(); return (v) => -a(v); }
    if (peek() === "+") { i++; return unary(); }
    return power();
  }
  function power() {
    let base = postfix();
    if (peek() === "^") {
      i++;
      const b = base, e = unary();
      return (v) => Math.pow(b(v), e(v));
    }
    return base;
  }
  function postfix() {
    let a = atom();
    while (peek() === "!") {
      i++;
      const f = a;
      a = (v) => { const n = f(v), r = gamma(n + 1); return Number.isInteger(n) ? Math.round(r) : r; };
    }
    return a;
  }
  function atom() {
    const tok = t[i++];
    if (tok == null) throw new Error("Unexpected end");
    if (/^[\d.]/.test(tok)) { const n = Number(tok); return () => n; }
    if (tok === "(") { const a = expr(); eat(")"); return a; }
    if (tok === "|") { const a = expr(); eat("|"); return (v) => Math.abs(a(v)); }
    if (/^[A-Za-z_]/.test(tok)) {
      if (Object.hasOwn(FUNCS, tok) && peek() === "(") {
        i++;
        const args = [expr()];
        while (peek() === ",") { i++; args.push(expr()); }
        eat(")");
        const f = FUNCS[tok];
        return args.length === 1 ? (v) => f(args[0](v)) : (v) => f(...args.map((a) => a(v)));
      }
      if (Object.hasOwn(FUNCS, tok)) { const f = FUNCS[tok], a = power(); return (v) => f(a(v)); } // sin x
      if (allowed.has(tok)) return (v) => v[tok];
      if (Object.hasOwn(CONSTS, tok)) { const n = CONSTS[tok]; return () => n; }
      throw new Error(`Unknown name "${tok}"`);
    }
    throw new Error(`Unexpected "${tok}"`);
  }
  const fn = expr();
  if (i < t.length) throw new Error(`Unexpected "${t[i]}"`);
  return (vals) => {
    const r = fn(vals || {});
    return typeof r === "number" ? r : NaN;
  };
}

// Lanczos gamma, for n!.
function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  z -= 1;
  let x = c[0];
  for (let k = 1; k < g + 2; k++) x += c[k] / (z + k);
  const tt = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(tt, z + 0.5) * Math.exp(-tt) * x;
}

// Answer checking shared by questions and practice steps.
export function normalizeAnswer(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\$|\\,|\\!|\s+/g, "")
    .replace(/\\cdot|\\times|·|×/g, "*")
    .replace(/[{}]/g, "")
    .replace(/\*\*/g, "^")
    .replace(/^\(?(.*?)\)?$/, "$1")
    .replace(/\.$/, "");
}

export function parseNumber(s) {
  const t = String(s ?? "").trim().replace(/,/g, "").replace(/−/g, "-");
  const frac = t.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const pct = t.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  if (pct) return Number(pct[1]) / 100;
  if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return Number(t);
  try {
    const v = compileExpr(t, [])({});
    return Number.isFinite(v) ? v : NaN;
  } catch {
    return NaN;
  }
}

export function checkNumber(input, answer, tolerance) {
  const v = parseNumber(input);
  const a = typeof answer === "number" ? answer : parseNumber(answer);
  if (!Number.isFinite(v) || !Number.isFinite(a)) return null;
  const tol = Number.isFinite(Number(tolerance)) && Number(tolerance) > 0 ? Number(tolerance) : Math.max(1e-9, Math.abs(a) * 1e-6);
  return Math.abs(v - a) <= tol + 1e-12;
}

// Short-text answers: exact after normalization, else "unknown" (the tutor judges).
export function checkText(input, answer) {
  if (answer == null || answer === "") return null;
  const answers = Array.isArray(answer) ? answer : [answer];
  const n = normalizeAnswer(input);
  if (!n) return false;
  if (answers.some((a) => normalizeAnswer(a) === n)) return true;
  const num = answers.map((a) => parseNumber(a)).find((x) => Number.isFinite(x));
  if (num != null && checkNumber(input, num) === true) return true;
  return null;
}
