import { resolveEditFallbackModel } from "./edit-model-fallback.ts";

type Environment = NodeJS.ProcessEnv;

function value(env: Environment, name: string): string {
  return env[name]?.trim() || "";
}

function storageEndpoint(env: Environment): string {
  const explicit = value(env, "LECTUREGEN_R2_ENDPOINT") || value(env, "R2_ENDPOINT");
  if (explicit) return explicit;
  const accountId = value(env, "LECTUREGEN_R2_ACCOUNT_ID") || value(env, "R2_ACCOUNT_ID");
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "";
}

function callbackUrl(env: Environment): string {
  return value(env, "LECTUREGEN_CALLBACK_URL") || value(env, "WEBSITE_CALLBACK_URL");
}

function isPositiveInteger(raw: string): boolean {
  if (!raw) return false;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0;
}

function configuredModels(env: Environment): string[] {
  const defaultModel = value(env, "AGENT_MODEL") || "gemini-3.5-flash";
  const animatorModel = value(env, "ANIMATOR_MODEL") || defaultModel;
  const editFallbackModel = resolveEditFallbackModel(animatorModel, env);
  return [
    defaultModel,
    value(env, "SCRIPT_MODEL") || defaultModel,
    animatorModel,
    editFallbackModel,
  ].filter((model): model is string => Boolean(model));
}

export function requiresStrictLectureGenStartupValidation(
  env: Environment = process.env,
): boolean {
  return env.NODE_ENV === "production" || value(env, "LECTUREGEN_VALIDATE_STARTUP") === "1";
}

/**
 * Validate production configuration before the HTTP port is opened. This is
 * intentionally configuration-only; loading persisted manifests immediately
 * afterward also proves that intermediate R2 is reachable.
 */
export function validateLectureGenStartupConfig(
  env: Environment = process.env,
): string[] {
  if (!requiresStrictLectureGenStartupValidation(env)) return [];

  const errors: string[] = [];
  const required = [
    "LECTUREGEN_SERVICE_TOKEN",
    "LECTUREGEN_WORKER_TOKEN",
    "RENDER_CALLBACK_TOKEN",
    "LECTUREGEN_R2_BUCKET",
    "WEBSITE_OUTPUT_R2_BUCKET",
  ];
  for (const name of required) {
    if (!value(env, name)) errors.push(`${name} is required`);
  }

  if (!callbackUrl(env)) {
    errors.push("LECTUREGEN_CALLBACK_URL or WEBSITE_CALLBACK_URL is required");
  }
  if (!storageEndpoint(env)) {
    errors.push("LECTUREGEN_R2_ENDPOINT/R2_ENDPOINT or an R2 account id is required");
  }

  const sharedAccessKey = value(env, "R2_ACCESS_KEY_ID");
  const sharedSecretKey = value(env, "R2_SECRET_ACCESS_KEY");
  if (!value(env, "LECTUREGEN_R2_ACCESS_KEY_ID") && !sharedAccessKey) {
    errors.push("LECTUREGEN_R2_ACCESS_KEY_ID or R2_ACCESS_KEY_ID is required");
  }
  if (!value(env, "LECTUREGEN_R2_SECRET_ACCESS_KEY") && !sharedSecretKey) {
    errors.push("LECTUREGEN_R2_SECRET_ACCESS_KEY or R2_SECRET_ACCESS_KEY is required");
  }
  if (!value(env, "WEBSITE_OUTPUT_R2_ACCESS_KEY_ID") && !sharedAccessKey) {
    errors.push("WEBSITE_OUTPUT_R2_ACCESS_KEY_ID or R2_ACCESS_KEY_ID is required");
  }
  if (!value(env, "WEBSITE_OUTPUT_R2_SECRET_ACCESS_KEY") && !sharedSecretKey) {
    errors.push("WEBSITE_OUTPUT_R2_SECRET_ACCESS_KEY or R2_SECRET_ACCESS_KEY is required");
  }

  const serviceToken = value(env, "LECTUREGEN_SERVICE_TOKEN");
  const workerToken = value(env, "LECTUREGEN_WORKER_TOKEN");
  const ideToken = value(env, "LECTUREGEN_IDE_TOKEN");
  if (serviceToken && workerToken && serviceToken === workerToken) {
    errors.push("LECTUREGEN_SERVICE_TOKEN and LECTUREGEN_WORKER_TOKEN must be different");
  }
  if (ideToken && (ideToken === serviceToken || ideToken === workerToken)) {
    errors.push("LECTUREGEN_IDE_TOKEN must be different from service and worker tokens");
  }

  const intermediateBucket = value(env, "LECTUREGEN_R2_BUCKET");
  const outputBucket = value(env, "WEBSITE_OUTPUT_R2_BUCKET");
  if (intermediateBucket && outputBucket && intermediateBucket === outputBucket) {
    errors.push("LECTUREGEN_R2_BUCKET and WEBSITE_OUTPUT_R2_BUCKET must be different");
  }

  if (!isPositiveInteger(value(env, "SCRIPT_TRIMMER_CHUNK_SIZE"))) {
    errors.push("SCRIPT_TRIMMER_CHUNK_SIZE must be a positive integer");
  }

  const models = configuredModels(env);
  const navigatorMode = value(env, "LLM_PROVIDER").toLowerCase() === "navigator"
    || ((!value(env, "LLM_PROVIDER") || value(env, "LLM_PROVIDER").toLowerCase() === "auto")
      && Boolean(value(env, "NAVIGATOR_API_KEY") || value(env, "LITELLM_API_KEY")));
  if (navigatorMode) {
    if (!(value(env, "NAVIGATOR_API_KEY") || value(env, "LITELLM_API_KEY") || value(env, "MYLECTURE_AGENT_API_TOKEN"))) errors.push("NAVIGATOR_API_KEY is required for Navigator model access");
    if (!(value(env, "NAVIGATOR_API_ENDPOINT") || value(env, "LITELLM_API_BASE"))) errors.push("NAVIGATOR_API_ENDPOINT is required for Navigator model access");
  }
  if (!navigatorMode && models.some((model) => /^gpt-/i.test(model)) && !value(env, "OPENAI_API_KEY")) {
    errors.push("OPENAI_API_KEY is required by the configured GPT model(s)");
  }
  if (!navigatorMode && models.some((model) => !/^gpt-/i.test(model)) && !(value(env, "GOOGLE_API_KEY") || value(env, "GEMINI_API_KEY"))) {
    errors.push("GOOGLE_API_KEY is required by the configured Gemini model(s)");
  }

  return errors;
}
