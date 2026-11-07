// Verify Study mode attachments: paste image, attach document, drag-over, and send on Home and Call screens.
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import "../../electron/main.js";

const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6) || ".";
fs.mkdirSync(out, { recursive: true });
setTimeout(() => app.exit(2), 60000);

app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1500, 940);
  win.setFocusable(false);
  win.webContents.setAudioMuted(true);
  win.webContents.setBackgroundThrottling(false);
  win.showInactive();
  win.webContents.on("console-message", (d) => console.log("CONSOLE", d.message.slice(0, 300)));
  const js = (c) => win.webContents.executeJavaScript(c);
  const shot = async (n) => {
    win.webContents.invalidate();
    await wait(300);
    fs.writeFileSync(path.join(out, n), (await win.webContents.capturePage()).toPNG());
  };

  await wait(2500);
  await js(`[...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Skip for now")?.click()`);
  await wait(800);

  // Simulate pasting a PNG image + adding a text file on the Home screen.
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAUSklEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAA8G4wQAABa676AAAAAElFTkSuQmCC";
  await js(`(() => {
    const v = window.__mlStudy;
    const bytes = Uint8Array.from(atob(${JSON.stringify(pngB64)}), c => c.charCodeAt(0));
    const img = new File([bytes], "homework-diagram.png", { type: "image/png" });
    const doc = new File(["1. Find the derivative of x^3\\n2. Explain the chain rule"], "worksheet.txt", { type: "text/plain" });
    v.homeAttachments.add([img, doc]);
  })()`);
  await wait(500);
  await shot("study-home-attachments-blackboard.png");

  await js(`window.__mlStudy._saveSettings({ boardStyle: "whiteboard" })`);
  await wait(600);
  await shot("study-home-attachments-whiteboard.png");

  // Test window.ml.study.attach end-to-end via start()
  const attachedInfo = await js(`(async () => {
    const v = window.__mlStudy;
    const id = await window.ml.study.newId();
    const raw = await v.homeAttachments.serialize();
    const res = await window.ml.study.attach(id, raw);
    v.homeAttachments.clear();
    return { id, count: res.length, mimes: res.map(r => r.mime), text: res[1]?.text };
  })()`);
  console.log("ATTACHED_HOME", JSON.stringify(attachedInfo));

  // Enter call screen and test attachments in the lesson bar
  await js(`(() => {
    const v = window.__mlStudy;
    const plan = ["Why we need memory", "The hidden state loop", "Unrolling through time"];
    v._enter({ id: ${JSON.stringify(attachedInfo.id)}, topic: "Explain this worksheet", title: "Explain this worksheet", plan, section: 2, history: [], board: [], attachments: [] });
    v.board.draw({ type: "page", text: "The hidden state loop" });
    v.board.draw({ type: "write", text: "## Step-by-step recurrence" });
    v.board.draw({ type: "math", text: "h_t = \\\\tanh(W_h h_{t-1} + W_x x_t + b)" });
    v.renderAgenda(plan, 2);
    v.setStatus("waiting", "Your turn");
    const bytes = Uint8Array.from(atob(${JSON.stringify(pngB64)}), c => c.charCodeAt(0));
    const img = new File([bytes], "step2-question.png", { type: "image/png" });
    v.callAttachments.add([img]);
  })()`);
  await wait(800);
  await shot("study-call-attachments.png");

  const callAttached = await js(`(async () => {
    const v = window.__mlStudy;
    const r = await v._takeCallAttachments();
    return { count: r.added.length, name: r.names[0]?.name };
  })()`);
  console.log("ATTACHED_CALL", JSON.stringify(callAttached));

  app.exit(0);
});
