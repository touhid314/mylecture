import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import JSZip from "jszip";

const FORMAT = "mylecture-project";
const MAX_ZIP = 1024 ** 3;
const MAX_BYTES = 2 * MAX_ZIP;
const MAX_FILES = 20000;
const AUDIO_KEY = /^[a-zA-Z0-9_-]{1,128}$/;
const TEXT = /\.(html?|css|[cm]?js|json|md|txt|svg|ya?ml|srt|vtt)$/i;
const SKIP = new Set([".git", "node_modules", ".venv", "__pycache__"]);
const PORTABLE_PREFIX = "mylecture://app/lib/__PROJECT__/";
const sourceStream = file => Readable.from((async function* () { yield* fs.createReadStream(file); })());
const entryStream = entry => new Readable().wrap(entry.nodeStream());

function relativeName(name) {
  if (typeof name !== "string" || !name || name.includes("\\") || name.startsWith("/") || name.includes(":")) throw new Error("Invalid path in project package.");
  const parts = name.split("/");
  if (parts.some(p => !p || p === "." || p === ".." || /[\x00-\x1f<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error("Invalid path in project package.");
  return parts.join("/");
}

function inside(root, name) {
  const target = path.resolve(root, relativeName(name));
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("Invalid project path.");
  return target;
}

function validateLecture(lecture) {
  if (!lecture || lecture.format !== "lecturegen-1" || !Array.isArray(lecture.scenes) || !lecture.scenes.every(s => s && Array.isArray(s.beats))) throw new Error("This is not an editable MyLecture project.");
  for (const scene of lecture.scenes) {
    if (scene.file) relativeName(scene.file);
    if (scene.playbackFile) relativeName(scene.playbackFile);
    for (const beat of scene.beats) {
      if (!beat || typeof beat !== "object") throw new Error("Invalid narration cue in project package.");
      if (beat.audio && (typeof beat.audio !== "string" || !AUDIO_KEY.test(beat.audio))) throw new Error("Invalid narration audio key.");
    }
  }
}

function audioKeys(lecture) {
  return new Set(lecture.scenes.flatMap(s => s.beats.filter(b => !b.visualOnly && b.segment?.kind !== "visual-only" && b.audio).map(b => b.audio)));
}

function portableText(text, workspaceDir, id) {
  const root = path.resolve(workspaceDir);
  const url = pathToFileURL(root + path.sep).href;
  for (const prefix of new Set([url, decodeURI(url)])) text = text.split(prefix).join("./");
  for (const prefix of new Set([JSON.stringify(root).slice(1, -1), root, root.replaceAll("\\", "/")])) text = text.split(prefix).join(".");
  return text.split(`mylecture://app/lib/${encodeURIComponent(id)}/`).join(PORTABLE_PREFIX);
}

function cleanLecture(lecture, workspaceDir) {
  const copy = JSON.parse(JSON.stringify(lecture));
  delete copy.renders;
  for (const scene of copy.scenes) for (const beat of scene.beats) delete beat.url;
  const portablePaths = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "path" && typeof item === "string" && path.isAbsolute(item)) {
        const rel = path.relative(path.resolve(workspaceDir), item);
        if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) value[key] = "./" + rel.split(path.sep).join("/");
      } else portablePaths(item);
    }
  };
  portablePaths(copy);
  return copy;
}

// One editable package: workspace files plus the exact narration clips it uses.
// App settings, model keys, Python environments and voice caches stay outside it.
export async function exportProject({ lecture, workspaceDir, audioDir, file, signal }) {
  signal?.throwIfAborted();
  validateLecture(lecture);
  const zip = new JSZip();
  let bytes = 0, count = 0;
  const add = (name, source, size) => {
    if (++count > MAX_FILES || (bytes += size) > MAX_BYTES) throw new Error("The project is too large to package (2 GB or 20,000 files).");
    zip.file(name, source);
  };
  const walk = (dir, prefix = "") => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(item.name)) continue;
      const name = relativeName(prefix + item.name), full = path.join(dir, item.name);
      if (item.isSymbolicLink()) throw new Error(`Copy linked files into the project before exporting: ${name}`);
      if (item.isDirectory()) walk(full, name + "/");
      else if (item.isFile() && name !== "lecture.json" && path.resolve(full) !== path.resolve(file)) {
        const size = fs.statSync(full).size;
        const source = TEXT.test(name) && size <= 16 * 1024 ** 2 ? portableText(fs.readFileSync(full, "utf8"), workspaceDir, lecture.id) : sourceStream(full);
        add("project/" + name, source, size);
      }
    }
  };
  walk(workspaceDir);
  const metadata = portableText(JSON.stringify(cleanLecture(lecture, workspaceDir), null, 2), workspaceDir, lecture.id);
  add("project/lecture.json", metadata, Buffer.byteLength(metadata));
  for (const key of audioKeys(lecture)) {
    const source = path.join(audioDir, key + ".wav");
    if (!fs.existsSync(source)) throw new Error("Some narration audio is missing. Re-record it before exporting the project.");
    add(`audio/${key}.wav`, sourceStream(source), fs.statSync(source).size);
  }
  zip.file("mylecture-project.json", JSON.stringify({ format: FORMAT, version: 1, createdAt: new Date().toISOString() }));
  if (Object.keys(zip.files).length > MAX_FILES) throw new Error("The project contains too many files and folders.");
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  try {
    await pipeline(zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 3 } }), fs.createWriteStream(tmp, { flags: "wx" }), { signal });
    if (fs.statSync(tmp).size > MAX_ZIP) throw new Error("The project package exceeds 1 GB.");
    fs.renameSync(tmp, file);
    return file;
  } finally { fs.rmSync(tmp, { force: true }); }
}

async function readEntry(entry, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of entryStream(entry)) {
    size += chunk.length;
    if (size > limit) throw new Error("Project metadata is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function restorePaths(value, workspaceDir, id, mapping) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "audio" && typeof item === "string" && mapping.has(item)) value[key] = mapping.get(item);
    else if (typeof item === "string") {
      let next = item.split(PORTABLE_PREFIX).join(`mylecture://app/lib/${id}/`);
      if (key === "path" && /^\.\/attachments\//.test(next)) next = inside(workspaceDir, next.slice(2));
      for (const [oldKey, newKey] of mapping) if (oldKey !== newKey) next = next.split(`mylecture://app/tts/${oldKey}.wav`).join(`mylecture://app/tts/${newKey}.wav`);
      value[key] = next;
    } else restorePaths(item, workspaceDir, id, mapping);
  }
}

export async function importProject({ file, libraryDir, audioDir, id, signal }) {
  signal?.throwIfAborted();
  if (!/^[\w-]+$/.test(id)) throw new Error("Invalid new project id.");
  if (fs.statSync(file).size > MAX_ZIP) throw new Error("Project packages must be 1 GB or smaller.");
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const entries = Object.values(zip.files);
  if (entries.length > MAX_FILES) throw new Error("The project contains too many files.");
  const names = new Set();
  for (const entry of entries) {
    const name = relativeName((entry.unsafeOriginalName || entry.name).replace(/\/$/, ""));
    const canonical = name.normalize("NFC").toLowerCase();
    if (names.has(canonical)) throw new Error("The project has conflicting filenames.");
    names.add(canonical);
    if (name !== "mylecture-project.json" && name !== "project" && name !== "audio" && !name.startsWith("project/") && !name.startsWith("audio/")) throw new Error("Unexpected file in project package.");
    const type = Number(entry.unixPermissions || 0) & 0xf000;
    if (type && type !== (entry.dir ? 0x4000 : 0x8000)) throw new Error("Linked files are not supported in project packages.");
  }
  const header = zip.file("mylecture-project.json"), meta = zip.file("project/lecture.json");
  if (!header || !meta) throw new Error("Choose a MyLecture project package.");
  const manifest = await readEntry(header, 65536);
  if (manifest.format !== FORMAT || manifest.version !== 1) throw new Error("This project package version is not supported.");
  const lecture = await readEntry(meta, 16 * 1024 ** 2);
  validateLecture(lecture);
  fs.mkdirSync(libraryDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.resolve(libraryDir), ".import-"));
  const workspaceDir = inside(libraryDir, id);
  const createdAudio = [];
  let committed = false;
  try {
    let bytes = 0;
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (entry.dir || entry.name === "mylecture-project.json") continue;
      const target = inside(stage, entry.name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const out = fs.createWriteStream(target, { flags: "wx" });
      try {
        await pipeline(entryStream(entry), async function* (source) {
          for await (const chunk of source) {
            if ((bytes += chunk.length) > MAX_BYTES) throw new Error("The expanded project exceeds 2 GB.");
            yield chunk;
          }
        }, out, { signal });
      } catch (error) { out.destroy(); throw error; }
    }
    for (const scene of lecture.scenes) for (const name of [scene.file, scene.playbackFile].filter(Boolean)) {
      const target = inside(path.join(stage, "project"), name);
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw new Error(`The project is missing ${name}.`);
    }
    const mapping = new Map();
    for (const key of audioKeys(lecture)) {
      const source = inside(stage, `audio/${key}.wav`);
      if (!fs.existsSync(source)) throw new Error("The project is missing narration audio.");
      const data = fs.readFileSync(source);
      if (data.length <= 44 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") throw new Error("The project contains invalid narration audio.");
      let newKey = key, target = path.join(audioDir, newKey + ".wav");
      if (fs.existsSync(target) && !fs.readFileSync(target).equals(data)) {
        newKey = crypto.randomBytes(10).toString("hex");
        target = path.join(audioDir, newKey + ".wav");
      }
      if (!fs.existsSync(target)) {
        fs.writeFileSync(target, data, { flag: "wx" });
        createdAudio.push(target);
      }
      mapping.set(key, newKey);
    }
    lecture.id = id;
    lecture.source = "ide";
    lecture.createdAt = lecture.updatedAt = new Date().toISOString();
    delete lecture.renders;
    restorePaths(lecture, workspaceDir, id, mapping);
    const projectDir = inside(stage, "project");
    for (const entry of entries.filter(e => !e.dir && e.name.startsWith("project/") && TEXT.test(e.name))) {
      const target = inside(stage, entry.name);
      if (fs.statSync(target).size <= 16 * 1024 ** 2) {
        let text = fs.readFileSync(target, "utf8").split(PORTABLE_PREFIX).join(`mylecture://app/lib/${id}/`);
        for (const [oldKey, newKey] of mapping) if (oldKey !== newKey) text = text.split(`mylecture://app/tts/${oldKey}.wav`).join(`mylecture://app/tts/${newKey}.wav`);
        fs.writeFileSync(target, text);
      }
    }
    fs.writeFileSync(path.join(projectDir, "lecture.json"), JSON.stringify(lecture, null, 2));
    if (fs.existsSync(workspaceDir)) throw new Error("The new project already exists.");
    // Both resolved paths are within the library; only this staged project moves.
    if (!projectDir.startsWith(path.resolve(libraryDir) + path.sep) || !workspaceDir.startsWith(path.resolve(libraryDir) + path.sep)) throw new Error("Invalid import destination.");
    fs.renameSync(projectDir, workspaceDir);
    committed = true;
    return lecture;
  } finally {
    if (!committed) for (const target of createdAudio) fs.rmSync(target, { force: true });
    if (stage.startsWith(path.resolve(libraryDir) + path.sep + ".import-")) fs.rmSync(stage, { recursive: true, force: true });
  }
}
