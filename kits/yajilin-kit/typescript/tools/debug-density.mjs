/*
 * Measures how many black cells a random answer keeps once some cells are already
 * blocked as clues — i.e. whether re-solving after promotion restores hole density.
 * Usage: node --import tsx tools/debug-density.mjs [samples]
 */

import { createBoard } from "../src/board.ts";
import { Rng } from "../src/random.ts";
import { findRandomSolution } from "../src/search.ts";
import { buildPattern } from "../src/generator.ts";

const samples = Number.parseInt(process.argv[2] ?? "10", 10);
const cols = 10;
const rows = 10;

for (const clueCount of [8, 12, 16, 20]) {
  const blacks = [];
  let failures = 0;
  const start = Date.now();
  for (let i = 0; i < samples; i++) {
    const rng = new Rng(i);
    const pattern = buildPattern(cols, rows, clueCount, "rot2", rng);
    const board = createBoard(cols, rows);
    pattern.forEach((flag, index) => {
      if (!flag) return;
      board.cell[index].qdir = 1;
      board.cell[index].qnum = -2;
    });
    const answer = findRandomSolution(board, rng, 200000, 850);
    if (!answer) {
      failures++;
      continue;
    }
    blacks.push(answer.blacks.size);
  }
  const avg = blacks.reduce((a, b) => a + b, 0) / Math.max(blacks.length, 1);
  console.log(
    `clues=${clueCount}: blacks avg=${avg.toFixed(1)} holes avg=${(avg + clueCount).toFixed(1)} failures=${failures} ${Date.now() - start}ms`
  );
}
