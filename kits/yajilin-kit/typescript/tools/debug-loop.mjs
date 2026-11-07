/*
 * Traces loop-mode generation.
 * Usage: node --import tsx tools/debug-loop.mjs [seed] [attempts] [clues]
 */

import { Rng } from "../src/random.ts";
import { generateLoop } from "../src/generator.ts";
import { encodeCode } from "../src/puzzlink.ts";
import { formatAnswerGrid, formatProblemText } from "../src/format.ts";

const seed = Number.parseInt(process.argv[2] ?? "1", 10);
const attempts = Number.parseInt(process.argv[3] ?? "3", 10);
const clues = process.argv[4] ? Number.parseInt(process.argv[4], 10) : undefined;

const rng = new Rng(seed);
const start = Date.now();
const generated = generateLoop(rng, {
  cols: 10,
  rows: 10,
  attempts,
  clues,
  maxNodes: 200000,
  trace: (message) => console.log(message),
});
console.log(`elapsed ${Date.now() - start}ms`);
if (!generated) {
  console.log("FAILED");
} else {
  console.log(encodeCode(generated.board));
  console.log(`DP ${generated.difficulty} status ${generated.outcome.status}`);
  console.log(formatProblemText(generated.board));
  console.log(formatAnswerGrid(generated.board, generated.solution));
}
