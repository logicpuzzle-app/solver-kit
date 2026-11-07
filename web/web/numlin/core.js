import { Scheduler, defaults } from "./scheduler.js";
import { DFSScheduler } from "./dfs_scheduler.js";
import { decodePuzzle } from "./answer.js";
import { createWorker } from "../sdk/worker.js";

function inputError(key) {
  return Object.assign(new Error(key), { i18nKey: key });
}

function errorKey(error) {
  if (error.i18nKey) return error.i18nKey;
  const message = String(error.message || error);
  if (/expected.*(numlin|width|height)/i.test(message)) return "error_url";
  if (/254 pairs/.test(message)) return "error_pairs";
  if (/dimensions|cell array/.test(message)) return "error_dimensions";
  if (/hint|clue|board|encoding/.test(message)) return "error_hints";
  if (/alloc|memory/i.test(message)) return "error_memory";
  if (/load|fetch|worker failed/i.test(message)) return "error_load";
}

export function isNumlinUrl(text) {
  return text.includes("p?numlin/");
}

/** onProgress receives {status, engine, done, total, percent, threads, wall_ms}; DFS adds stage and direction. */
export function solveNumlin(text, { engine = "sat", threads = defaults.threads, onProgress, signal } = {}) {
  const dfs = engine === "dfs";
  const empty = { kind: "numlin", engine, width: 0, height: 0, clues: [], answers: 0,
    answer: null, winner: null, plain_ms: null, cube_ms: null, direction: null, steps: 0,
    wall_ms: 0, cpu_ms: 0, threads: 0, cubes: 0, status: "error", error: "" };
  let puzzle, url;
  try {
    if (engine !== "sat" && engine !== "dfs") throw inputError("error_engine");
    if (!Number.isInteger(threads) || threads < 1 || threads > 64) throw inputError("error_workers");
    if (!isNumlinUrl(text)) throw inputError("error_url");
    url = text.slice(text.indexOf("p?numlin/")).trim();
    puzzle = decodePuzzle(url);
  } catch (error) {
    return Promise.resolve({ ...empty, error: String(error.message || error), error_key: errorKey(error) });
  }
  if (signal?.aborted) return Promise.resolve({ ...empty, ...puzzle, status: "stopped" });

  return new Promise(resolve => {
    let scheduler, timer, settled = false, createdWorkers = 0;
    const stop = () => scheduler.stop();
    const settle = result => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      signal?.removeEventListener("abort", stop);
      resolve({ ...empty, ...puzzle, ...result, engine,
        error_key: result.error ? errorKey(result.error) : undefined });
    };
    const fail = error => {
      if (settled) return;
      const message = String(error.message || error);
      if (scheduler) {
        // finish also releases workers allocated before a startup failure.
        if (scheduler.phase === "idle") {
          scheduler.started = scheduler.now();
          scheduler.phase = "generating";
        }
        scheduler.finish("error", message);
      } else settle({ status: "error", error: message });
    };
    try {
      scheduler = new (dfs ? DFSScheduler : Scheduler)({
        url,
        options: dfs
          ? { threads: Math.min(threads, 8), direction: "race", cut: 25, memo_bits: 24, diag_shortcut: false }
          : { threads, max: 2 },
        workerFactory: () => {
          const worker = createWorker(new URL(dfs ? "./dfs_worker.js" : "./worker.js", import.meta.url));
          createdWorkers++;
          return worker;
        },
        onChange(s) {
          if (settled) return;
          if (s.result) {
            const { answers, answer, wall_ms, cpu_ms, cubes, status, error, winner, plain_ms, cube_ms, worker_count, direction, steps } = s.result;
            settle({ answers, answer, wall_ms, cpu_ms, status, error,
              ...(dfs ? { threads: createdWorkers, direction: direction ?? null, steps: steps ?? 0 }
                : { threads: worker_count, cubes, winner, plain_ms, cube_ms }) });
          } else if (dfs) {
            onProgress?.({ status: s.phase, engine, done: s.done, total: 8,
              percent: s.progress() === null ? null : 100 * s.progress(),
              stage: s.raceStage, direction: s.continuation?.direction ?? null,
              threads: createdWorkers, wall_ms: s.elapsed() });
          } else {
            const liveTotal = s.liveTotal ? s.liveTotal() : s.totalEst;
            const percent = liveTotal > 0 ? 100 * s.workDone() / liveTotal : null;
            onProgress?.({ status: s.phase, engine, done: s.done,
              total: s.nodes.filter(n => !n.synthetic).length, percent,
              threads: s.slots.length + (s.plainSlot ? 1 : 0), wall_ms: s.elapsed() });
          }
        },
      });
      signal?.addEventListener("abort", stop, { once: true });
      if (typeof scheduler.tick === "function") timer = setInterval(() => {
        try { scheduler.tick(); } catch (error) { fail(error); }
      }, 250);
      scheduler.start();
    } catch (error) { fail(error); }
  });
}
