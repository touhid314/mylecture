// Runtime downloads belong outside the serializable lesson script.
const pending = new WeakMap();
export function pictureRequest(action) {
  if (!pending.has(action)) pending.set(action, Promise.resolve().then(() =>
    action.data?.source || window.ml.study.image(action.data?.query || action.data?.caption || "")
  ).catch(() => null));
  return pending.get(action);
}

export function sessionSnapshot(session) {
  return {
    ...session,
    board: (session.board || []).map((action) => Object.fromEntries(
      ["type", "id", "data", "text", "raw", "items", "index", "value", "seconds"].filter((key) => action[key] !== undefined).map((key) => [key, action[key]])
    )),
  };
}
