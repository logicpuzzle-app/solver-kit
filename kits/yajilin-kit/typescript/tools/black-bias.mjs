/*
 * Measures how the black-first bias affects the number of holes in a random answer,
 * which is what limits how many clues a generated puzzle can carry.
 * Usage: node --import tsx tools/black-bias.mjs [samples]
 */

import { createBoard } from "../src/board.ts";
import { Rng } from "../src/random.ts";
import { findRandomSolution } from "../src/search.ts";

const samples = Number.parseInt(process.argv[2] ?? "20", 10);

for (const bias of [500, 650, 750, 850, 950]) {
  const counts = [];
  let failures = 0;
  const start = Date.now();
  for (let i = 0; i < samples; i++) {
    const rng = new Rng(i);
    const solution = findRandomSolution(createBoard(10, 10), rng, 200000, bias);
    if (!solution) {
      failures++;
      continue;
    }
    counts.push(solution.blacks.size);
  }
  counts.sort((a, b) => a - b);
  const avg = counts.reduce((a, b) => a + b, 0) / Math.max(counts.length, 1);
  console.log(
    `bias ${bias}: blacks avg=${avg.toFixed(1)} min=${counts[0]} max=${counts[counts.length - 1]} failures=${failures} ${Date.now() - start}ms`
  );
}
