import { solveNumlin, isNumlinUrl } from "../numlin/core.js";
import { findDetour } from "../numlin/detour.js";
import { createWorker } from "./worker.js";
import { resolveEngine, resolveThreads } from "./options.js";
import { isKitUrl, cspuzKinds, supportedKind, cspuzQuery } from "./kinds.js";

let cspuzWorker = null;
let worker = null;
let serial = 0;
let active = null;

function solveInWorker(url, signal) {
  return new Promise(resolve => {
    let current;
    const id = ++serial;
    const finish = result => {
      signal.removeEventListener("abort", stop);
      if (current) {
        current.onmessage = null;
        current.onerror = null;
        current.onmessageerror = null;
      }
      resolve(result);
    };
    const discard = () => {
      current?.terminate();
      if (worker === current) worker = null;
    };
    const stop = () => {
      discard();
      finish({ status: "aborted", raw: {} });
    };
    try {
      current = worker ??= createWorker(new URL("../worker.js", import.meta.url));
      current.onmessage = ({ data }) => {
        if (data.id !== id) return;
        if (!data.ok) {
          if (data.errorKey) discard();
          finish({ status: data.errorKey ? "error" : "invalid", error: data.error,
            errorKey: data.errorKey, raw: { error: data.error } });
          return;
        }
        try { finish({ status: "ok", raw: JSON.parse(data.json) }); }
        catch (error) { discard(); finish({ status: "error", error: String(error.message), raw: {} }); }
      };
      current.onerror = event => {
        event.preventDefault();
        discard();
        finish({ status: "error", error: event.message || "Worker failed to load", errorKey: "solver_failed", raw: {} });
      };
      current.onmessageerror = () => {
        discard();
        finish({ status: "error", error: "Worker message could not be read", raw: {} });
      };
      signal.addEventListener("abort", stop, { once: true });
      current.postMessage({ id, url });
    } catch (error) {
      discard();
      finish({ status: "error", error: String(error.message || error), errorKey: "solver_failed", raw: {} });
    }
  });
}

function solveCspuz(url, signal, kind) {
  return new Promise(resolve => {
    let current;
    const id = ++serial;
    const finish = result => {
      signal.removeEventListener("abort", stop);
      if (current) {
        current.onmessage = null;
        current.onerror = null;
        current.onmessageerror = null;
      }
      resolve(result);
    };
    const discard = () => {
      current?.terminate();
      if (cspuzWorker === current) cspuzWorker = null;
    };
    const stop = () => {
      discard();
      finish({ status: "aborted", raw: {} });
    };
    try {
      current = cspuzWorker ??= createWorker(new URL("./cspuz-worker.js", import.meta.url));
      current.onmessage = ({ data }) => {
        if (data.id !== id) return;
        if (!data.ok) {
          if (data.errorKey) discard();
          finish({ status: data.errorKey ? "error" : "invalid", error: data.error,
            errorKey: data.errorKey, raw: { error: data.error } });
          return;
        }
        try { finish(cspuzResult(data)); }
        catch (error) { discard(); finish({ status: "error", error: String(error.message), raw: {} }); }
      };
      current.onerror = event => {
        event.preventDefault();
        discard();
        finish({ status: "error", error: event.message || "Worker failed to load", errorKey: "solver_failed", raw: {} });
      };
      current.onmessageerror = () => {
        discard();
        finish({ status: "error", error: "Worker message could not be read", raw: {} });
      };
      signal.addEventListener("abort", stop, { once: true });
      current.postMessage({ id, url: `https://puzz.link/p?${cspuzQuery(url, kind)}`, enumerate: cspuzKinds.get(kind)?.enumerable ?? false, max: 2 });
    } catch (error) {
      discard();
      finish({ status: "error", error: String(error.message || error), errorKey: "solver_failed", raw: {} });
    }
  });
}

export function cspuzSolutions(board) {
  if (board.hasAnswer === false) return "0";
  if (board.isUnique === true) return "1";
  if (board.isUnique === false) return "2+";
  return "?";
}

// "failed": the kit could not read or run the puzzle. "undetermined": the uniqueness search hit its limit.
// "incomplete": unique, but the technique solver left the answer board unfinished.
export function fallbackReason(result) {
  if (result.status === "invalid" || result.status === "error") return "failed";
  if (result.status !== "ok") return null;
  const raw = result.raw;
  if (raw.solutions === "?") return "undetermined";
  if (raw.solutions !== "1") return null;
  // Sudoku fills the remaining cells by assumptions, so its board is already complete.
  if (raw.kind === "sudoku") return Array.isArray(raw.solution) && raw.solution.every(Boolean) ? null : "incomplete";
  return raw.unknown > 0 || raw.unsolved > 0 || raw.status === "STOPPED" ? "incomplete" : null;
}

export function shouldFallback(result) {
  return fallbackReason(result) !== null;
}

// The kit result keeps its verdict and rating unless cspuz is needed for the verdict itself.
export function mergeFallback(result, fallback, reason) {
  if (fallback.status !== "ok") return reason === "undetermined" ? { ...fallback, engine: "cspuz-fallback" } : result;
  if (reason === "failed") return { ...fallback, engine: "cspuz-fallback" };
  if (reason === "incomplete") {
    return fallback.solutions === "1" && fallback.answerKind === "full"
      ? { ...result, raw: { ...result.raw, fallback: fallback.raw } } : result;
  }
  return { ...fallback, engine: "cspuz-fallback",
    raw: { ...result.raw, ...fallback.raw, solutions: fallback.solutions, rating_hundredths: null } };
}

function cspuzResult(data) {
  const solve = typeof data.solve === "string" ? JSON.parse(data.solve) : data.solve;
  if (solve.status !== "ok") return { status: "invalid", error: solve.description, raw: {} };
  const solvedBoard = solve.description;
  const enumerated = typeof data.enumerate === "string" ? JSON.parse(data.enumerate) : data.enumerate;
  const example = enumerated?.status === "ok" ? enumerated.description.answers[0] : null;
  const solutions = cspuzSolutions(solvedBoard);
  const board = example ? enumerated.description.common : solvedBoard;
  return { status: "ok", engine: "cspuz", solutions,
    answerKind: solutions === "0" ? null : solutions === "1" ? "full" : example ? "example" : "common",
    raw: { engine: "cspuz", board, ...(example ? { example } : {}) } };
}

export function cancelSolve() {
  active?.abort();
}

export async function solveRaw(url, { signal, onProgress, engine = "auto", threads = "auto" } = {}) {
  active?.abort();
  const controller = new AbortController();
  active = controller;
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let result;
  try {
    if (controller.signal.aborted) result = { status: "aborted", raw: {} };
    else if (isNumlinUrl(url)) {
      const raw = await solveNumlin(url, { engine: resolveEngine(url, engine), threads: resolveThreads(threads),
        signal: controller.signal, onProgress: p => {
          // A consumer callback must not interrupt scheduler cleanup or leave a solve pending.
          if (!controller.signal.aborted) { try { onProgress?.(p); } catch {} }
        } });
      // The engines count only canonical answers; a free-cell reroute is another answer (as in cspuz-solver2).
      if (raw.status === "complete" && raw.answers === 1 && raw.answer) {
        const detour = findDetour(raw.answer);
        if (detour) Object.assign(raw, { answers: 2, canonical_answers: 1, detour });
      }
      const invalidKeys = ["error_url", "error_pairs", "error_dimensions", "error_hints", "error_engine", "error_workers"];
      result = { raw, status: raw.status === "complete" ? "ok" : raw.status === "stopped" ? "aborted"
        : invalidKeys.includes(raw.error_key) ? "invalid" : "error", error: raw.error, errorKey: raw.error_key };
    } else {
      const kind = supportedKind(url);
      if (isKitUrl(url)) {
        result = await solveInWorker(url, controller.signal);
        result.engine = "kit";
        const reason = fallbackReason(result);
        if (reason && !controller.signal.aborted) {
          result = mergeFallback(result, await solveCspuz(url, controller.signal, kind), reason);
        }
      } else result = { ...await solveCspuz(url, controller.signal, kind), engine: "cspuz" };
    }
    if (controller.signal.aborted) result = { ...result, status: "aborted" };
  } catch (error) {
    result = { status: controller.signal.aborted ? "aborted" : "error", error: String(error.message || error), raw: {} };
  } finally {
    signal?.removeEventListener("abort", abort);
    if (active === controller) active = null;
  }
  return result;
}
