// The live tutor's script: one command per line, streamed and executed in order.
//
//   say: Spoken words (one or more sentences).
//   write: Board note in Markdown, $inline math$ allowed.
//   math: Display LaTeX.
//   page: Title of a fresh board page.
//   plan: ["Section 1", "Section 2", ...]
//   section: 2
//   plot | table | code | svg | flow | ask | practice | explore: {JSON} (svg: raw <svg>)
//   end: continue | wait | done
//
// Speech is emitted sentence by sentence while a `say:` line is still
// streaming, so the voice can start before the model finishes the line.

export const BOARD_KINDS = ["write", "math", "page", "plot", "table", "code", "svg", "flow", "image", "scene", "annotate", "html", "map"];
export const INTERACTIVE_KINDS = ["ask", "practice", "explore"];
const JSON_KINDS = new Set(["plan", "plot", "table", "code", "flow", "ask", "practice", "explore", "image", "scene", "annotate", "html", "map"]);
const KNOWN = new Set(["say", "section", "end", "pause", "search", "inspect", ...BOARD_KINDS, ...INTERACTIVE_KINDS, "plan", "note"]);
const ALIASES = { speak: "say", says: "say", tutor: "say", board: "write", text: "write", heading: "write", title: "page", latex: "math", equation: "math", question: "ask", quiz: "ask", exercise: "practice", interactive: "explore", graph: "plot", diagram: "svg", animation: "scene", animate: "scene", picture: "image", photo: "image", outline: "plan", agenda: "plan", geo: "map", globe: "map", atlas: "map" };

// Lenient JSON for model output: tolerates code fences, trailing commas and
// text around the object.
export function parseLooseJson(text) {
  let s = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(s); } catch {}
  const start = s.search(/[[{]/);
  if (start < 0) return undefined;
  const open = s[start], close = open === "{" ? "}" : "]";
  const end = s.lastIndexOf(close);
  if (end <= start) return undefined;
  s = s.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(s); } catch { return undefined; }
}

// Splits finished sentences off the front of `text`. Returns [sentences, rest].
// Short fragments are kept with the next sentence so the voice doesn't chop.
export function takeSentences(text, { final = false, min = 60 } = {}) {
  const out = [];
  let rest = text;
  const re = /[.!?…]+["')\]]*\s+(?=\S)|[;:]\s+(?=[A-Z])/g;
  let from = 0, m;
  while ((m = re.exec(rest))) {
    const cut = m.index + m[0].length;
    const piece = rest.slice(from, cut).trim();
    // Don't split "e.g. " / "i.e. " / "Dr. " / "3.5".
    if (/\b(e\.g|i\.e|vs|etc|Dr|Mr|Mrs|Ms|St|Fig|No)\.\s*$/i.test(piece)) continue;
    if (piece.length < min) continue;
    out.push(piece);
    from = cut;
  }
  rest = rest.slice(from);
  if (final && rest.trim()) {
    out.push(rest.trim());
    rest = "";
  }
  return [out, rest];
}

function classify(line) {
  const m = line.match(/^\s*[-*]?\s*([A-Za-z_]+)\s*(?:#([\w-]+))?\s*:\s?(.*)$/s);
  if (!m) return null;
  let kind = m[1].toLowerCase();
  kind = ALIASES[kind] || kind;
  if (!KNOWN.has(kind)) return null;
  return { kind, id: m[2] || "", body: m[3] };
}

export function lineToAction(line) {
  const raw = line.replace(/\s+$/, "");
  if (!raw.trim()) return null;
  if (/^\s*```/.test(raw)) return null;
  const c = classify(raw);
  // Plain prose with no command: the model drifted; speak it.
  if (!c) return { type: "say", text: raw.trim(), raw };
  const { kind, id, body } = c;
  if (kind === "note") return null;
  if (kind === "end") {
    const v = body.trim().toLowerCase();
    return { type: "end", value: /wait/.test(v) ? "wait" : /done|finish|complete/.test(v) ? "done" : "continue", raw };
  }
  if (kind === "pause") {
    const sec = parseFloat(body);
    return { type: "pause", seconds: Number.isFinite(sec) ? Math.min(4, Math.max(0.2, sec)) : 1, raw };
  }
  if (kind === "section") {
    const n = parseInt(body, 10);
    return Number.isFinite(n) ? { type: "section", index: n, raw } : null;
  }
  if (kind === "say") return body.trim() ? { type: "say", text: body.trim(), raw } : null;
  if (JSON_KINDS.has(kind)) {
    const data = parseLooseJson(body);
    if (data === undefined) {
      // Plain text for simple kinds is still usable.
      if (kind === "plan") return { type: "plan", items: body.split(/\s*[|;]\s*/).filter(Boolean), raw };
      return { type: "invalid", kind, raw };
    }
    if (kind === "plan") return { type: "plan", items: (Array.isArray(data) ? data : data.sections || data.items || []).map((s) => (typeof s === "string" ? s : s?.title || "")).filter(Boolean), raw };
    return { type: kind, id, data, raw };
  }
  return { type: kind, id, text: body.trim(), raw };
}

// Incremental parser. onAction receives each action as soon as it is complete;
// say lines arrive as one action per sentence with the same `line` number.
// onUpcoming(kind), optional: called as soon as it's known what comes after the
// last action ("say" while a say line goes on, or the command of the next
// line, e.g. "scene", before that line has finished streaming).
// The first end line is final: everything written after it is dropped
// (counted in `dropped`), so trailing chatter never reaches the student.
export function createTutorParser(onAction, { onUpcoming } = {}) {
  let emitted = 0, announced = -1;
  let ended = false, dropped = 0;
  const emit = onAction;
  onAction = (a) => {
    if (ended) return;
    emitted++;
    if (a.type === "end") ended = true;
    emit(a);
  };
  const announce = (kind) => {
    if (!onUpcoming || announced === emitted) return;
    announced = emitted;
    onUpcoming(kind);
  };
  let buf = "";
  let lineNo = 0;
  let sayOpen = false; // current partial line is a say line
  let sayRest = ""; // unspoken tail of the current say line
  let sayRaw = "";

  const emitSay = (text, final) => {
    const [sentences, rest] = takeSentences(text, { final });
    for (const s of sentences) onAction({ type: "say", text: s, line: lineNo, raw: "" });
    return rest;
  };

  const finishLine = (line) => {
    if (sayOpen) {
      // Speak what is left of the say line.
      const all = (line.match(/^\s*(?:say|speak|tutor)\s*:\s?(.*)$/is)?.[1] ?? line).trimEnd();
      const spokenSoFar = sayRaw.length - sayRest.length;
      const tail = all.slice(Math.max(0, spokenSoFar));
      emitSay(tail, true);
      sayOpen = false;
      sayRest = "";
      sayRaw = "";
    } else {
      const a = lineToAction(line);
      if (a) {
        if (a.type === "say") {
          for (const s of takeSentences(a.text, { final: true })[0]) onAction({ type: "say", text: s, line: lineNo, raw: "" });
        } else {
          onAction({ ...a, line: lineNo });
        }
      }
    }
    lineNo++;
  };

  return {
    get ended() { return ended; },
    get dropped() { return dropped; },
    feed(chunk) {
      if (ended) {
        dropped += chunk.length;
        return;
      }
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        finishLine(line);
        if (ended) {
          dropped += buf.length;
          buf = "";
          return;
        }
      }
      // Stream speech from a say line that hasn't ended yet.
      const m = buf.match(/^\s*(?:say|speak|tutor)\s*:\s?(.*)$/is);
      if (m) {
        sayOpen = true;
        const body = m[1];
        const spokenSoFar = sayRaw.length - sayRest.length;
        sayRaw = body;
        const pending = body.slice(spokenSoFar);
        const rest = emitSay(pending, false);
        sayRest = rest;
        if (rest.trim()) announce("say");
      } else {
        const k = buf.match(/^\s*([a-z]+)\s*(?:#[\w-]+\s*)?:/i)?.[1]?.toLowerCase();
        if (k) announce(ALIASES[k] || k);
      }
    },
    end() {
      if (!ended && buf.trim()) finishLine(buf);
      buf = "";
    },
  };
}
