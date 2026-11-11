// Drives the real lesson playback (audio element, audio clock, board) with a
// stub voice: one 3 s clip whose word timings are known, and checks that
// {show:id} visuals appear on their word, not when the sentence starts.
import { app, BrowserWindow, protocol, net, ipcMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pcmToWav } from "../../electron/tts/audio.js";

const report = process.argv[2];
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-sync-profile-"));
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
app.setPath("userData", temp);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const finish = (result) => {
  fs.writeFileSync(report, JSON.stringify(result));
  app.exit(result.error ? 1 : 0);
};

// 3 s of silence: the words' times come from the stub, not the audio.
const sr = 16000;
const pcm = new Int16Array(sr * 3);
// Silence: only the clip's length matters (word times come from the stub).
const wav = pcmToWav(pcm, sr);
const WORDS = {
  // "First this apple, and then this banana here."
  "First this apple, and then this banana here.": [[0, 0.3], [0.3, 0.6], [1.0, 1.4], [1.6, 1.8], [1.8, 2.0], [2.0, 2.2], [2.2, 2.7], [2.7, 3.0]],
};

app.whenReady().then(async () => {
  protocol.handle("mylecture", (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/sync-check") return new Response('<!doctype html><link rel="stylesheet" href="mylecture://app/css/study.css"><body></body>', { headers: { "content-type": "text/html" } });
    return net.fetch(pathToFileURL(path.join(appDir, url.pathname.slice(1))).href);
  });
  ipcMain.handle("tts:synth", (_, text) => ({ url: "data:audio/wav;base64," + wav.toString("base64"), dur: 3, words: WORDS[text] || null }));
  ipcMain.handle("study:save", (_, s) => s);
  const win = new BrowserWindow({ show: false, width: 960, height: 700, webPreferences: { preload: fileURLToPath(new URL("../../electron/preload.cjs", import.meta.url)), contextIsolation: true, backgroundThrottling: false, offscreen: true } });
  // Never make a sound on the developer's speakers: the clip still plays
  // (its timing is what's tested), muted.
  win.webContents.setAudioMuted(true);
  try {
    await win.loadURL("mylecture://app/sync-check");
    const result = await win.webContents.executeJavaScript(`(async () => {
      const {Board} = await import('mylecture://app/js/study/board.js');
      const {Voice} = await import('mylecture://app/js/study/speech.js');
      const {Lesson} = await import('mylecture://app/js/study/tutor-view.js');
      const board = new Board(); document.body.append(board.root); board.newPage('Fruit');
      const voice = new Voice();
      const stub = () => {};
      const view = { board, voice, setStatus: stub, setCaption: stub, renderAgenda: stub, setReplay: stub, setReplayPosition: stub,
        addTranscript: () => { const d = document.createElement('div'); d.append(document.createElement('span')); return d; },
        transcript: document.createElement('div'), timer: document.createElement('span') };
      const lesson = new Lesson(view, { id: 'sync', topic: 'fruit', history: [], board: [], plan: [] });
      const seg = { turnId: 't1' };
      lesson.gen = seg;
      const seen = {};
      let t0 = 0;
      const events = [];
      for (const ev of ['play', 'playing', 'error', 'ended']) voice.audio.addEventListener(ev, () => { events.push(ev + (ev === 'error' ? ':' + voice.audio.error?.message : '')); if (ev === 'playing') t0 ||= performance.now(); });
      new MutationObserver(() => {
        for (const id of ['a', 'b', 'c']) if (!seen[id] && board.items.has(id) && board.items.get(id).isConnected) seen[id] = t0 ? voice.audio.currentTime : -1; // the audio's own clock: what sync means
      }).observe(board.root, { childList: true, subtree: true });
      // The visual lines come first, then the sentence that names them;
      // c arrives only after the sentence (it is still being written).
      lesson._receive(seg, { type: 'write', id: 'a', text: 'Apple', raw: 'write#a: Apple' });
      lesson._receive(seg, { type: 'write', id: 'b', text: 'Banana', raw: 'write#b: Banana' });
      lesson._receive(seg, { type: 'say', line: 3, text: 'First this {show:a} apple, and then this {show:b} banana {show:c} here.', raw: '' });
      await new Promise((r) => setTimeout(r, 2600));
      lesson._receive(seg, { type: 'write', id: 'c', text: 'Here', raw: 'write#c: Here' });
      lesson.gen = null;
      lesson._receive(seg, { type: 'end', value: 'wait' });
      // Until the clip has played out (it can start late on a busy machine).
      for (let i = 0; i < 100 && !events.includes('ended'); i++) await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => setTimeout(r, 300));
      // Map cues in speech: {zoom:...} moves the camera, {trace:...} draws a route.
      const seg2 = { turnId: 't2' };
      lesson.gen = seg2;
      lesson.awaiting = null;
      lesson._receive(seg2, { type: 'map', id: 'mm', data: { view: 'world', places: [{ id: 'tokyo', lon: 139.7, lat: 35.7, label: 'Tokyo' }, { id: 'sf', lon: -122.4, lat: 37.8, label: 'San Francisco' }], routes: [{ id: 'fl', from: 'tokyo', to: 'sf', trace: true, hidden: true, dur: 1, great_circle: true }] }, raw: 'map#mm: {}' });
      lesson._receive(seg2, { type: 'say', line: 9, text: 'Over to {zoom:mm/Japan} Japan, and then {trace:mm.fl} across the Pacific.', raw: '' });
      lesson.gen = null;
      lesson._receive(seg2, { type: 'end', value: 'wait' });
      const mapSvg = () => document.querySelector('svg.wb-map');
      const widths = [];
      for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 60)); if (mapSvg()) widths.push(Number(mapSvg().getAttribute('viewBox').split(' ')[2])); }
      const fl = mapSvg()?.querySelector('[data-id=fl]');
      const mapCues = { zoomed: widths.some((w) => w < 400), traced: !!fl && fl.style.opacity === '1' && fl.querySelector('.wb-map-line').style.opacity === '1' };
      lesson.close();
      return { seen, events, mapCues, history: lesson.s.history.map((h) => h.text) };
    })()`);
    finish(result);
  } catch (error) { finish({ error: String(error.stack || error) }); }
});
