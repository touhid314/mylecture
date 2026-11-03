import { antigravity } from "./antigravity.js";
import { codex } from "./codex.js";
import { claudeCode } from "./claude-code.js";
import { makeApiEngine, API_PROVIDERS } from "./api.js";

export { API_PROVIDERS };

export function createEngines(getApiConfig) {
  const api = makeApiEngine(getApiConfig);
  const list = [antigravity, codex, claudeCode, api];
  const byId = Object.fromEntries(list.map((e) => [e.id, e]));
  return {
    list,
    get(id) {
      return byId[id] || antigravity;
    },
  };
}
