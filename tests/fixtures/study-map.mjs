// Renders tutor maps in the real board: highlighted countries, places, a
// moving route; zooming in and out (labels keep their size); view-only and
// incremental updates; tracing a route with stops lighting up and the camera
// following; a great-circle flight.
import { app, BrowserWindow, protocol, net } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const report = process.argv[2];
const shots = process.argv[3]; // optional folder for screenshots
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ml-map-profile-"));
const appDir = fileURLToPath(new URL("../../app/", import.meta.url));
app.setPath("userData", temp);
protocol.registerSchemesAsPrivileged([{ scheme: "mylecture", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const finish = (result) => { fs.writeFileSync(report, JSON.stringify(result)); app.exit(result.error ? 1 : 0); };
app.whenReady().then(async () => {
  protocol.handle("mylecture", (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/map-check") return new Response('<!doctype html><link rel="stylesheet" href="mylecture://app/css/study.css"><body style="margin:0;height:760px;display:flex"></body>', { headers: { "content-type": "text/html" } });
    return net.fetch(pathToFileURL(path.join(appDir, url.pathname.slice(1))).href);
  });
  // Offscreen rendering runs at a normal frame rate (a hidden window barely
  // advances animations).
  const win = new BrowserWindow({ show: false, width: 1100, height: 760, webPreferences: { preload: fileURLToPath(new URL("../../electron/preload.cjs", import.meta.url)), contextIsolation: true, backgroundThrottling: false, offscreen: true } });
  const shot = async (name) => { if (shots) fs.writeFileSync(path.join(shots, name), (await win.webContents.capturePage()).toPNG()); };
  try {
    await win.loadURL("mylecture://app/map-check");
    const run = (js) => win.webContents.executeJavaScript(js);
    await run(`(async () => {
      const {Board} = await import('mylecture://app/js/study/board.js');
      window.board = new Board(); document.body.append(board.root); board.newPage('Trade routes');
      window.wait = async (ms) => { const t = performance.now(); while (performance.now() - t < ms) await new Promise((r) => requestAnimationFrame(r)); };
      window.svg = () => document.querySelector('svg.wb-map');
      window.q = (s) => svg().querySelector(s);
      // Label height per 1000 px of drawn map (the frame may letterbox it).
      window.labelPx = (id) => { const r = svg().getBoundingClientRect(); return Math.round(1000 * q('[data-id=' + id + '] text').getBoundingClientRect().height / Math.min(r.width, (r.height * 16) / 9)); };
      window.width = () => Number(svg().getAttribute('viewBox').split(' ')[2]);
      board.draw({ type: 'map', id: 'm1', data: { view: 'world', countries: [{ name: 'India', id: 'india' }, { name: 'UK', color: '#3b82f6' }], places: [{ id: 'delhi', lon: 77.2, lat: 28.6, label: 'Delhi' }, { id: 'london', lon: -0.13, lat: 51.5, label: 'London', hidden: true }], routes: [{ id: 'r1', from: 'london', to: 'delhi', moving: '🚢', label: 'Spice trade', curve: 0.25 }], caption: 'London to Delhi' } });
      await wait(1500);
    })()`);
    await shot("map-world.png");
    const out = {};
    out.world = await run(`(async () => {
      const box = (e) => e.getBoundingClientRect();
      const inside = (a, b) => a.left + a.width / 2 > b.left && a.left + a.width / 2 < b.right && a.top + a.height / 2 > b.top && a.top + a.height / 2 < b.bottom;
      const o = { countries: svg().querySelectorAll('.wb-map-country').length, land: !!q('.wb-map-land'), delhiInIndia: inside(box(q('[data-id=delhi] circle:last-of-type')), box(q('[data-id=india] path'))),
        londonHidden: q('[data-id=london]').getAttribute('opacity') === '0', mover: !!q('[data-id=r1] animateMotion'), viewWorld: svg().getAttribute('viewBox'), labelWorld: labelPx('delhi') };
      o.revealed = board.reveal('m1.london');
      await wait(800);
      o.londonShown = getComputedStyle(q('[data-id=london]')).opacity === '1';
      // Zoom in to India on a cue, then back out to the map's own view.
      o.zoomIn = board.zoomMap('m1.india');
      const log = [];
      for (let i = 0; i < 8; i++) { await wait(200); log.push(width()); }
      o.zoomLog = log;
      o.labelZoomed = labelPx('delhi');
      o.zoomCountry = board.zoomMap('m1/Japan'); await wait(1500); o.japanWidth = width();
      board.zoomMap('m1'); await wait(1500); o.backOut = svg().getAttribute('viewBox');
      return o;
    })()`);
    out.update = await run(`(async () => {
      // A view-only update keeps everything; update:true adds.
      board.draw({ type: 'map', id: 'm1', data: { focus: 'India' } });
      await wait(1500);
      const o = { keptDelhi: !!q('[data-id=delhi]'), keptLondonShown: q('[data-id=london]').getAttribute('opacity') !== '0', zoomed: width() < 400 };
      board.draw({ type: 'map', id: 'm1', data: { update: true, places: [{ id: 'mumbai', lon: 72.88, lat: 19.08, label: 'Mumbai' }] } });
      await wait(300);
      o.addedMumbai = !!q('[data-id=mumbai]'); o.stillDelhi = !!q('[data-id=delhi]');
      o.maps = document.querySelectorAll('svg.wb-map').length;
      return o;
    })()`);
    await shot("map-india.png");
    out.trace = await run(`(async () => {
      board.draw({ type: 'map', id: 'm2', data: { focus: ['Italy', 'China'], places: [{ id: 'venice', lon: 12.34, lat: 45.44, label: 'Venice' }, { id: 'bagh', lon: 44.4, lat: 33.3, label: 'Baghdad', hidden: true }, { id: 'samar', lon: 66.96, lat: 39.65, label: 'Samarkand', hidden: true }, { id: 'xian', lon: 108.9, lat: 34.3, label: "Xi'an", hidden: true }],
        routes: [{ id: 'silk', from: 'venice', via: ['bagh', 'samar'], to: 'xian', trace: true, hidden: true, dur: 3, moving: '🐫' }] } });
      await wait(1500);
      const svg2 = document.querySelectorAll('svg.wb-map')[1];
      const line = svg2.querySelector('[data-id=silk] .wb-map-line');
      const o = { waiting: getComputedStyle(line).opacity === '0' };
      board.reveal('m2.silk');
      await wait(1300);
      const L = line.getTotalLength();
      o.midDrawn = Number(line.style.strokeDashoffset) > 0 && Number(line.style.strokeDashoffset) < L;
      o.baghLit = svg2.querySelector('[data-id=bagh]').style.opacity === '1';
      o.xianNotYet = svg2.querySelector('[data-id=xian]').style.opacity !== '1';
      // The map is updated mid-trace: the trace carries on, it doesn't jump to the end.
      board.draw({ type: 'map', id: 'm2', data: { update: true, places: [{ id: 'kash', lon: 75.99, lat: 39.47, label: 'Kashgar' }] } });
      await wait(150);
      const line2 = svg2.querySelector('[data-id=silk] .wb-map-line');
      const L2 = line2.getTotalLength();
      o.resumed = line2 !== line && Number(line2.style.strokeDashoffset) > 0 && Number(line2.style.strokeDashoffset) < L2 * 0.8;
      await wait(2200);
      o.done = line2.style.strokeDashoffset === '' && line2.getAttribute('marker-end') !== null;
      o.xianLit = svg2.querySelector('[data-id=xian]').style.opacity === '1';
      // Follow: the camera travels with the traveller.
      board.draw({ type: 'map', id: 'm3', data: { center: [-40, 45], span: 20, places: [{ id: 'ny', lon: -74, lat: 40.7, label: 'New York' }, { id: 'lon', lon: -0.13, lat: 51.5, label: 'London' }], routes: [{ id: 'f', from: 'ny', to: 'lon', great_circle: true, trace: true, follow: true, dur: 2, moving: '✈️' }] } });
      const svg3 = document.querySelectorAll('svg.wb-map')[2];
      const xs = [];
      for (let i = 0; i < 12; i++) { await wait(300); xs.push(Number(svg3.getAttribute('viewBox').split(' ')[0])); }
      o.followMoved = Math.max(...xs) - Math.min(...xs) > 50;
      // The great circle bends north of the straight line (higher on the map).
      const fl = svg3.querySelector('[data-id=f] .wb-map-line');
      const mid = fl.getPointAtLength(fl.getTotalLength() / 2);
      o.greatCircleNorth = mid.y < (Number(fl.getAttribute('d').match(/^M[\\d.]+,([\\d.]+)/)[1]) + 0) && fl.getAttribute('d').split('L').length > 20;
      return o;
    })()`);
    await shot("map-trace.png");
    // The lesson that showed the bug: the USA in view, then London revealed.
    out.frame = await run(`(async () => {
      board.newPage('Birth of the USA');
      board.draw({ type: 'map', id: 'us', data: { focus: ['USA'], places: [{ id: 'boston', lon: -71.06, lat: 42.36, label: 'Boston', hidden: true }, { id: 'london', lon: -0.13, lat: 51.5, label: 'London', hidden: true }], routes: [{ id: 'sea', from: 'london', to: 'boston', dash: true, hidden: true }] } });
      await wait(1600);
      const s = board.items.get('us').querySelector('svg.wb-map');
      const inView = (lon, lat) => { const v = s.getAttribute('viewBox').split(' ').map(Number); const x = 48 + (lon + 180) * (1824 / 360), y = (36 + (972 - 142 * (1824 / 360)) / 2) + (84 - lat) * (1824 / 360); return x > v[0] && x < v[0] + v[2] && y > v[1] && y < v[1] + v[3]; };
      const o = { londonOffAtStart: !inView(-0.13, 51.5) };
      const before = s.getAttribute('viewBox');
      board.reveal('us.boston'); await wait(400);
      o.inViewRevealStays = before === s.getAttribute('viewBox');
      board.reveal('us.london'); await wait(1600);
      o.londonInView = inView(-0.13, 51.5);
      o.bostonStillInView = inView(-71.06, 42.36);
      const wide = s.getAttribute('viewBox');
      board.point('us.boston'); await wait(300);
      o.pointInViewStays = wide === s.getAttribute('viewBox');
      return o;
    })()`);
    await shot("map-london.png");
    // The crowded map from the user's screenshot: the Atlantic in view, the
    // UK, France and Dover piled up in one corner.
    out.crowd = await run(`(async () => {
      board.newPage('The Channel');
      board.draw({ type: 'map', id: 'ch', data: { bounds: [-80, -35, 60, 70], countries: [{ name: 'United Kingdom', id: 'uk', color: '#3b82f6' }, { name: 'France', id: 'fr' }], places: [{ id: 'dover', lon: 1.31, lat: 51.13, label: 'Dover' }, { id: 'calais', lon: 1.86, lat: 50.95, label: 'Calais' }, { id: 'london', lon: -0.13, lat: 51.5, label: 'London' }] } });
      await wait(2600);
      const s = board.items.get('ch').querySelector('svg.wb-map');
      const labels = [...s.querySelectorAll('.wb-map-overlay .wb-map-label')].map((t) => t.getBoundingClientRect());
      const dots = [...s.querySelectorAll('.wb-map-place')].map((g) => { const m = g.querySelector('.wb-map-glyph > :first-child'); return (m.tagName === 'g' ? m.lastElementChild : m).getBoundingClientRect(); });
      const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
      let overlaps = 0;
      labels.forEach((a, i) => { labels.slice(i + 1).forEach((b) => { if (hit(a, b)) overlaps++; }); dots.forEach((d) => { if (hit(a, d)) overlaps++; }); });
      const o = { zoomedIn: Number(s.getAttribute('viewBox').split(' ')[2]) < 500, overlaps, crowded: s.dataset.crowded, view: s.getAttribute('viewBox') };
      // A view the tutor chooses with a zoom cue is kept, labels still placed.
      board.zoomMap('ch/world'); await wait(2000);
      o.keptChosenWorld = s.getAttribute('viewBox') === '0 0 1920 1080';
      board.zoomMap('ch'); await wait(1600);
      return o;
    })()`);
    await shot("map-channel.png");
    finish(out);
  } catch (error) { finish({ error: String(error.stack || error) }); }
});
