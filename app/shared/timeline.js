// Shared timeline math. Loaded as a classic <script> in the stage sandbox and
// the app window, and imported for side effects by the Electron main process.
// All three must agree exactly on when every beat starts, so the preview,
// the live player and the MP4 exporter stay frame-identical.
(function (g) {
  const SCENE_LEAD = 0.35; // silence before the first beat (scene fade-in)
  const BEAT_GAP = 0.3; // pause between beats
  const SCENE_TAIL = 0.9; // hold after the last beat
  const WORDS_PER_SEC = 2.6;

  function estimateDur(text) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1.4, words / WORDS_PER_SEC);
  }

  function beatDur(b) {
    return b && b.dur > 0 ? b.dur : estimateDur(b && b.text);
  }

  // Returns { scenes: [{start, dur, beats:[{start (scene-local), dur}]}], total }
  function build(scenes) {
    let t = 0;
    const out = [];
    for (const sc of scenes || []) {
      // LectureGen HTML scenes follow the original resolver: segments are
      // back to back (no lead, gaps or tail), each as long as its audio.
      const html = sc && sc.kind === "html";
      let local = html ? 0 : SCENE_LEAD;
      const beats = [];
      const list = sc && sc.beats && sc.beats.length ? sc.beats : [{ text: (sc && sc.title) || "" }];
      list.forEach((b, i) => {
        const d = beatDur(b);
        beats.push({ start: local, dur: d });
        local += d + (!html && i < list.length - 1 ? BEAT_GAP : 0);
      });
      const dur = local + (html ? 0 : SCENE_TAIL);
      out.push({ start: t, dur, beats });
      t += dur;
    }
    return { scenes: out, total: t };
  }

  // Locate global time t: { scene, local, beat, bt }
  function locate(tl, t) {
    if (!tl.scenes.length) return null;
    let si = tl.scenes.length - 1;
    for (let i = 0; i < tl.scenes.length; i++) {
      if (t < tl.scenes[i].start + tl.scenes[i].dur) {
        si = i;
        break;
      }
    }
    const sc = tl.scenes[si];
    const local = Math.max(0, Math.min(sc.dur, t - sc.start));
    let bi = 0;
    for (let i = 0; i < sc.beats.length; i++) if (local >= sc.beats[i].start) bi = i;
    return { scene: si, local, beat: bi, bt: local - sc.beats[bi].start };
  }

  g.MLTimeline = { build, locate, estimateDur, beatDur, SCENE_LEAD, BEAT_GAP, SCENE_TAIL };
})(globalThis);
