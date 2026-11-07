/*
 * Generation success rate, timing and difficulty spread.
 * Usage: node --import tsx tools/gen-stats.mjs [samples] [mode] [size] [refine]
 */

import { Rng } from "../src/random.ts";
import { generateLoop, generatePattern } from "../src/generator.ts";
import { countSolutions } from "../src/search.ts";
import { validateSolution } from "../src/solution.ts";

const samples = Number.parseInt(process.argv[2] ?? "10", 10);
const mode = process.argv[3] ?? "loop";
const size = process.argv[4] ?? "10x10";
const refine = Number.parseInt(process.argv[5] ?? "0", 10);
const [cols, rows] = size.split("x").map((value) => Number.parseInt(value, 10));

let ok = 0;
let invalid = 0;
let notUnique = 0;
const dps = [];
const times = [];

for (let i = 0; i < samples; i++) {
  const rng = new Rng(i);
  const start = Date.now();
  const generated =
    mode === "loop"
      ? generateLoop(rng, { cols, rows, attempts: 20, maxNodes: 200000, refine })
      : generatePattern(rng, { cols, rows, attempts: 20, maxNodes: 200000, refine });
  const ms = Date.now() - start;
  times.push(ms);
  if (!generated) continue;
  ok++;
  dps.push(generated.difficulty);
  if (validateSolution(generated.board, generated.solution).length > 0) invalid++;
  const counted = countSolutions(generated.board, 2, 0);
  if (counted.solutions.length !== 1) notUnique++;
}

dps.sort((a, b) => a - b);
times.sort((a, b) => a - b);
const sum = (values) => values.reduce((a, b) => a + b, 0);
console.log(`mode          ${mode} ${size} refine=${refine}`);
console.log(`generated     ${ok}/${samples}`);
console.log(`invalid       ${invalid}`);
console.log(`not unique    ${notUnique}`);
if (dps.length > 0) {
  console.log(
    `dp            min=${dps[0]} median=${dps[Math.floor(dps.length / 2)]} max=${dps[dps.length - 1]} avg=${Math.round(sum(dps) / dps.length)}`
  );
}
console.log(
  `time ms       min=${times[0]} median=${times[Math.floor(times.length / 2)]} max=${times[times.length - 1]} total=${sum(times)}`
);
