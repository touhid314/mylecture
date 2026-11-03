// Boots the app and reports which rail tabs exist and which view is active.
//   npx electron tests/scratch/boot-check.mjs
import { app, BrowserWindow } from "electron";
import "../../electron/main.js";

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 3000));
  const wc = BrowserWindow.getAllWindows()[0].webContents;
  const r = await wc.executeJavaScript(`({
    tabs: [...document.querySelectorAll(".rail-btn[data-view]")].map(b => b.dataset.view),
    active: document.querySelector(".view.active")?.id,
    studyView: !!document.getElementById("view-study"),
  })`);
  console.log("BOOT", JSON.stringify(r));
  app.exit(0);
});
