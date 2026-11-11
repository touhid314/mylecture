// Shared by the renderer (captions/cue positions) and every TTS engine.
// Keep board LaTeX intact; speech receives a separate verbal representation.
export function normalizeLatex(value) {
  const text = String(value ?? "");
  // Raw protocol lines sometimes contain JSON-escaped commands. Preserve
  // genuine TeX row breaks when normal, single-backslash commands exist.
  return /(?<!\\)\\[a-zA-Z]/.test(text) ? text : text.replace(/\\\\(?=[a-zA-Z])/g, "\\");
}

export function isMathExpression(value) {
  return /[\\^_{}=+*/<>-]/.test(value) || /^\s*(?:[A-Za-z]{1,3}|\d+(?:\.\d+)?|[A-Za-z][A-Za-z0-9]*['′]?\s*\([^)]*\)|[A-Za-z](?:\s+[A-Za-z])+)\s*$/.test(value);
}

const COMMANDS = {
  alpha: "alpha", beta: "beta", gamma: "gamma", Gamma: "gamma", delta: "delta", Delta: "delta", epsilon: "epsilon", varepsilon: "epsilon",
  theta: "theta", vartheta: "theta", lambda: "lambda", Lambda: "lambda", mu: "mu", nu: "nu", xi: "xi", pi: "pi", Pi: "pi",
  rho: "rho", sigma: "sigma", Sigma: "sigma", tau: "tau", phi: "phi", varphi: "phi", Phi: "phi", chi: "chi", psi: "psi", omega: "omega", Omega: "omega",
  cdot: "times", times: "times", div: "divided by", pm: "plus or minus", mp: "minus or plus",
  le: "less than or equal to", leq: "less than or equal to", ge: "greater than or equal to", geq: "greater than or equal to", ne: "not equal to", neq: "not equal to",
  approx: "approximately", equiv: "equivalent to", to: "approaches", rightarrow: "goes to", Rightarrow: "implies", infty: "infinity",
  partial: "partial", nabla: "del", sum: "the sum", prod: "the product", int: "the integral", iint: "the double integral", oint: "the contour integral",
  sin: "sine", cos: "cosine", tan: "tangent", arcsin: "inverse sine", arccos: "inverse cosine", arctan: "inverse tangent", ln: "natural log", log: "log", exp: "exponential", lim: "the limit",
  in: "in", notin: "not in", subset: "a subset of", cup: "union", cap: "intersection", forall: "for all", exists: "there exists", ldots: "and so on", cdots: "and so on",
};

export function mathToSpeech(value) {
  const source = normalizeLatex(value);
  let at = 0;
  const group = () => {
    while (/\s/.test(source[at] || "") && at < source.length) at++;
    if (source[at] === "\\") {
      const command = source.slice(at).match(/^\\[A-Za-z]+/)?.[0];
      if (command) { at += command.length; return command; }
    }
    if (source[at] !== "{") return source[at++] || "";
    let depth = 1, start = ++at;
    while (at < source.length && depth) {
      if (source[at] === "{") depth++;
      if (source[at] === "}") depth--;
      at++;
    }
    return source.slice(start, depth ? at : at - 1);
  };
  let out = "";
  while (at < source.length) {
    const ch = source[at++];
    if (ch === "\\") {
      const name = source.slice(at).match(/^[A-Za-z]+/)?.[0];
      if (!name) { at++; out += " "; continue; }
      at += name.length;
      if (/^(?:int|iint|oint|sum|prod|lim)$/.test(name)) {
        let lower = "", upper = "";
        for (let i = 0; i < 2; i++) {
          while (/\s/.test(source[at] || "") && at < source.length) at++;
          if (source[at] !== "_" && source[at] !== "^") break;
          const kind = source[at++], bound = mathToSpeech(group());
          if (kind === "_") lower = bound; else upper = bound;
        }
        out += ` ${COMMANDS[name]}${lower ? `${name === "lim" ? " as" : " from"} ${lower}` : ""}${upper ? ` to ${upper}` : ""} of `;
      } else if (/^(?:dfrac|tfrac|frac)$/.test(name)) {
        const numerator = group(), denominator = group();
        const derivative = numerator.match(/^(d|\\partial)\s*([A-Za-z]?)$/);
        const variable = denominator.match(/^(?:d|\\partial)\s*([A-Za-z])$/);
        out += derivative && variable
          ? ` the ${derivative[1] === "d" ? "derivative" : "partial derivative"}${derivative[2] ? ` of ${derivative[2]}` : ""} with respect to ${variable[1]} `
          : ` ${mathToSpeech(numerator)} over ${mathToSpeech(denominator)} `;
      } else if (name === "sqrt") {
        let order = "";
        if (source[at] === "[") { const end = source.indexOf("]", at); if (end >= 0) { order = source.slice(at + 1, end); at = end + 1; } }
        out += ` ${order === "3" ? "cube root of" : order ? `${mathToSpeech(order)} root of` : "square root of"} ${mathToSpeech(group())} `;
      } else if (/^(?:text|textrm|textnormal|mathrm|mathbf|mathit|mathsf|mathbb|operatorname|boldsymbol|overline|underline)$/.test(name)) {
        const content = group();
        out += ` ${/^text|operatorname/.test(name) ? content : mathToSpeech(content)} `;
      } else if (/^html(?:Id|Class)$/.test(name)) {
        group(); out += ` ${mathToSpeech(group())} `;
      } else if (/^(?:left|right|big|Big|bigg|Bigg|displaystyle|textstyle|quad|qquad|limits|nolimits)$/.test(name)) {
        out += " ";
      } else if (name === "begin" || name === "end") {
        group(); out += " ";
      } else out += ` ${COMMANDS[name] || name} `;
    } else if (ch === "^" || ch === "_") {
      const power = mathToSpeech(group());
      out += ch === "_" ? ` sub ${power} ` : power === "2" ? " squared " : power === "3" ? " cubed " : ` to the power of ${power} `;
    } else if (ch === "{") {
      at--; out += ` ${mathToSpeech(group())} `;
    } else if (/[A-Za-z]/.test(ch)) {
      const rest = source.slice(at).match(/^[A-Za-z]*/)[0]; at += rest.length;
      const word = ch + rest;
      out += word.length > 1 && word.length <= 3 && !/^(?:sin|cos|tan|log|ln|lim|max|min)$/.test(word)
        ? /^d[A-Za-z]$/.test(word) ? ` d ${word[1]} ` : ` ${word.split("").join(" times ")} `
        : ` ${COMMANDS[word] || word} `;
    } else out += ({ "=": " equals ", "+": " plus ", "-": " minus ", "<": " less than ", ">": " greater than ", "/": " divided by ", "*": " times ", "!": " factorial ", "|": " absolute value ", "&": " ", "}": " " })[ch] ?? ch;
  }
  out = out.replace(/\s+/g, " ").trim();
  out = out.replace(/\b([fghuv])\s*\(\s*([^()]*)\)/g, "$1 of $2").trim();
  if (/\bintegral\b/.test(out)) out = out.replace(/\bd ([A-Za-z])\b/g, "with respect to $1");
  return out;
}

export function normalizeForSpeech(value) {
  let text = String(value ?? "");
  text = text.replace(/\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$])\$([^$\n]+?)\$/g, (match, a, b, c, d) => {
    const math = a ?? b ?? c ?? d;
    // Do not join the currency amounts in "Costs $5 and $10" into math.
    if (d != null && !isMathExpression(math)) return match;
    return mathToSpeech(math);
  });
  // Raw LaTeX commands can also leak into otherwise spoken prose.
  text = text.replace(/\\(?:[dt]?frac\s*\{[^{}]*\}\s*\{[^{}]*\}|sqrt\s*\{[^{}]*\}|[A-Za-z]+\b)/g, mathToSpeech);
  return text
    .replace(/[*_`#]/g, "")
    .replace(/\s*→\s*/g, " to ").replace(/\s*⇒\s*/g, " implies ")
    .replace(/≈/g, " approximately ").replace(/×/g, " times ").replace(/÷/g, " divided by ")
    .replace(/≤/g, " less than or equal to ").replace(/≥/g, " greater than or equal to ").replace(/≠/g, " not equal to ")
    .replace(/√/g, " square root of ").replace(/π/g, " pi ").replace(/θ/g, " theta ").replace(/λ/g, " lambda ").replace(/Δ/g, " delta ")
    .replace(/∑/g, " the sum of ").replace(/∞/g, " infinity ")
    .replace(/(\w)\^2\b/g, "$1 squared").replace(/(\w)\^3\b/g, "$1 cubed")
    .replace(/²/g, " squared").replace(/³/g, " cubed")
    .replace(/\s+([,.!?;:])/g, "$1").replace(/\s+/g, " ").trim();
}
