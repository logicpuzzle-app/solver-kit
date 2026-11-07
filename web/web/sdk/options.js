export function resolveEngine(url, engine = "auto") {
  if (engine !== "auto") return engine;
  const m = /numlin\/(\d+)\/(\d+)\//.exec(url || "");
  if (!m) return "sat";
  // 400 マス以下は行走査 DFS が最速。それより大きい盤面は DFS と SAT を並走させる（solver-kit#15）
  return Number(m[1]) * Number(m[2]) <= 400 ? "dfs" : "portfolio";
}

export function snapThreads(target) {
  return [1, 2, 4, 8].filter(n => n <= target).at(-1) || 1;
}

export function resolveThreads(threads = "auto") {
  return threads === "auto" ? snapThreads(Math.min(globalThis.navigator?.hardwareConcurrency || 4, 8)) : Number(threads);
}

