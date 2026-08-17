import assert from "node:assert/strict";
import { test } from "node:test";
import { validateLectureGenStartupConfig } from "../../src/lecturegen/startup-config.ts";

function validProductionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    AGENT_MODEL: "gemini-3.5-flash",
    ANIMATOR_MODEL: "gpt-5.6-luna",
    GOOGLE_API_KEY: "google-key",
    OPENAI_API_KEY: "openai-key",
    SCRIPT_TRIMMER_CHUNK_SIZE: "75",
    LECTUREGEN_SERVICE_TOKEN: "service-token",
    LECTUREGEN_WORKER_TOKEN: "worker-token",
    RENDER_CALLBACK_TOKEN: "callback-token",
    LECTUREGEN_CALLBACK_URL: "https://example.com/api/video-agent/lecturegen-callback",
    LECTUREGEN_R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
    LECTUREGEN_R2_BUCKET: "lecturegen-private",
    LECTUREGEN_R2_ACCESS_KEY_ID: "intermediate-access",
    LECTUREGEN_R2_SECRET_ACCESS_KEY: "intermediate-secret",
    WEBSITE_OUTPUT_R2_BUCKET: "website-output",
    WEBSITE_OUTPUT_R2_ACCESS_KEY_ID: "output-access",
    WEBSITE_OUTPUT_R2_SECRET_ACCESS_KEY: "output-secret",
  };
}

test("production startup accepts a complete isolated configuration", () => {
  assert.deepEqual(validateLectureGenStartupConfig(validProductionEnv()), []);
});

test("development startup permits local storage and omitted service configuration", () => {
  assert.deepEqual(validateLectureGenStartupConfig({ NODE_ENV: "development" }), []);
});

test("production startup rejects local storage and missing callbacks", () => {
  const env = validProductionEnv();
  delete env.LECTUREGEN_R2_BUCKET;
  delete env.LECTUREGEN_CALLBACK_URL;
  const errors = validateLectureGenStartupConfig(env);
  assert(errors.includes("LECTUREGEN_R2_BUCKET is required"));
  assert(errors.includes("LECTUREGEN_CALLBACK_URL or WEBSITE_CALLBACK_URL is required"));
});

test("production startup rejects shared role tokens and buckets", () => {
  const env = validProductionEnv();
  env.LECTUREGEN_WORKER_TOKEN = env.LECTUREGEN_SERVICE_TOKEN;
  env.WEBSITE_OUTPUT_R2_BUCKET = env.LECTUREGEN_R2_BUCKET;
  const errors = validateLectureGenStartupConfig(env);
  assert(errors.some((error) => error.includes("must be different")));
  assert(errors.some((error) => error.includes("BUCKET") && error.includes("different")));
});

test("production startup requires both provider keys for edit fallback", () => {
  const env = validProductionEnv();
  delete env.GOOGLE_API_KEY;
  const errors = validateLectureGenStartupConfig(env);
  assert(errors.includes("GOOGLE_API_KEY is required by the configured Gemini model(s)"));
});
