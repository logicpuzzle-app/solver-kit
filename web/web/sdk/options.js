export function resolveEngine(url, engine = "auto") {
  if (engine !== "auto") return engine;
  const m = /numlin\/(\d+)\/(\d+)\//.exec(url || "");
  return m && Number(m[1]) * Number(m[2]) <= 400 ? "dfs" : "sat";
}

export function snapThreads(target) {
  return [1, 2, 4, 8].filter(n => n <= target).at(-1) || 1;
}

export function resolveThreads(threads = "auto") {
  return threads === "auto" ? snapThreads(Math.min(globalThis.navigator?.hardwareConcurrency || 4, 8)) : Number(threads);
}

