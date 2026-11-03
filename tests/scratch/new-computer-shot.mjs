import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import "../../electron/main.js";
setTimeout(() => app.exit(2), 60000);
app.whenReady().then(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(2500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1500, 950);
  await wait(9000);
  const r = await win.webContents.executeJavaScript(`[...document.querySelectorAll(".welcome-overlay .connect-card")].map(c => c.querySelector("b").textContent + ": " + c.querySelector(".connect-chip").textContent + " | " + (c.querySelector(".connect-account").hidden ? "-" : c.querySelector(".connect-account").textContent.replace(/([A-Za-z0-9._%+-]{2})[A-Za-z0-9._%+-]*@/, "$1…@")) + " | [" + [...c.querySelectorAll(".connect-actions > *")].map(b => b.textContent).join(", ") + "]")`);
  console.log("CARDS " + r.join("\nCARDS "));
  win.webContents.invalidate(); await wait(400);
  fs.writeFileSync(process.env.SHOT, (await win.webContents.capturePage()).toPNG());
  app.exit(0);
});
