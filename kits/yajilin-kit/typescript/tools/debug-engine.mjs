/*
 * Compares the constraint engine against the technique solver on one puzzle.
 * Usage: node --import tsx tools/debug-engine.mjs "<puzz.link code>"
 */

import { decodeUrl } from "../src/puzzlink.ts";
import { runAll } from "../src/solver.ts";
import { extractSolution, validateSolution, describeValidationError } from "../src/solution.ts";
import { createEngine, propagateEngine, isSolved, toSolution, CellState } from "../src/engine.ts";
import { countSolutions } from "../src/search.ts";
import { formatAnswerGrid } from "../src/format.ts";

const code = process.argv[2] ?? "yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n";
const board = decodeUrl(code);

const outcome = runAll(board);
console.log("technique solver:", outcome.status);
const reference = extractSolution(outcome.answer);
const refErrors = validateSolution(board, reference);
console.log("reference valid:", refErrors.length === 0);
console.log(formatAnswerGrid(board, reference));

const engine = createEngine(board);
const ok = propagateEngine(engine);
console.log("engine propagate ok:", ok, "unknown:", engine.unknownCells, "lineCells:", engine.lineCells);

// Feed the known-good solution into a fresh engine and see whether the engine accepts it.
const check = createEngine(board);
for (let i = 0; i < check.cellCount; i++) {
  const x = i % check.cols;
  const y = Math.floor(i / check.cols);
  const id = (y << 16) | x;
  if (reference.blacks.has(id)) {
    check.cell[i] === CellState.Unknown && (await import("../src/engine.ts")).setCell(check, i, CellState.Black);
  }
}
const okCheck = propagateEngine(check);
console.log("engine with reference blacks:", okCheck, "unknown:", check.unknownCells, "solved:", isSolved(check));
if (okCheck && check.unknownCells === 0) {
  const sol = toSolution(check);
  const errors = validateSolution(board, sol);
  console.log("engine solution valid:", errors.length === 0, errors.slice(0, 3).map(describeValidationError));
}

const counted = countSolutions(board, 2, 200000);
console.log("countSolutions:", counted.solutions.length, "nodes:", counted.nodes, "aborted:", counted.aborted);
