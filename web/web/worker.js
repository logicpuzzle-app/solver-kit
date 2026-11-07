// wasm ソルバーを実行する Web Worker。
// 重い盤面(仮置き・解数カウントの探索)でメインスレッドを塞がないための分離。
import init, { solve_url } from "./pkg/solver_wasm.js";

const ready = init().then(() => null, error => error);

self.onmessage = async (event) => {
  const { id, url } = event.data;
  const loadError = await ready;
  if (loadError) {
    self.postMessage({ id, ok: false, error: String(loadError?.message ?? loadError), errorKey: "solver_failed" });
    return;
  }
  try {
    const json = solve_url(url);
    self.postMessage({ id, ok: true, json });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
