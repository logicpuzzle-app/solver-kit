/*
 * Calibrates the difficulty score against puzzle-square's author-declared ratings.
 *
 * `calibrate.mjs` does the same job against the 1,308 rated puzzles bundled with gridkit.
 * This one uses the puzzle-square corpus instead: 8,828 puzzles on a 1-5 scale, from a
 * different community and seven times the size, so agreement between the two is real
 * evidence rather than a fit to one dataset.
 *
 * Reports the score distribution per rating, the rank correlation, and the band
 * thresholds that best separate the ratings — the numbers that belong in
 * `src/difficulty.ts`.
 *
 * Usage: node --import tsx tools/calibrate-puzsq.mjs [--limit N] [--size WxH] [--out file]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeUrl } from "../src/puzzlink.ts";
import { runAll } from "../src/solver.ts";
import { difficulty } from "../src/difficulty.ts";
import { createEngine, isSolved, propagateEngine } from "../src/engine.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const limit = Number.parseInt(option("--limit", "0"), 10) || Infinity;
// The lookahead is what makes the technique solver expensive, and on this corpus a few
// puzzles send it into minutes. The fast score skips it; --full turns it back on, capped.
const useTrial = args.includes("--full");
const maxPasses = Number.parseInt(option("--max-passes", "0"), 10) || 0;
const sizeFilter = option("--size", "");
const outFile = option("--out", "");

const corpus = readFileSync(resolve(here, "../testdata/puzsq-yajilin.tsv"), "utf8")
  .split("\n")
  .filter((line) => line.length > 0)
  .map((line) => {
    const [id, rating, date, user, code] = line.split("\t");
    return { id, rating: Number.parseInt(rating, 10), date, user, code };
  });

const rows = [];
let stopped = 0;
let broken = 0;
let failed = 0;
const started = Date.now();

for (const problem of corpus) {
  if (rows.length >= limit) break;
  let board;
  try {
    board = decodeUrl(problem.code);
  } catch {
    failed++;
    continue;
  }
  if (sizeFilter && `${board.cols}x${board.rows}` !== sizeFilter) continue;

  const t0 = Date.now();
  const outcome = runAll(board, undefined, { noTrial: !useTrial, maxPasses });
  const ms = Date.now() - t0;
  if (outcome.status === "stopped") stopped++;
  if (outcome.status === "broken") broken++;

  // How much machinery the puzzle actually needs, cheapest first. This ladder turns out
  // to be the thing that tracks the human rating: the raw score counts deductions
  // applied, and a hard puzzle stops the solver early, so it accumulates fewer of them.
  const engine = createEngine(board);
  const engineSolves = propagateEngine(engine) && isSolved(engine);
  const level = engineSolves
    ? 0
    : outcome.status === "completed"
      ? 1
      : 2;

  const clues = board.cell.filter((cell) => cell.qnum !== -1).length;
  rows.push({
    id: problem.id,
    rating: problem.rating,
    dp: difficulty(outcome, board),
    status: outcome.status,
    cols: board.cols,
    rows: board.rows,
    cells: board.cols * board.rows,
    clues,
    passes: outcome.stats.passes,
    trials: outcome.stats.trialDeductions,
    trialDepth: outcome.stats.maxTrialCount,
    ms,
    level,
    date: problem.date,
  });
  if (rows.length % 250 === 0) {
    process.stderr.write(`  ${rows.length} solved (${Math.round((Date.now() - started) / 1000)}s)\n`);
  }
}

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const quantile = (values, q) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

function spearman(xs, ys) {
  const rank = (values) => {
    const order = values.map((value, index) => ({ value, index }));
    order.sort((a, b) => a.value - b.value);
    const ranks = new Array(values.length);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
      const average = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[order[k].index] = average;
      i = j + 1;
    }
    return ranks;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
}

console.log(`scoring mode        ${useTrial ? "full (with lookahead)" : "fast (no lookahead)"}`);
console.log(`analysed            ${rows.length}${sizeFilter ? ` (${sizeFilter} only)` : ""}`);
console.log(`decode failures     ${failed}`);
console.log(`technique solver    stopped ${stopped}, broken ${broken}`);
console.log(`elapsed             ${Math.round((Date.now() - started) / 1000)}s`);

console.log("\nrating    n    dp p25    median      p75      p90   solved%   cells(med)");
for (const rating of [1, 2, 3, 4, 5]) {
  const group = rows.filter((row) => row.rating === rating);
  if (group.length === 0) continue;
  const dps = group.map((row) => row.dp);
  const solved = group.filter((row) => row.status === "completed").length;
  console.log(
    `${String(rating).padStart(6)} ${String(group.length).padStart(4)} ` +
      `${String(quantile(dps, 0.25)).padStart(7)} ${String(median(dps)).padStart(9)} ` +
      `${String(quantile(dps, 0.75)).padStart(8)} ${String(quantile(dps, 0.9)).padStart(8)} ` +
      `${String(Math.round((100 * solved) / group.length)).padStart(8)}% ` +
      `${String(median(group.map((r) => r.cells))).padStart(11)}`
  );
}

const ratings = rows.map((row) => row.rating);
console.log("\ncorrelation with the declared rating (Spearman)");
for (const [label, pick] of [
  ["dp", (r) => r.dp],
  ["  trial deductions", (r) => r.trials],
  ["  trial depth", (r) => r.trialDepth],
  ["  solver passes", (r) => r.passes],
  ["  solve time (ms)", (r) => r.ms],
  ["board cells", (r) => r.cells],
  ["clue count", (r) => r.clues],
  ["reasoning level", (r) => r.level],
  // The two carry different information: the level says which machinery a puzzle needs,
  // the score says how hard it worked once it got there. Ordering by level first and
  // score second is the natural way to put them together.
  ["level then dp", (r) => r.level * 1_000_000 + Math.min(r.dp, 999_999)],
]) {
  console.log(`  ${label.padEnd(20)} ${spearman(ratings, rows.map(pick)).toFixed(3)}`);
}

const hardest = rows.filter((row) => row.level === 2);
if (hardest.length > 50) {
  console.log(
    `\n  dp within level 2 only  ${spearman(hardest.map((r) => r.rating), hardest.map((r) => r.dp)).toFixed(3)} (n=${hardest.length})`
  );
}

console.log("\nreasoning level required (0 = propagation alone, 1 = techniques, 2 = more)");
console.log("rating     n   level0   level1   level2");
for (const rating of [1, 2, 3, 4, 5]) {
  const group = rows.filter((row) => row.rating === rating);
  if (group.length === 0) continue;
  const share = (lv) =>
    `${String(Math.round((100 * group.filter((r) => r.level === lv).length) / group.length)).padStart(6)}%`;
  console.log(
    `${String(rating).padStart(6)} ${String(group.length).padStart(5)} ${share(0)} ${share(1)} ${share(2)}`
  );
}

// Board size is itself a difficulty signal, so check the score still tracks the rating
// once size is held fixed.
for (const size of ["10x10", "11x11", "17x17"]) {
  const group = rows.filter((row) => `${row.cols}x${row.rows}` === size);
  if (group.length < 50) continue;
  const rho = spearman(group.map((r) => r.rating), group.map((r) => r.dp));
  console.log(`  dp within ${size.padEnd(9)} ${rho.toFixed(3)} (n=${group.length})`);
}

/**
 * Thresholds that put each rating boundary where the two neighbouring rating groups
 * overlap least — the score at which a puzzle is as likely to be rated r as r+1.
 */
console.log("\nsuggested band thresholds (boundary between rating r and r+1)");
for (const rating of [1, 2, 3, 4]) {
  const lower = rows.filter((row) => row.rating <= rating).map((row) => row.dp);
  const upper = rows.filter((row) => row.rating > rating).map((row) => row.dp);
  if (lower.length === 0 || upper.length === 0) continue;
  const candidates = [...new Set([...lower, ...upper])].sort((a, b) => a - b);
  let best = candidates[0];
  let bestScore = -1;
  for (const cut of candidates) {
    const correct =
      lower.filter((dp) => dp < cut).length + upper.filter((dp) => dp >= cut).length;
    if (correct > bestScore) {
      bestScore = correct;
      best = cut;
    }
  }
  const accuracy = Math.round((100 * bestScore) / (lower.length + upper.length));
  console.log(`  ${rating} | ${rating + 1}   dp < ${String(best).padStart(6)}   separates ${accuracy}%`);
}

if (outFile) {
  const header = "id\trating\tdp\tstatus\tcols\trows\tclues\tpasses\ttrials\ttrialDepth\tms\tdate\n";
  const body = rows
    .map((r) =>
      [r.id, r.rating, r.dp, r.status, r.cols, r.rows, r.clues, r.passes, r.trials, r.trialDepth, r.ms, r.date].join("\t")
    )
    .join("\n");
  writeFileSync(outFile, header + body + "\n");
  console.log(`\nper-puzzle results -> ${outFile}`);
}
