/*
 * Yajilin Kit — ported from gridkit `solver/addWhiteCellWithZero.ts`.
 *
 * When an arrow's remaining count is already satisfied, every still-free cell along the
 * arrow becomes white. `nextNum` subtracts the clue of the next arrow pointing the same
 * way, which is what lets chained arrows cancel out.
 */

import type { Board } from "../board.js";
import { dirs } from "../position.js";
import type { AnswerMethods } from "../answerMethods.js";
import { Reason } from "../reasons.js";
import type { Status } from "../status.js";

/**
 * Blacks already standing from `from` (exclusive) to the board edge along `delta`.
 *
 * A `?` clue counts these whether or not its own number is known, so they are the floor
 * under it and come straight off the arrow that runs into it.
 */
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

export const addWhiteCellWithZero = (
  board: Board,
  answer: AnswerMethods
): Status => {
  const { addWhiteCell, hasBlackCell, forbidden } = answer;
  let isAdvanced = false;
  for (let i = 0, len = board.cell.length; i < len; i++) {
    const dir = board.cell[i]!.qdir;
    if (dir === -1 || dir === 0) {
      continue;
    }
    const dirDelta = dirs[dir]!;
    let x = i % board.cols;
    let y = Math.floor(i / board.cols);
    x += dirDelta.x;
    y += dirDelta.y;

    let blackCount = 0;
    while (board.inBoard({ x, y }) && board.cell[y * board.cols + x]!.qdir !== dir) {
      if (hasBlackCell({ x, y })) {
        ++blackCount;
      }
      x += dirDelta.x;
      y += dirDelta.y;
    }
    const nextNum = board.inBoard({ x, y })
      ? board.cell[y * board.cols + x]!.qnum
      : 0;
    // This arrow's own count has to be known for the rule to say anything at all.
    if (board.cell[i]!.qnum === -2) {
      continue;
    }
    /*
     * The most blacks that can lie between here and the clue this arrow runs into. When
     * that clue is a `?` the subtraction is unavailable, but the far clue still counts
     * every black already standing beyond it, and subtracting those is what makes the
     * bound bite. An arrow reading 1 that runs into a `?` with one black already placed
     * past it has nothing left to spend, so everything in between is white — reading the
     * `?` as merely "nothing or more" throws that away.
     */
    const most =
      nextNum === -2
        ? board.cell[i]!.qnum - placedBlacksBeyond(board, answer, { x, y }, dirDelta)
        : board.cell[i]!.qnum - nextNum;
    // A `?` leaves nothing subtracted, so the two "subtracted" reasons cannot apply and
    // the deduction is recorded as the plain one it is.
    const subtracted = nextNum !== -2 && nextNum > 0;

    if (most === blackCount) {
      x = i % board.cols;
      y = Math.floor(i / board.cols);
      x += dirDelta.x;
      y += dirDelta.y;

      while (
        board.inBoard({ x, y }) &&
        board.cell[y * board.cols + x]!.qdir !== dir
      ) {
        if (!forbidden({ x, y })) {
          if (blackCount > 0 && subtracted) {
            const flag = addWhiteCell(
              answer,
              { x, y },
              Reason.SubtractedBlackAlreadyPlacedWhite
            );
            isAdvanced ||= flag;
          }
          if (blackCount > 0) {
            const flag = addWhiteCell(answer, { x, y }, Reason.BlackAlreadyPlacedWhite);
            isAdvanced ||= flag;
          } else if (subtracted) {
            const flag = addWhiteCell(answer, { x, y }, Reason.SubtractedZeroWhite);
            isAdvanced ||= flag;
          } else {
            const flag = addWhiteCell(answer, { x, y }, Reason.ZeroWhite);
            isAdvanced ||= flag;
          }
        }
        x += dirDelta.x;
        y += dirDelta.y;
      }
    }
  }
  return isAdvanced ? "advanced" : "stopped";
};
