/*
 * Traces the promote-until-unique loop: how many clues a random answer needs before the
 * puzzle has exactly one solution, and how many black cells are left over.
 * Usage: node --import tsx tools/debug-promote.mjs [samples] [bias]
 */

import { createBoard, toId, toPos } from "../src/board.ts";
import { Rng } from "../src/random.ts";
import { countSolutions, findRandomSolution } from "../src/search.ts";
import { createSolution } from "../src/solution.ts";
import { dirs } from "../src/position.ts";

const samples = Number.parseInt(process.argv[2] ?? "5", 10);
const bias = Number.parseInt(process.argv[3] ?? "850", 10);
const cols = 10;
const rows = 10;

const countRay = (board, blacks, pos, dir) => {
  const delta = dirs[dir];
  let x = pos.x + delta.x;
  let y = pos.y + delta.y;
  let n = 0;
  while (board.inBoard({ x, y })) {
    if (blacks.has(toId({ x, y }))) n++;
    x += delta.x;
    y += delta.y;
  }
  return n;
};

for (let sample = 0; sample < samples; sample++) {
  const rng = new Rng(sample);
  const board = createBoard(cols, rows);
  const answer = findRandomSolution(board, rng, 200000, bias);
  if (!answer) {
    console.log(`sample ${sample}: no answer`);
    continue;
  }
  const solution = createSolution();
  answer.blacks.forEach((id) => solution.blacks.add(id));
  answer.horizontal.forEach((id) => solution.horizontal.add(id));
  answer.vertical.forEach((id) => solution.vertical.add(id));

  const pool = [...answer.blacks].sort((a, b) => a - b).map(toPos);
  rng.shuffle(pool);
  const clues = [];
  const start = Date.now();
  let result = countSolutions(board, 2, 200000);
  while (result.solutions.length > 1 && pool.length > 0) {
    const pos = pool.shift();
    solution.blacks.delete(toId(pos));
    const index = pos.y * cols + pos.x;
    // longest ray
    let bestDir = 1;
    let bestReach = -1;
    for (const dir of [1, 2, 3, 4]) {
      const delta = dirs[dir];
      let reach = 0;
      let x = pos.x + delta.x;
      let y = pos.y + delta.y;
      while (board.inBoard({ x, y })) {
        reach++;
        x += delta.x;
        y += delta.y;
      }
      if (reach > bestReach) {
        bestReach = reach;
        bestDir = dir;
      }
    }
    board.cell[index].qdir = bestDir;
    board.cell[index].qnum = 0;
    clues.push({ pos, index });
    for (const clue of clues) {
      board.cell[clue.index].qnum = countRay(
        board,
        solution.blacks,
        clue.pos,
        board.cell[clue.index].qdir
      );
    }
    result = countSolutions(board, 2, 200000);
  }
  console.log(
    `sample ${sample}: holes=${answer.blacks.size} clues=${clues.length} blacksLeft=${solution.blacks.size} solutions=${result.solutions.length} ${Date.now() - start}ms`
  );
}
