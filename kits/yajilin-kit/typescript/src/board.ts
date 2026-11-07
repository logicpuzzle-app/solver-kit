/*
 * Yajilin Kit — TypeScript reference implementation.
 * Ported from gridkit `frontend/src/puzzle/board.ts`.
 */

import type { Position } from "./position.js";

export type Cell = {
  /** Arrow direction (1=up, 2=down, 3=left, 4=right); -1 when the cell carries no clue. */
  qdir: number;
  /** Clue count; -1 = no clue, -2 = arrow without a number. */
  qnum: number;
};

export type Board = {
  cell: Cell[];
  cols: number;
  rows: number;
  inBoard: (pos: Position) => boolean;
};

/**
 * Cell ids pack y into the high bits. `toPos` masks x with 0xff, which is what the
 * original does — boards are limited to 255 columns as a result.
 */
export const maxSize = 256;

export const toId = (pos: Position): number => (pos.y << 16) | pos.x;

export const toPos = (id: number): Position => ({
  x: id & 0xff,
  y: id >> 16,
});

export const createBoard = (cols: number, rows: number): Board => {
  const cell: Cell[] = [];
  for (let i = 0; i < cols * rows; i++) {
    cell.push({ qdir: -1, qnum: -1 });
  }
  return {
    cell,
    cols,
    rows,
    inBoard: (pos: Position) =>
      pos.x >= 0 && pos.x < cols && pos.y >= 0 && pos.y < rows,
  };
};

export const cloneBoard = (board: Board): Board => {
  const copy = createBoard(board.cols, board.rows);
  board.cell.forEach((c, i) => {
    copy.cell[i]!.qdir = c.qdir;
    copy.cell[i]!.qnum = c.qnum;
  });
  return copy;
};

export const cellAt = (board: Board, pos: Position): Cell =>
  board.cell[pos.y * board.cols + pos.x]!;

/** True when the cell holds a clue (arrow), which the solver treats as impassable. */
export const isClue = (board: Board, pos: Position): boolean =>
  cellAt(board, pos).qnum !== -1;
