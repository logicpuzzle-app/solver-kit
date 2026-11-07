/*
 * Breaks generation down by phase at a given board size, so a failure can be attributed
 * to the answer search, the uniqueness checks, or the clue steering rather than guessed at.
 *
 * Usage: node --import tsx tools/diagnose-size.mjs [size] [seeds] [maxNodes]
 */

import { createBoard } from "../src/board.ts";
import { Rng } from "../src/random.ts";
import { countLoopRoutings, countSolutions, findRandomSolution } from "../src/search.ts";
import { generateLoop } from "../src/generator.ts";

const size = Number.parseInt(process.argv[2] ?? "15", 10);
const seeds = Number.parseInt(process.argv[3] ?? "3", 10);
const maxNodes = Number.parseInt(process.argv[4] ?? "200000", 10);

console.log(`size ${size}x${size}, maxNodes ${maxNodes}`);

for (let seed = 1; seed <= seeds; seed++) {
  const rng = new Rng(seed);

  let t = Date.now();
  const answer = findRandomSolution(createBoard(size, size), rng, maxNodes, 850);
  const answerMs = Date.now() - t;
  if (!answer) {
    console.log(`seed ${seed}: answer search FAILED (${answerMs}ms)`);
    continue;
  }

  const board = createBoard(size, size);
  t = Date.now();
  const routings = countLoopRoutings(board, answer, 2, maxNodes);
  const routingMs = Date.now() - t;

  t = Date.now();
  const empty = countSolutions(board, 2, maxNodes);
  const emptyMs = Date.now() - t;

  console.log(
    `seed ${seed}: answer ${answerMs}ms blacks=${answer.blacks.size} | ` +
      `loop-routings ${routings.solutions.length}${routings.aborted ? "(aborted)" : ""} ${routingMs}ms nodes=${routings.nodes} | ` +
      `uniqueness-on-empty ${empty.solutions.length}${empty.aborted ? "(aborted)" : ""} ${emptyMs}ms nodes=${empty.nodes}`
  );
}

console.log("\nfull pipeline:");
for (let seed = 1; seed <= seeds; seed++) {
  const rng = new Rng(seed);
  const t = Date.now();
  const traced = [];
  const generated = generateLoop(rng, {
    cols: size,
    rows: size,
    attempts: 1,
    maxNodes,
    trace: (message) => traced.push(message),
  });
  console.log(
    `seed ${seed}: ${generated ? `ok dp=${generated.difficulty}` : "failed"} ${Date.now() - t}ms`
  );
  traced.slice(0, 12).forEach((line) => console.log(`    ${line}`));
}
