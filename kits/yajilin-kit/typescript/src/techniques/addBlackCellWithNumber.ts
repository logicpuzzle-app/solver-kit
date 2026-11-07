/*
 * Yajilin Kit — ported from gridkit `solver/addBlackCellWithNumber.ts`.
 *
 * Walks each arrow, splits the still-undecided cells along it into maximal runs, and
 * compares the arrow's count with the maximum number of blacks those runs can hold.
 * When they match:
 *   - odd runs have every second cell forced black;
 *   - even runs leave a two-way choice, registered in blackCandidates* so that whitening
 *     one half later forces the other, plus the "2n in n" white deductions at the ends.
 */

import { toId, type Board } from "../board.js";
import { dirs } from "../position.js";
import type { AnswerMethods } from "../answerMethods.js";
import { Reason } from "../reasons.js";
import type { Status } from "../status.js";

/**
 * The most blacks that could still sit from `from` (exclusive) to the board edge along
 * `delta`, counting the ones already placed.
 *
 * Used only to bound a `?` clue. Deliberately an over-estimate — it costs each maximal
 * undecided run `ceil(len / 2)` without checking whether a neighbouring black already
 * rules the first cell out. Over-estimating here can only weaken the bound it feeds, never
 * make it claim too much.
 */
const maxBlacksBeyond = (
  board: Board,
  answer: AnswerMethods,
  from: { x: number; y: number },
  delta: { x: number; y: number }
): number => {
  const { hasBlackCell, hasLine, hasWhiteCell, isLineEdge } = answer;
  let x = from.x + delta.x;
  let y = from.y + delta.y;
  let placed = 0;
  let run = 0;
  let capacity = 0;
  while (board.inBoard({ x, y })) {
    const free =
      !hasLine({ x, y }) &&
      !hasBlackCell({ x, y }) &&
      !hasWhiteCell({ x, y }) &&
      !isLineEdge({ x, y }) &&
      board.cell[y * board.cols + x]!.qnum === -1;
    if (free) {
      run++;
    } else {
      if (hasBlackCell({ x, y })) placed++;
      capacity += Math.floor((run + 1) / 2);
      run = 0;
    }
    x += delta.x;
    y += delta.y;
  }
  capacity += Math.floor((run + 1) / 2);
  return placed + capacity;
};

/** Blacks already standing beyond `from`; the floor under a `?` clue's own count. */
const placedBlacksBeyond = (
  board: Board,
  answer: AnswerMethods,
  from: { x: number; y: number },
  delta: { x: number; y: number }
): number => {
  let x = from.x + delta.x;
  let y = from.y + delta.y;
  let placed = 0;
  while (board.inBoard({ x, y })) {
    if (answer.hasBlackCell({ x, y })) placed++;
    x += delta.x;
    y += delta.y;
  }
  return placed;
};

export const addBlackCellWithNumber = (
  board: Board,
  answer: AnswerMethods
): Status => {
  let isAdvanced = false;
  const {
    addBlackCell,
    hasBlackCell,
    addWhiteCell,
    hasLine,
    hasWhiteCell,
    isLineEdge,
    forbidden,
  } = answer;

  for (let i = 0, len = board.cell.length; i < len; i++) {
    const dir = board.cell[i]!.qdir;
    if (dir === -1 || dir === 0) {
      continue;
    }
    const num = board.cell[i]!.qnum;
    if (num === -2) {
      continue;
    }
    const dirDelta = dirs[dir]!;
    let x = i % board.cols;
    let y = Math.floor(i / board.cols);
    x += dirDelta.x;
    y += dirDelta.y;

    let blackCount = 0;
    const unsettledCells: { x: number; y: number }[][] = [];
    while (board.inBoard({ x, y }) && board.cell[y * board.cols + x]!.qdir !== dir) {
      if (hasBlackCell({ x, y })) {
        ++blackCount;
      }
      if (
        !hasLine({ x, y }) &&
        !hasBlackCell({ x, y }) &&
        !hasWhiteCell({ x, y }) &&
        !isLineEdge({ x, y }) &&
        board.cell[y * board.cols + x]!.qnum === -1
      ) {
        if (unsettledCells.length === 0) {
          unsettledCells.push([{ x, y }]);
        } else {
          const lastRun = unsettledCells[unsettledCells.length - 1]!;
          const lastCell = lastRun[lastRun.length - 1]!;
          if (lastCell.x + dirDelta.x === x && lastCell.y + dirDelta.y === y) {
            lastRun.push({ x, y });
          } else {
            unsettledCells.push([{ x, y }]);
          }
        }
      }
      x += dirDelta.x;
      y += dirDelta.y;
    }
    const nextNum = board.inBoard({ x, y })
      ? board.cell[y * board.cols + x]!.qnum
      : 0;
    /*
     * How many blacks lie between this arrow and the clue it runs into. An arrow counts to
     * the board edge, and the clue it runs into counts a suffix of the same ray, so the
     * count in between is this arrow's number minus that clue's.
     *
     * When that clue is a `?` its number is unknown and the difference becomes a range
     * rather than a value. Both ends are still usable: the far clue can count no fewer than
     * nothing, which caps the run at this arrow's own number, and it can count no more than
     * the blacks that could physically fit beyond it, which puts a floor under the run.
     */
    const capped = board.cell[i]!.qnum;
    const low =
      nextNum === -2
        ? Math.max(0, capped - maxBlacksBeyond(board, answer, { x, y }, dirDelta))
        : capped - nextNum;
    const high =
      nextNum === -2
        ? capped - placedBlacksBeyond(board, answer, { x, y }, dirDelta)
        : capped - nextNum;
    const candCount = unsettledCells.reduce(
      (a, b) => a + Math.floor((b.length + 1) / 2),
      0
    );
    if (low === candCount + blackCount) {
      unsettledCells
        .filter((cand) => cand.length % 2 === 1)
        .forEach((cand) => {
          cand.forEach((c, index) => {
            if (index % 2 === 0) {
              const flag = addBlackCell(answer, c, Reason.EverySecondBlack);
              isAdvanced ||= flag;
            }
          });
        });
      unsettledCells
        .filter((cand) => cand.length % 2 === 0)
        .forEach((cand) => {
          cand.forEach((c, index) => {
            if (index % 2 === 0) {
              if (dirDelta.x === 0) {
                answer.blackCandidatesVertical.add(
                  toId({ x: c.x, y: c.y + Math.min(dirDelta.y, 0) })
                );
                answer.setLineBar(c, {
                  x: c.x + dirDelta.x,
                  y: c.y + dirDelta.y,
                });
              } else {
                answer.blackCandidatesHorizontal.add(
                  toId({ x: c.x + Math.min(dirDelta.x, 0), y: c.y })
                );
                answer.setLineBar(c, {
                  x: c.x + dirDelta.x,
                  y: c.y + dirDelta.y,
                });
              }
            }
          });
          const first = cand[0]!;
          const last = cand[cand.length - 1]!;
          const prev = { x: first.x - dirDelta.x, y: first.y - dirDelta.y };
          const prevNeighbor1 = { x: first.x - dirDelta.y, y: first.y - dirDelta.x };
          const prevNeighbor2 = { x: first.x + dirDelta.y, y: first.y + dirDelta.x };
          if (forbidden(prev)) {
            if (!forbidden(prevNeighbor1)) {
              const flag1 = addWhiteCell(answer, prevNeighbor1, Reason.TwoNInNWhiteNear);
              isAdvanced ||= flag1;
            }
            if (!forbidden(prevNeighbor2)) {
              const flag2 = addWhiteCell(answer, prevNeighbor2, Reason.TwoNInNWhiteNear);
              isAdvanced ||= flag2;
            }
          }
          const next = { x: last.x + dirDelta.x, y: last.y + dirDelta.y };
          const nextNeighbor1 = { x: last.x - dirDelta.y, y: last.y - dirDelta.x };
          const nextNeighbor2 = { x: last.x + dirDelta.y, y: last.y + dirDelta.x };
          if (forbidden(next)) {
            if (!forbidden(nextNeighbor1)) {
              const flag1 = addWhiteCell(answer, nextNeighbor1, Reason.TwoNInNWhiteNear);
              isAdvanced ||= flag1;
            }
            if (!forbidden(nextNeighbor2)) {
              const flag2 = addWhiteCell(answer, nextNeighbor2, Reason.TwoNInNWhiteNear);
              isAdvanced ||= flag2;
            }
          }

          const prevDiagonal1 = {
            x: first.x - dirDelta.x - dirDelta.y,
            y: first.y - dirDelta.y - dirDelta.x,
          };
          if (
            forbidden(prevDiagonal1) &&
            !forbidden(prevNeighbor1) &&
            !isLineEdge(prevNeighbor1)
          ) {
            const neighbor = {
              x: cand[1]!.x - dirDelta.y,
              y: cand[1]!.y - dirDelta.x,
            };
            if (!forbidden(neighbor)) {
              const flag = addWhiteCell(answer, neighbor, Reason.TwoNInNWhiteFar);
              isAdvanced ||= flag;
            }
          }
          const prevDiagonal2 = {
            x: first.x - dirDelta.x + dirDelta.y,
            y: first.y - dirDelta.y + dirDelta.x,
          };
          if (
            forbidden(prevDiagonal2) &&
            !forbidden(prevNeighbor2) &&
            !isLineEdge(prevNeighbor2)
          ) {
            const neighbor = {
              x: cand[1]!.x + dirDelta.y,
              y: cand[1]!.y + dirDelta.x,
            };
            if (!forbidden(neighbor)) {
              const flag = addWhiteCell(answer, neighbor, Reason.TwoNInNWhiteFar);
              isAdvanced ||= flag;
            }
          }
          const nextDiagonal1 = {
            x: last.x + dirDelta.x - dirDelta.y,
            y: last.y + dirDelta.y - dirDelta.x,
          };
          if (
            forbidden(nextDiagonal1) &&
            !forbidden(nextNeighbor1) &&
            !isLineEdge(nextNeighbor1)
          ) {
            const neighbor = {
              x: cand[cand.length - 2]!.x - dirDelta.y,
              y: cand[cand.length - 2]!.y - dirDelta.x,
            };
            if (!forbidden(neighbor)) {
              const flag = addWhiteCell(answer, neighbor, Reason.TwoNInNWhiteFar);
              isAdvanced ||= flag;
            }
          }
          const nextDiagonal2 = {
            x: last.x + dirDelta.x + dirDelta.y,
            y: last.y + dirDelta.y + dirDelta.x,
          };
          if (
            forbidden(nextDiagonal2) &&
            !forbidden(nextNeighbor2) &&
            !isLineEdge(nextNeighbor2)
          ) {
            const neighbor = {
              x: cand[cand.length - 2]!.x + dirDelta.y,
              y: cand[cand.length - 2]!.y + dirDelta.x,
            };
            if (!forbidden(neighbor)) {
              const flag = addWhiteCell(answer, neighbor, Reason.TwoNInNWhiteFar);
              isAdvanced ||= flag;
            }
          }
        });
    } else if (low > candCount + blackCount) {
      return "broken";
    } else if (high < blackCount) {
      return "broken";
    }
  }
  return isAdvanced ? "advanced" : "stopped";
};
