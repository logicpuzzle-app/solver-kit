import { solveRaw, cancelSolve } from "../solver.js";
import { boardSVG } from "../../board.js";
import { supportedKind, query, cspuzKinds, KIT_KINDS } from "../kinds.js";
export { supportedKind };

export const VERSION = "1.3.0";

export function renderAnswer(result, options) {
  if (result?.status !== "ok" || !result.raw) return null;
  return boardSVG(result.raw, options);
}

function normalize(kind, result, elapsedMs) {
  const { raw, status } = result;
  const engine = result.engine ?? (kind === "numlin" ? "numlin" : cspuzKinds.has(kind) && !KIT_KINDS.has(kind) ? "cspuz" : "kit");
  const cspuz = engine === "cspuz" || engine === "cspuz-fallback";
  const name = cspuzKinds.get(kind);
  const solutions = status !== "ok" ? null : cspuz ? result.solutions : kind === "numlin"
    ? raw.answers >= 2 ? "2+" : String(raw.answers)
    : ["0", "1", "2+", "?"].includes(raw.solutions) ? raw.solutions : null;
  const rating = solutions === "1" && kind !== "numlin" && !cspuz && Number.isFinite(raw.rating_hundredths)
    ? raw.rating_hundredths / 100 : null;
  const answerKind = status !== "ok" ? null : cspuz ? result.answerKind : kind === "numlin"
    ? raw.answer ? solutions === "1" ? "full" : "example" : null
    : solutions === "0" ? null : solutions === "1" && raw.fallback?.engine === "cspuz" ? "full"
    : solutions === "1" && !(raw.unknown > 0 || raw.unsolved > 0 || raw.status === "STOPPED") ? "full"
    : kind === "sudoku" && raw.solution?.every(Boolean) ? "example" : "common";
  return { kind, status, solutions, rating, engine, answerKind,
    displayName: name ? { ja: name.ja, en: name.en } : null,
    stars: rating === null ? null : Math.min(5, Math.max(1, Math.round(rating))),
    difficultyVersion: !cspuz && Number.isFinite(raw.difficulty_version) ? raw.difficulty_version : null,
    elapsedMs, ...(result.error ? { error: result.error } : {}),
    ...(result.errorKey ? { errorKey: result.errorKey } : {}), raw };
}

export async function solve(url, options = {}) {
  cancelSolve();
  const started = performance.now();
  const kind = supportedKind(url);
  let result;
  if (options.signal?.aborted) result = { status: "aborted", raw: {} };
  else if (typeof url !== "string" || !query(url).includes("/")) {
    result = { status: "invalid", error: "Invalid puzzle URL", errorKey: "error_url", raw: {} };
  } else if (!kind) result = { status: "unsupported", raw: {} };
  else result = await solveRaw(kind === "numlin" ? `p?${query(url)}` : url, options);
  return normalize(kind, result, performance.now() - started);
}
