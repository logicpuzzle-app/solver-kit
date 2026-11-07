import createSolver from "../numlin/cspuz_solver_backend.js";
import { callCspuz } from "./cspuz-api.js";

const ready = createSolver({ locateFile: path => new URL(`../numlin/${path}`, import.meta.url).href })
  .then(module => ({ module }), error => ({ error }));

self.onmessage = async ({ data: { id, url, enumerate, max = 2 } }) => {
  const { module, error } = await ready;
  if (error) {
    self.postMessage({ id, ok: false, error: String(error.message || error), errorKey: "solver_failed" });
    return;
  }
  try {
    const solve = callCspuz(module, "_solve_problem", url);
    const extra = solve.status === "ok" && solve.description.isUnique === false && enumerate
      ? { enumerate: callCspuz(module, "_enumerate_answers_problem", url, Math.min(2, max)) } : {};
    self.postMessage({ id, ok: true, solve, ...extra });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error.message || error), errorKey: "solver_failed" });
  }
};
