/*
 * Compares the DP score against the human difficulty ratings that ship with the gridkit
 * corpus, so the bands in src/difficulty.ts are grounded in something.
 *
 * Usage: node --import tsx tools/calibrate.mjs [limit]
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeUrl } from "../src/puzzlink.ts";
import { runAll } from "../src/solver.ts";
import { difficulty } from "../src/difficulty.ts";

const here = dirname(fileURLToPath(import.meta.url));
const corpus = readFileSync(resolve(here, "../testdata/corpus.tsv"), "utf8")
  .split("\n")
  .filter((line) => line.length > 0)
  .map((line) => {
    const [index, rating, code] = line.split("\t");
    return { index, rating: Number.parseInt(rating, 10), code };
  });

const limit = Number.parseInt(process.argv[2] ?? String(corpus.length), 10);
const buckets = new Map();
const pairs = [];

for (const problem of corpus.slice(0, limit)) {
  if (!Number.isFinite(problem.rating)) continue;
  const board = decodeUrl(problem.code);
  const outcome = runAll(board);
  const dp = difficulty(outcome);
  pairs.push({ rating: problem.rating, dp, status: outcome.status });
  if (!buckets.has(problem.rating)) buckets.set(problem.rating, []);
  buckets.get(problem.rating).push(dp);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

console.log("rating  n     dp p25      median    p75");
for (const rating of [...buckets.keys()].sort((a, b) => a - b)) {
  const values = [...buckets.get(rating)].sort((a, b) => a - b);
  const p = (q) => values[Math.min(values.length - 1, Math.floor(values.length * q))];
  console.log(
    `${String(rating).padStart(5)} ${String(values.length).padStart(5)} ${String(p(0.25)).padStart(9)} ${String(median(values)).padStart(9)} ${String(p(0.75)).padStart(9)}`
  );
}

// Spearman rank correlation between the human rating and the DP score.
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

const ratingRanks = rank(pairs.map((p) => p.rating));
const dpRanks = rank(pairs.map((p) => p.dp));
const n = pairs.length;
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
const mr = mean(ratingRanks);
const md = mean(dpRanks);
let num = 0;
let d1 = 0;
let d2 = 0;
for (let i = 0; i < n; i++) {
  num += (ratingRanks[i] - mr) * (dpRanks[i] - md);
  d1 += (ratingRanks[i] - mr) ** 2;
  d2 += (dpRanks[i] - md) ** 2;
}
console.log(`\nn=${n} spearman=${(num / Math.sqrt(d1 * d2)).toFixed(3)}`);

const all = pairs.map((p) => p.dp).sort((a, b) => a - b);
const q = (f) => all[Math.min(all.length - 1, Math.floor(all.length * f))];
console.log(
  `dp quantiles 10%=${q(0.1)} 25%=${q(0.25)} 50%=${q(0.5)} 75%=${q(0.75)} 90%=${q(0.9)} 99%=${q(0.99)}`
);
