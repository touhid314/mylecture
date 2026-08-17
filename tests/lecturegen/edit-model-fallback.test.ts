import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EDIT_MODELS_UNAVAILABLE_MESSAGE,
  resolveEditFallbackModel,
  resolveEditModel,
  runEditWithModelFallback,
} from "../../src/lecturegen/edit-model-fallback.ts";

describe("edit model selection", () => {
  it("uses ANIMATOR_MODEL before AGENT_MODEL", () => {
    assert.equal(
      resolveEditModel({
        ANIMATOR_MODEL: "gpt-5.6-luna",
        AGENT_MODEL: "gemini-3.5-flash",
      }),
      "gpt-5.6-luna",
    );
  });

  it("defaults the fallback to the other provider", () => {
    assert.equal(
      resolveEditFallbackModel("gpt-5.6-luna", {}),
      "gemini-3.5-flash",
    );
    assert.equal(
      resolveEditFallbackModel("gemini-3.5-flash", {}),
      "gpt-5.6-luna",
    );
    assert.equal(
      resolveEditFallbackModel("gemini-3.5-flash", {
        LLM_FALLBACK_MODEL: "gemini-2.5-flash",
      }),
      "gpt-5.6-luna",
    );
  });
});

describe("runEditWithModelFallback", () => {
  it("falls back from Luna to Gemini on a transient provider error", async () => {
    const attempted: string[] = [];
    const result = await runEditWithModelFallback({
      primaryModel: "gpt-5.6-luna",
      env: {},
      run: async (model) => {
        attempted.push(model);
        if (model.startsWith("gpt-")) {
          throw Object.assign(new Error("service unavailable"), { status: 503 });
        }
        return "edited";
      },
    });

    assert.deepEqual(attempted, ["gpt-5.6-luna", "gemini-3.5-flash"]);
    assert.equal(result.value, "edited");
    assert.equal(result.model, "gemini-3.5-flash");
    assert.equal(result.usedFallback, true);
  });

  it("does not fall back for a permanent edit error", async () => {
    const attempted: string[] = [];
    await assert.rejects(
      runEditWithModelFallback({
        primaryModel: "gpt-5.6-luna",
        env: {},
        run: async (model) => {
          attempted.push(model);
          throw new Error("invalid tool output");
        },
      }),
      /invalid tool output/,
    );
    assert.deepEqual(attempted, ["gpt-5.6-luna"]);
  });

  it("returns the public-safe message when both providers are unavailable", async () => {
    await assert.rejects(
      runEditWithModelFallback({
        primaryModel: "gpt-5.6-luna",
        env: {},
        run: async () => {
          throw Object.assign(new Error("high demand"), { status: 503 });
        },
      }),
      new RegExp(EDIT_MODELS_UNAVAILABLE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });
});
