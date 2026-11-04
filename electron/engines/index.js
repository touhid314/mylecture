import { antigravity } from "./antigravity.js";
import { codex } from "./codex.js";
import { claudeCode } from "./claude-code.js";
import { makeApiEngine, API_PROVIDERS, OFFERED_API_PROVIDERS, verifyApiProvider } from "./api.js";

export { API_PROVIDERS, OFFERED_API_PROVIDERS, verifyApiProvider };

export function createEngines(getApiConfig) {
  const api = makeApiEngine(getApiConfig);
  const list = [antigravity, codex, claudeCode, api];
  const byId = Object.fromEntries(list.map((e) => [e.id, e]));
  return {
    list,
    get(id) {
      if (!byId[id]) throw new Error("Connect an AI account in Settings first.");
      return byId[id];
    },
  };
}
