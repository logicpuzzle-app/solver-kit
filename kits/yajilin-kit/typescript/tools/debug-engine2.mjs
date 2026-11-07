/*
 * Feeds a known-good solution into the engine cell by cell and reports where it breaks.
 * Usage: node --import tsx tools/debug-engine2.mjs "<puzz.link code>"
 */

import { decodeUrl } from "../src/puzzlink.ts";
import { runAll } from "../src/solver.ts";
import { extractSolution } from "../src/solution.ts";
import {
  CellState,
  createEngine,
  isSolved,
  propagateEngine,
  setCell,
} from "../src/engine.ts";

const code = process.argv[2] ?? "yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n";
const board = decodeUrl(code);
const reference = extractSolution(runAll(board).answer);

const engine = createEngine(board);
propagateEngine(engine);

const blacks = [];
const lines = [];
for (let i = 0; i < engine.cellCount; i++) {
  const x = i % engine.cols;
  const y = Math.floor(i / engine.cols);
  const id = (y << 16) | x;
  if (board.cell[i].qnum !== -1) continue;
  if (reference.blacks.has(id)) blacks.push(i);
  else lines.push(i);
}
console.log(`blacks=${blacks.length} lines=${lines.length}`);

for (const i of blacks) {
  if (engine.cell[i] === CellState.Black) continue;
  if (engine.cell[i] !== CellState.Unknown) {
    console.log(`cell ${i % engine.cols + 1},${Math.floor(i / engine.cols) + 1} already ${engine.cell[i]}, expected black`);
    break;
  }
  setCell(engine, i, CellState.Black);
  if (!propagateEngine(engine)) {
    console.log(`contradiction after black at ${i % engine.cols + 1},${Math.floor(i / engine.cols) + 1}`);
    break;
  }
}
console.log("after blacks: contradiction:", engine.contradiction, "unknown:", engine.unknownCells);

for (const i of lines) {
  if (engine.cell[i] === CellState.Unknown) {
    setCell(engine, i, CellState.Line);
    if (!propagateEngine(engine)) {
      console.log(`contradiction after line at ${i % engine.cols + 1},${Math.floor(i / engine.cols) + 1}`);
      break;
    }
  } else if (engine.cell[i] !== CellState.Line) {
    console.log(`cell ${i % engine.cols + 1},${Math.floor(i / engine.cols) + 1} is ${engine.cell[i]}, expected line`);
    break;
  }
}
console.log("final: contradiction:", engine.contradiction, "unknown:", engine.unknownCells, "solved:", isSolved(engine));
console.log("lineCells:", engine.lineCells, "loopClosed:", engine.loopClosed);
let unknownEdges = 0;
for (let e = 0; e < engine.edgeCount; e++) if (engine.edge[e] === 0) unknownEdges++;
console.log("unknown edges:", unknownEdges);
