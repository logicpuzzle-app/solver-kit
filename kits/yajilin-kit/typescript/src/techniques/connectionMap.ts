/*
 * Yajilin Kit — ported from gridkit `solver/algorithm/connectionMap.ts`.
 *
 * Groups the cells the line can still reach into connected areas, stopping at line
 * endpoints and forbidden cells. `cells` is filled by iterating `map` in insertion
 * order, i.e. in DFS visit order — the ports must reproduce that traversal exactly.
 */

import { toId, toPos, type Board } from "../board.js";
import type { Position } from "../position.js";
import type { AnswerMethods } from "../answerMethods.js";

export type ConnectionMap = {
  map: Map<number, number>;
  cells: Position[][];
  areaCount: number;
};

export const createConnectionMap = (
  board: Board,
  answer: AnswerMethods
): ConnectionMap => {
  const map = new Map<number, number>();
  let areaCount = 0;

  const dfs = (pos: Position, id: number): void => {
    map.set(toId(pos), id);
    answer.edgeAround(pos).forEach(({ pos: pos2 }) => {
      if (answer.isLineEdge(pos2)) {
        return;
      }
      if (answer.forbidden(pos2)) {
        return;
      }
      if (map.has(toId(pos2))) {
        return;
      }
      dfs(pos2, id);
    });
  };

  for (let i = 0; i < board.cell.length; ++i) {
    const pos = { x: i % board.cols, y: Math.floor(i / board.cols) };
    if (answer.forbidden(pos) || answer.isLineEdge(pos) || map.has(toId(pos))) {
      continue;
    }
    dfs(pos, areaCount);
    ++areaCount;
  }

  const cells: Position[][] = [...new Array(areaCount)].map(() => []);
  map.forEach((id, key) => {
    cells[id]!.push(toPos(key));
  });

  return { map, cells, areaCount };
};
