/*
 * Reports where loop-mode generation gives up.
 * Usage: node --import tsx tools/debug-generate.mjs [seed] [attempts]
 */

import { createBoard, toPos } from "../src/board.ts";
import { Rng } from "../src/random.ts";
import { findRandomSolution, countSolutions } from "../src/search.ts";
import { createSolution, validateSolution, describeValidationError } from "../src/solution.ts";
import { formatAnswerGrid, formatProblemText } from "../src/format.ts";

const seed = Number.parseInt(process.argv[2] ?? "1", 10);
const attempts = Number.parseInt(process.argv[3] ?? "5", 10);
const rng = new Rng(seed);
const cols = 10;
const rows = 10;
const clueTarget = 12;

for (let attempt = 1; attempt <= attempts; attempt++) {
  const blank = createBoard(cols, rows);
  const t0 = Date.now();
  const answer = findRandomSolution(blank, rng, 200000);
  const ms = Date.now() - t0;
  if (!answer) {
    console.log(`attempt ${attempt}: no random solution (${ms}ms)`);
    continue;
  }
  console.log(`attempt ${attempt}: solution with ${answer.blacks.size} blacks (${ms}ms)`);
  if (attempt === 1) {
    console.log(formatAnswerGrid(blank, answer));
  }
  if (answer.blacks.size < clueTarget) {
    console.log(`  too few blacks for ${clueTarget} clues`);
    continue;
  }

  const blacks = [...answer.blacks].sort((a, b) => a - b);
  rng.shuffle(blacks);
  const promoted = new Set(blacks.slice(0, clueTarget));
  const solution = createSolution();
  answer.blacks.forEach((id) => {
    if (!promoted.has(id)) solution.blacks.add(id);
  });
  answer.horizontal.forEach((id) => solution.horizontal.add(id));
  answer.vertical.forEach((id) => solution.vertical.add(id));

  const board = createBoard(cols, rows);
  const clueCells = [...promoted].map(toPos);
  for (const pos of clueCells) {
    const cell = board.cell[pos.y * cols + pos.x];
    cell.qdir = 1;
    cell.qnum = 0;
  }
  // Recount properly: point every clue down and count blacks below it.
  for (const pos of clueCells) {
    const cell = board.cell[pos.y * cols + pos.x];
    let count = 0;
    for (let y = pos.y + 1; y < rows; y++) {
      if (solution.blacks.has((y << 16) | pos.x)) count++;
    }
    cell.qdir = 2;
    cell.qnum = count;
  }

  const errors = validateSolution(board, solution);
  console.log(`  validate: ${errors.length === 0 ? "ok" : errors.slice(0, 3).map(describeValidationError).join("; ")}`);
  if (errors.length > 0) {
    console.log(formatProblemText(board));
    console.log(formatAnswerGrid(board, solution));
    break;
  }
  const t1 = Date.now();
  const counted = countSolutions(board, 2, 200000);
  console.log(
    `  solutions=${counted.solutions.length} nodes=${counted.nodes} aborted=${counted.aborted} (${Date.now() - t1}ms)`
  );
}
