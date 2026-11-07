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

// 400 マスを超える盤面の自動選択: 行走査 DFS と SAT を並走させ、先に結論を出した方を採る。
// DFS は方向レースの後 1 ワーカーで探索を続けるので、SAT 側には残りのワーカーで cube と plain を回す。
export const PORTFOLIO_SAT = { layout: "C", reserve_for_dfs: 1 };

function dfsOptions(threads) {
  return { threads: Math.min(threads, 8), direction: "race", cut: 25, memo_bits: 24, diag_shortcut: false };
}

function satOptions(threads, portfolio) {
  if (!portfolio) return { threads, max: 2 };
  if (PORTFOLIO_SAT.layout === "B") return { threads: 1, max: 2, portfolio: "B" };   // plain だけ
  return { threads: Math.max(1, threads - PORTFOLIO_SAT.reserve_for_dfs), max: 2, portfolio: PORTFOLIO_SAT.layout };
}

/** onProgress receives {status, engine, done, total, percent, threads, wall_ms}; DFS adds stage and direction.
 * engine "portfolio" runs both and reports progress as "sat" with the DFS stage attached. */
export function solveNumlin(text, { engine = "sat", threads = defaults.threads, onProgress, signal } = {}) {
  const empty = { kind: "numlin", engine, width: 0, height: 0, clues: [], answers: 0,
    answer: null, winner: null, plain_ms: null, cube_ms: null, direction: null, steps: 0,
    wall_ms: 0, cpu_ms: 0, threads: 0, cubes: 0, status: "error", error: "" };
  let puzzle, url;
  try {
    if (engine !== "sat" && engine !== "dfs" && engine !== "portfolio") throw inputError("error_engine");
    if (!Number.isInteger(threads) || threads < 1 || threads > 64) throw inputError("error_workers");
    if (!isNumlinUrl(text)) throw inputError("error_url");
    url = text.slice(text.indexOf("p?numlin/")).trim();
    puzzle = decodePuzzle(url);
  } catch (error) {
    return Promise.resolve({ ...empty, error: String(error.message || error), error_key: errorKey(error) });
  }
  if (signal?.aborted) return Promise.resolve({ ...empty, ...puzzle, status: "stopped" });
  const kinds = engine === "portfolio" ? ["dfs", "sat"] : [engine];

  return new Promise(resolve => {
    const runs = [];
    let timer, settled = false;
    const stop = () => { for (const r of runs) r.scheduler?.stop(); };
    const settle = result => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      signal?.removeEventListener("abort", stop);
      for (const r of runs) if (r.scheduler && !r.scheduler.result) r.scheduler.stop();
      resolve({ ...empty, ...puzzle, ...result, engine: result.engine ?? engine,
        error_key: result.error ? errorKey(result.error) : undefined });
    };
    const fail = (run, error) => {
      if (settled) return;
      const message = String(error.message || error);
      const scheduler = run?.scheduler;
      if (scheduler) {
        // finish also releases workers allocated before a startup failure.
        if (scheduler.phase === "idle") {
          scheduler.started = scheduler.now();
          scheduler.phase = "generating";
        }
        scheduler.finish("error", message);
      } else settle({ status: "error", error: message });
    };
    const resultOf = (run, r) => {
      const { answers, answer, wall_ms, cpu_ms, cubes, status, error, winner, plain_ms, cube_ms, worker_count, direction, steps } = r;
      return { answers, answer, wall_ms, cpu_ms, status, error,
        ...(run.kind === "dfs" ? { threads: run.created, direction: direction ?? null, steps: steps ?? 0 }
          : { threads: worker_count, cubes, winner, plain_ms, cube_ms }) };
    };
    // 並走時: 先に complete した方を採る。片方の error / stopped はもう片方を待つ。
    const finished = run => {
      const r = run.scheduler.result;
      if (kinds.length === 1) { settle(resultOf(run, r)); return; }
      // threads: 同時に動くワーカー数の上限（DFS の方向レース + SAT の cube と plain）
      if (r.status === "complete") {
        settle({ ...resultOf(run, r), engine: run.kind, portfolio: true, threads: portfolioWorkers() });
        return;
      }
      if (runs.every(x => x.scheduler?.result)) {
        const failed = runs.find(x => x.scheduler.result.status === "error");
        settle(failed ? { ...resultOf(failed, failed.scheduler.result), engine: failed.kind, portfolio: true }
          : { ...resultOf(run, r), engine: "portfolio", portfolio: true, threads: portfolioWorkers() });
      }
    };
    const progress = () => {
      if (settled || !onProgress) return;
      const dfs = runs.find(r => r.kind === "dfs")?.scheduler, sat = runs.find(r => r.kind === "sat")?.scheduler;
      if (sat && !sat.result) {
        const liveTotal = sat.liveTotal ? sat.liveTotal() : sat.totalEst;
        const percent = liveTotal > 0 ? 100 * sat.workDone() / liveTotal : null;
        onProgress({ status: sat.phase, engine: "sat", done: sat.done,
          total: sat.nodes.filter(n => !n.synthetic).length, percent,
          threads: kinds.length > 1 ? portfolioWorkers() : sat.slots.length + (sat.plainSlot ? 1 : 0), wall_ms: sat.elapsed(),
          ...(dfs && !dfs.result ? { portfolio: true, dfs_stage: dfs.raceStage, dfs_percent: dfs.progress() === null ? null : 100 * dfs.progress() } : {}) });
      } else if (dfs && !dfs.result) {
        onProgress({ status: dfs.phase, engine: "dfs", done: dfs.done, total: 8,
          percent: dfs.progress() === null ? null : 100 * dfs.progress(),
          stage: dfs.raceStage, direction: dfs.continuation?.direction ?? null,
          threads: kinds.length > 1 ? portfolioWorkers() : run0Created(), wall_ms: dfs.elapsed() });
      }
    };
    const run0Created = () => runs[0]?.created ?? 0;
    const portfolioWorkers = () => {
      const sat = satOptions(threads, true);
      return dfsOptions(threads).threads + sat.threads + (sat.portfolio === "B" ? 0 : 1);
    };
    try {
      for (const kind of kinds) {
        const run = { kind, created: 0, scheduler: null };
        runs.push(run);
        run.scheduler = new (kind === "dfs" ? DFSScheduler : Scheduler)({
          url,
          options: kind === "dfs" ? dfsOptions(threads) : satOptions(threads, kinds.length > 1),
          workerFactory: () => {
            const worker = createWorker(new URL(kind === "dfs" ? "./dfs_worker.js" : "./worker.js", import.meta.url));
            run.created++;
            return worker;
          },
          onChange(s) {
            if (settled) return;
            if (s.result) finished(run);
            else progress();
          },
        });
      }
      signal?.addEventListener("abort", stop, { once: true });
      timer = setInterval(() => {
        for (const r of runs) {
          if (settled) break;
          if (typeof r.scheduler.tick === "function" && !r.scheduler.result) {
            try { r.scheduler.tick(); } catch (error) { fail(r, error); }
          }
        }
      }, 250);
      for (const r of runs) { if (settled) break; r.scheduler.start(); }
    } catch (error) { fail(runs.at(-1), error); }
  });
}
