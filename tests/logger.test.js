import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureLogger, getLogInfo, log, readLogTail, registerLogSecret, sanitizeLogValue, onLogEntry } from "../electron/logger.js";

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mylecture-log-test-"));
  t.after(() => { configureLogger(); fs.rmSync(dir, { recursive: true, force: true }); });
  return dir;
}

test("logging is inert until configured, then writes complete live JSON lines", t => {
  configureLogger();
  log("info", "should.not.write");
  assert.deepEqual(getLogInfo(), { directory: null, file: null });
  assert.equal(readLogTail().text, "");
  const dir = directory(t);
  configureLogger({ directory: dir });
  log("info", "generation.started", { jobId: "job-1", provider: "claude-code", model: "test-model" });
  const first = JSON.parse(fs.readFileSync(getLogInfo().file, "utf8"));
  assert.equal(first.event, "generation.started");
  assert.equal(first.details.jobId, "job-1");
  assert.match(first.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(first.runId, /^[a-f\d-]{36}$/);
  log("error", "generation.failed", { code: "EPIPE" });
  assert.equal(readLogTail().text.trim().split("\n").length, 2);
});

test("private fields and secrets in error strings are redacted before writing", t => {
  const dir = directory(t);
  configureLogger({ directory: dir });
  registerLogSecret("custom-live-credential-12345");
  const error = Object.assign(new Error("Failed for person@example.com Bearer bearer-secret-value api_key=very-secret sk-examplecredential123 AIzaGoogleSecretValue123 at https://name:pwd@example.com/check?token=private#password custom-live-credential-12345"), { code: "EAUTH" });
  log("error", "auth.failed", { error, token: "field-secret", api_key: "private-key", nested: { authorization: "Basic secret", email: "person@example.com", prompt: "private prompt", user: "private user", content: "private content" } });
  const text = fs.readFileSync(getLogInfo().file, "utf8");
  for (const secret of ["person@example.com", "bearer-secret-value", "very-secret", "sk-examplecredential123", "AIzaGoogleSecretValue123", "name:pwd", "?token=private", "#password", "custom-live-credential-12345", "field-secret", "private-key", "Basic secret", "private prompt", "private user", "private content"]) assert(!text.includes(secret), secret);
  const parsed = JSON.parse(text);
  assert.equal(parsed.details.error.code, "EAUTH");
  assert.match(parsed.details.error.message, /https:\/\/example.com\/check/);
  assert.match(parsed.details.error.stack, /Error:/);
  assert.match(text, /REDACTED/);
  const serializedError = sanitizeLogValue('Provider replied {"apiKey":"serialized-private-key","access_token":"serialized-access-token"}');
  assert(!serializedError.includes("serialized-private-key"));
  assert(!serializedError.includes("serialized-access-token"));
});

test("cyclic, binary and oversized details stay bounded without losing JSON validity", t => {
  const dir = directory(t);
  configureLogger({ directory: dir });
  const circular = { nested: {}, data: new Uint8Array(30) }; circular.nested.back = circular;
  assert.equal(sanitizeLogValue(circular).nested.back, "[Circular]");
  const huge = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`key${i}`, "😃".repeat(10000)]));
  log("info", "bounded", huge);
  log("warn", "cycle", circular);
  for (const line of fs.readFileSync(getLogInfo().file, "utf8").trim().split("\n")) {
    assert(Buffer.byteLength(line + "\n") <= 8192);
    JSON.parse(line);
  }
});

test("rotation caps files and bytes while the current log remains readable", t => {
  const dir = directory(t);
  configureLogger({ directory: dir, maxBytes: 1024, maxFiles: 3 });
  for (let i = 0; i < 50; i++) log("info", "operation", { sequence: i, description: "x".repeat(250) });
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 3);
  for (const name of files) assert(fs.statSync(path.join(dir, name)).size <= 1024);
  const tail = readLogTail();
  assert.equal(JSON.parse(tail.text.trim().split("\n").at(-1)).details.sequence, 49);
  configureLogger({ directory: dir, maxBytes: 1024, maxFiles: 1 });
  assert.equal(fs.readdirSync(dir).length, 1);
});

test("tail reads are bounded and omit incomplete first lines", t => {
  const dir = directory(t);
  configureLogger({ directory: dir });
  for (let i = 0; i < 10; i++) log("info", "tail", { sequence: i, description: "z".repeat(150) });
  const tail = readLogTail({ maxBytes: 900 });
  assert.equal(tail.truncated, true);
  assert(Buffer.byteLength(tail.text) <= 900);
  const lines = tail.text.trim().split("\n").map(line => JSON.parse(line));
  assert.equal(lines.at(-1).details.sequence, 9);
  assert.equal(readLogTail({ maxBytes: 1 }).text, "");
});

test("unavailable log directories never break app operations", t => {
  const dir = directory(t);
  const file = path.join(dir, "existing-file");
  fs.writeFileSync(file, "occupied");
  assert.doesNotThrow(() => configureLogger({ directory: file }));
  assert.equal(getLogInfo().file, null);
  assert.doesNotThrow(() => log("error", "disk.failed", new Error("unavailable")));
  assert.equal(readLogTail().text, "");
});

test("local streaming receives only successfully persisted sanitized lines and can unsubscribe", t => {
  const dir = directory(t);
  configureLogger({ directory: dir, maxBytes: 512 });
  const entries = [];
  const stop = onLogEntry(entry => entries.push(entry));
  t.after(stop);
  log("warn", "\u0000".repeat(1000), { token: "never-broadcast" });
  assert.equal(entries.length, 1);
  assert(!entries[0].line.includes("never-broadcast"));
  assert.equal(entries[0].line, fs.readFileSync(getLogInfo().file, "utf8"));
  assert(Buffer.byteLength(entries[0].line) <= 512);
  stop();
  log("info", "after.unsubscribe");
  assert.equal(entries.length, 1);
});
