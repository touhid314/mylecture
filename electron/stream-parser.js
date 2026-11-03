// Incremental parser for the MyLecture Stream Format.
// Feed it text deltas as they arrive from any engine; it emits structured
// events as soon as each piece is complete:
//   title(text)
//   sceneStart({index, title})
//   beat({scene, index, text})
//   sceneHtml({scene, html})
//   sceneJs({scene, js})
//   sceneEnd({scene, scene: fullSceneObject})
// It tolerates junk outside tags (code fences, chatter) and a missing
// closing </ml-scene> at end of stream.

export class StreamParser {
  constructor(handlers = {}) {
    this.h = handlers;
    this.buf = "";
    this.scenes = [];
    this.title = "";
    this.cur = null;
  }

  emit(name, payload) {
    const fn = this.h[name];
    if (fn) {
      try {
        fn(payload);
      } catch (e) {
        console.error("[parser handler]", name, e);
      }
    }
  }

  push(delta) {
    this.buf += delta;
    this._drain();
  }

  end() {
    // Flush a dangling scene if the model forgot to close it.
    if (this.cur) {
      const rest = this.buf;
      if (!this.cur.jsDone) {
        const m = rest.match(/<ml-js>([\s\S]*)$/);
        if (m) this.cur.js = stripFences(m[1]);
      }
      if (!this.cur.htmlDone && !this.cur.html) {
        const m = rest.match(/<ml-html>([\s\S]*?)(?:<ml-js>|$)/);
        if (m) this.cur.html = stripFences(m[1].replace(/<\/ml-html>/g, ""));
      }
      this._closeScene();
    }
    this.buf = "";
    return { title: this.title, scenes: this.scenes };
  }

  _drain() {
    // Loop until no more complete elements can be consumed.
    for (;;) {
      if (!this.cur) {
        const ti = this.buf.indexOf("<ml-title>");
        const si = this.buf.search(/<ml-scene\b/);
        if (ti !== -1 && (si === -1 || ti < si)) {
          const te = this.buf.indexOf("</ml-title>", ti);
          if (te === -1) return;
          this.title = decode(this.buf.slice(ti + 10, te).trim());
          this.emit("title", this.title);
          this.buf = this.buf.slice(te + 11);
          continue;
        }
        if (si === -1) {
          // Keep only a possible partial tag at the tail.
          const lt = this.buf.lastIndexOf("<");
          this.buf = lt === -1 ? "" : this.buf.slice(lt);
          return;
        }
        const close = this.buf.indexOf(">", si);
        if (close === -1) return;
        const tag = this.buf.slice(si, close + 1);
        const tm = tag.match(/title\s*=\s*"([^"]*)"/) || tag.match(/title\s*=\s*'([^']*)'/);
        this.cur = {
          index: this.scenes.length,
          title: tm ? decode(tm[1]) : `Scene ${this.scenes.length + 1}`,
          beats: [],
          html: "",
          js: "",
        };
        this.emit("sceneStart", { index: this.cur.index, title: this.cur.title });
        this.buf = this.buf.slice(close + 1);
        continue;
      }

      // Inside a scene: find the earliest opening tag of interest.
      const cands = [
        ["say", this.buf.indexOf("<ml-say>")],
        ["html", this.buf.indexOf("<ml-html>")],
        ["js", this.buf.indexOf("<ml-js>")],
        ["end", this.buf.indexOf("</ml-scene>")],
      ].filter((c) => c[1] !== -1);
      if (!cands.length) return;
      cands.sort((a, b) => a[1] - b[1]);
      const [kind, at] = cands[0];
      if (kind === "end") {
        this.buf = this.buf.slice(at + 11);
        this._closeScene();
        continue;
      }
      if (kind === "html") {
        // Models often forget </ml-html> or misplace it, so the HTML section
        // simply runs until the next <ml-js> or </ml-scene>.
        const rest = this.buf.slice(at + 9);
        const m = rest.search(/<ml-js>|<\/ml-scene>/);
        if (m === -1) return;
        this._consume("html", rest.slice(0, m).replace(/<\/ml-html>/g, ""));
        this.buf = rest.slice(m);
        continue;
      }
      const open = { say: "<ml-say>", js: "<ml-js>" }[kind];
      const closeTag = { say: "</ml-say>", js: "</ml-js>" }[kind];
      const ce = this.buf.indexOf(closeTag, at + open.length);
      if (ce === -1) {
        // Robustness: a scene end before the close tag means the close was forgotten.
        const se = this.buf.indexOf("</ml-scene>", at + open.length);
        if (se === -1) return;
        this._consume(kind, this.buf.slice(at + open.length, se));
        this.buf = this.buf.slice(se);
        continue;
      }
      this._consume(kind, this.buf.slice(at + open.length, ce));
      this.buf = this.buf.slice(ce + closeTag.length);
    }
  }

  _consume(kind, body) {
    const sc = this.cur;
    if (kind === "say") {
      const text = decode(body.replace(/\s+/g, " ").trim());
      if (!text) return;
      const index = sc.beats.length;
      sc.beats.push({ text });
      this.emit("beat", { scene: sc.index, index, text });
    } else if (kind === "html") {
      sc.html = repairHtml(stripFences(body));
      sc.htmlDone = true;
      this.emit("sceneHtml", { scene: sc.index, html: sc.html });
    } else if (kind === "js") {
      sc.js = stripFences(body);
      sc.jsDone = true;
      this.emit("sceneJs", { scene: sc.index, js: sc.js });
    }
  }

  _closeScene() {
    const sc = this.cur;
    this.cur = null;
    if (!sc) return;
    if (!sc.beats.length) {
      sc.beats.push({ text: sc.title });
      this.emit("beat", { scene: sc.index, index: 0, text: sc.title });
    }
    const scene = { title: sc.title, beats: sc.beats, html: sc.html, js: sc.js };
    this.scenes.push(scene);
    this.emit("sceneEnd", { index: sc.index, scene });
  }
}

// Close any <style> block that the model left open (CSS never contains "<tag").
export function repairHtml(html) {
  let out = "";
  let rest = html;
  for (;;) {
    const so = rest.search(/<style\b[^>]*>/i);
    if (so === -1) return out + rest;
    const openEnd = rest.indexOf(">", so) + 1;
    const after = rest.slice(openEnd);
    const close = after.search(/<\/style>/i);
    const tag = after.search(/<[a-z!]/i);
    if (close !== -1 && (tag === -1 || close < tag)) {
      const end = openEnd + close + 8;
      out += rest.slice(0, end);
      rest = rest.slice(end);
    } else if (tag !== -1) {
      out += rest.slice(0, openEnd + tag) + "</style>\n";
      rest = rest.slice(openEnd + tag);
    } else {
      return out + rest + "</style>";
    }
  }
}

function stripFences(s) {
  return s.replace(/^\s*```[a-z]*\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "").trim();
}

function decode(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Parse a complete text in one go (used by tests and scene edits).
export function parseAll(text) {
  const p = new StreamParser();
  p.push(text);
  return p.end();
}
