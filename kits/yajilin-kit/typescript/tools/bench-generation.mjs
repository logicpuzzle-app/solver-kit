/*
 * Fixed benchmark for generation experiments.
 *
 * Every candidate improvement is judged against this and nothing else: same seeds, same
 * sizes, same budgets, so two runs are comparable and a change either earns its place or
 * gets reverted. Reports success rate, wall time and the difficulty spread, plus the
 * propagation coverage a puzzle reaches, which is what the annealing actually optimises.
 *
 * Usage: node --import tsx tools/bench-generation.mjs [label] [sizes] [samples]
 *   e.g. node --import tsx tools/bench-generation.mjs baseline 10,12 8
 */

import { Rng } from "../src/random.ts";
import { generateLoop, generatePattern } from "../src/generator.ts";
import { countSolutions, propagationCoverage, maximumCoverage } from "../src/search.ts";
import { validateSolution } from "../src/solution.ts";

const label = process.argv[2] ?? "run";
const sizes = (process.argv[3] ?? "10,12").split(",").map((value) => Number.parseInt(value, 10));
const samples = Number.parseInt(process.argv[4] ?? "8", 10);
// Optional 4th argument restricts the modes, so an A/B can focus on the one that moved.
const modes = (process.argv[5] ?? "loop,pattern").split(",");
// Seed offset, so an independent replication can be run on a fresh set of seeds.
const seedBase = Number.parseInt(process.argv[6] ?? "0", 10);

const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

console.log(`# ${label}`);
console.log("mode      size   ok/n     median ms   total s   dp median   coverage");

let grandTotal = 0;
let grandOk = 0;
let grandN = 0;

for (const size of sizes) {
  for (const mode of modes) {
    const times = [];
    const dps = [];
    const coverages = [];
    let ok = 0;
    let invalid = 0;
    let notUnique = 0;

    for (let index = 0; index < samples; index++) {
      const seed = seedBase + index;
      const rng = new Rng(seed);
      // The shipped default. An earlier version of this benchmark used 20, which made
      // unlucky seeds look like failures and made every candidate that traded success for
      // speed look bad; at the real default those same seeds all succeed.
      const options = { cols: size, rows: size, attempts: 100, maxNodes: 200000 };
      const start = Date.now();
      const generated =
        mode === "loop" ? generateLoop(rng, options) : generatePattern(rng, options);
      times.push(Date.now() - start);
      if (!generated) continue;
      ok++;
      dps.push(generated.difficulty);
      coverages.push(
        Math.round((100 * propagationCoverage(generated.board)) / maximumCoverage(generated.board))
      );
      if (validateSolution(generated.board, generated.solution).length > 0) invalid++;
      if (countSolutions(generated.board, 2, 0).solutions.length !== 1) notUnique++;
    }

    const total = times.reduce((a, b) => a + b, 0);
    grandTotal += total;
    grandOk += ok;
    grandN += samples;
    console.log(
      `${mode.padEnd(9)} ${String(size).padStart(2)}x${size}  ${String(ok).padStart(2)}/${samples}` +
        `    ${String(median(times)).padStart(8)}  ${String(Math.round(total / 1000)).padStart(7)}` +
        `  ${String(median(dps)).padStart(9)}   ${String(median(coverages)).padStart(6)}%` +
        (invalid || notUnique ? `   INVALID=${invalid} NOT-UNIQUE=${notUnique}` : "")
    );
  }
}

console.log(
  `total     ${String(grandOk).padStart(11)}/${grandN}    ` +
    `${String(Math.round(grandTotal / 1000)).padStart(18)} s`
);
