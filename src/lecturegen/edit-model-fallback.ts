import { isLlmTransientProviderError } from "../../packages/lecture-agent/src/utils/llm_rate_limit.ts";

export const EDIT_MODELS_UNAVAILABLE_MESSAGE =
  "The video editing models are temporarily unavailable. Please try again in a few minutes.";

function modelProvider(model: string): "gemini" | "openai" | "other" {
  const normalized = model.trim().toLowerCase();
  if (normalized.includes("gemini")) return "gemini";
  if (normalized.startsWith("gpt-")) return "openai";
  return "other";
}

export function resolveEditModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.ANIMATOR_MODEL?.trim() || env.AGENT_MODEL?.trim() || "gemini-3.5-flash";
}

export function resolveEditFallbackModel(
  primaryModel: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const primaryProvider = modelProvider(primaryModel);
  if (primaryProvider === "other") return null;

  const configured =
    env.EDIT_FALLBACK_MODEL?.trim() || env.LLM_FALLBACK_MODEL?.trim();
  if (configured && modelProvider(configured) !== primaryProvider) {
    return configured;
  }

  return primaryProvider === "openai" ? "gemini-3.5-flash" : "gpt-5.6-luna";
}

export async function runEditWithModelFallback<T>(options: {
  primaryModel: string;
  run: (model: string) => Promise<T>;
  onFallback?: (primaryModel: string, fallbackModel: string, error: unknown) => void;
  env?: NodeJS.ProcessEnv;
}): Promise<{ value: T; model: string; usedFallback: boolean }> {
  try {
    return {
      value: await options.run(options.primaryModel),
      model: options.primaryModel,
      usedFallback: false,
    };
  } catch (primaryError) {
    if (!isLlmTransientProviderError(primaryError)) throw primaryError;

    const fallbackModel = resolveEditFallbackModel(
      options.primaryModel,
      options.env,
    );
    if (!fallbackModel) throw primaryError;

    options.onFallback?.(options.primaryModel, fallbackModel, primaryError);

    try {
      return {
        value: await options.run(fallbackModel),
        model: fallbackModel,
        usedFallback: true,
      };
    } catch (fallbackError) {
      if (!isLlmTransientProviderError(fallbackError)) throw fallbackError;
      throw new Error(EDIT_MODELS_UNAVAILABLE_MESSAGE, {
        cause: new AggregateError(
          [primaryError, fallbackError],
          "Both video edit model providers returned transient errors",
        ),
      });
    }
  }
}
