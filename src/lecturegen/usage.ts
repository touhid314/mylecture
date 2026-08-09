import { getTokenTrackerSummary } from "../../packages/lecture-agent/src/token-tracker/token_tracker.ts";
import type { LectureGenUsage } from "./types.ts";

export function buildJobUsageFromSessions(opts: {
  model: string;
  sessionIds: string[];
  repairTokens?: { input: number; output: number } | null;
}): LectureGenUsage | null {
  let inputTokens = opts.repairTokens?.input ?? 0;
  let cachedInputTokens = 0;
  let outputTokens = opts.repairTokens?.output ?? 0;
  let estimatedCostUsd: number | null = null;

  const summary = getTokenTrackerSummary();
  for (const sessionId of opts.sessionIds) {
    const row = summary.bySession?.find(
      (entry) => entry.sessionId === sessionId,
    ) as
      | {
          inputTokens?: number;
          cachedInputTokens?: number;
          outputTokens?: number;
          costUsd?: number;
        }
      | undefined;
    if (!row) continue;
    inputTokens += row.inputTokens ?? 0;
    cachedInputTokens += row.cachedInputTokens ?? 0;
    outputTokens += row.outputTokens ?? 0;
    if (typeof row.costUsd === "number" && Number.isFinite(row.costUsd)) {
      estimatedCostUsd = (estimatedCostUsd ?? 0) + row.costUsd;
    }
  }

  if (inputTokens === 0 && outputTokens === 0) {
    return null;
  }

  return {
    model: opts.model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd,
  };
}
