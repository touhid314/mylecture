// Board-only check of pointing at parts (curves, table cells, flow boxes, code lines).
//   MYLECTURE_PROFILE=<dir> npx electron tests/scratch/study-board.mjs --out=<dir>
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import "../../electron/main.js";
const EQ = "f'(x) = \\lim_{h \\to 0} \\frac{\\htmlId{rise}{f(x+h) - f(x)}}{\\htmlId{run}{h}}";
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6) || ".";
setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1500, 940); win.setFocusable(false); win.webContents.setAudioMuted(true); win.webContents.setBackgroundThrottling(false); win.showInactive();
  win.webContents.on("console-message", (d) => console.log("CONSOLE", d.message.slice(0, 300)));
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => { win.webContents.invalidate(); await wait(300); fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG()); };
  await wait(2500);
  await js(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Skip for now")?.click()`);
  await wait(500);
  await js(`(() => { const v = window.__mlStudy; v._enter({ id: "tut-uicheck", topic: "Pointing check", title: "Pointing check", plan: ["The big picture", "The chain rule as blame-passing", "Working backward"], section: 2, history: [], board: [] });
    const b = v.board;
    b.draw({ type: "page", text: "Pointing check" });
    b.draw({ type: "write", id: "def", text: "**Derivative** = the rate of change of a function" });
    b.draw({ type: "page", text: "Parts" });
    b.draw({ type: "plot", id: "p1", data: { fns: ["x^2", "2*x-1"], x: [-3, 3], points: [[1, 1, "A"]], labels: ["$f(x) = x^2$", "tangent"] } });
    b.draw({ type: "table", id: "t1", data: { head: ["n", "n!"], rows: [["1", "1"], ["2", "2"], ["3", "6"]] } });
    b.draw({ type: "flow", id: "fl", data: { nodes: ["Input", "Hidden layer", "Output"] } });
    b.draw({ type: "code", id: "c1", data: { lang: "python", src: "def f(n):\\n    if n == 0:\\n        return 1\\n    return n * f(n - 1)" } });
    b.draw({ type: "scene", id: "sc", data: { w: 600, h: 160, items: [{ type: "line", id: "road", x1: 20, y1: 120, x2: 580, y2: 120, stroke: "#555", width: 4 }, { type: "rect", x: 60, y: 30, w: 120, h: 50, fill: "lightblue" }, { type: "text", x: 120, y: 60, text: "box A", size: 18 }] } });
    return "ok"; })()`);
  await wait(4000);
  const cases = [["p1", "this blue line is the parabola"], ["p1.f2", ""], ["p1.tangent", ""], ["p1.A", ""], ["t1.col2", ""], ["t1.n!", ""], ["t1.row3", ""], ["fl.hidden layer", ""], ["fl", "the output box"], ["c1.line3", ""], ["sc.road", ""], ["sc", "the lightblue box"]];
  for (const [ref, hint] of cases) {
    const ok = await js(`window.__mlStudy.board.point(${JSON.stringify(ref)}, ${JSON.stringify(hint)})`);
    await wait(700);
    const what = await js(`(() => { const h = document.querySelector(".wb-halo:not(.out)"); if (h) return "halo " + h.tagName + " next=" + (h.nextElementSibling?.getAttribute("data-part") || h.nextElementSibling?.tagName); const m = document.querySelector(".wb-mark:not(.out)"); return m ? "box " + m.style.width + "x" + m.style.height : "none"; })()`);
    console.log("POINT", ref, JSON.stringify(hint), ok, what);
    await shot(`part-${ref.replace(/[^\w]/g, "_")}.png`);
  }
  app.exit(0);
});
