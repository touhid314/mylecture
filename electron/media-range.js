// HTTP Range support for the mylecture:// protocol, so audio and video
// served from the library are seekable.
import path from "node:path";

// "bytes=START-END" | "bytes=START-" | "bytes=-SUFFIX" -> { ok, start, end, size }.
// null when there is no (single, byte) range to honour.
export function mediaRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start, end;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!size || start >= size || start > end) return { ok: false, size };
  return { ok: true, start, end, size };
}

const TYPES = {
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".oga": "audio/ogg",
  ".opus": "audio/opus", ".flac": "audio/flac", ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".mkv": "video/x-matroska", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
};
export function contentType(file) {
  return TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
}
