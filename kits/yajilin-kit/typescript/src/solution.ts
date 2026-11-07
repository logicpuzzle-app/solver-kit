/*
 * Yajilin Kit — solution extraction and rule checking.
 *
 * The ported solver decides completion with `isSingleLine`, a cheap heuristic that is
 * fine for interactive use but far too weak for a generator. Everything that has to be
 * trusted — uniqueness, generated puzzles, verification of a solved board — goes through
 * `validateSolution`, which checks the Yajilin rules from scratch.
 */

import { cellAt, toId, toPos, type Board } from "./board.js";
import { dirs, type Position } from "./position.js";
import { LineState, type AnswerModel } from "./answerModel.js";

export type Solution = {
  /** Cell ids of black cells. */
  blacks: Set<number>;
  /** Ids of the left cell of each horizontal line segment. */
  horizontal: Set<number>;
  /** Ids of the upper cell of each vertical line segment. */
  vertical: Set<number>;
};

export const createSolution = (): Solution => ({
  blacks: new Set(),
  horizontal: new Set(),
  vertical: new Set(),
});

export const extractSolution = (answer: AnswerModel): Solution => {
  const solution = createSolution();
  answer.blackCells.forEach((id) => solution.blacks.add(id));
  answer.horizontal.forEach((state, id) => {
    if (state === LineState.Line) solution.horizontal.add(id);
  });
  answer.vertical.forEach((state, id) => {
    if (state === LineState.Line) solution.vertical.add(id);
  });
  return solution;
};

export const solutionKey = (board: Board, solution: Solution): string => {
  const parts: string[] = [];
  for (let i = 0; i < board.cell.length; i++) {
    const id = toId({ x: i % board.cols, y: Math.floor(i / board.cols) });
    parts.push(solution.blacks.has(id) ? "1" : "0");
  }
  parts.push("|");
  for (let i = 0; i < board.cell.length; i++) {
    const id = toId({ x: i % board.cols, y: Math.floor(i / board.cols) });
    parts.push(solution.horizontal.has(id) ? "1" : "0");
    parts.push(solution.vertical.has(id) ? "1" : "0");
  }
  return parts.join("");
};

/** Blacks visible from a clue in its arrow direction, up to the board edge. */
export const countBlacksAlongArrow = (
  board: Board,
  solution: Solution,
  origin: Position,
  dir: number
): number => {
  const delta = dirs[dir]!;
  let x = origin.x + delta.x;
  let y = origin.y + delta.y;
  let count = 0;
  while (board.inBoard({ x, y })) {
    if (solution.blacks.has(toId({ x, y }))) {
      count++;
    }
    x += delta.x;
    y += delta.y;
  }
  return count;
};

export type ValidationError =
  | { kind: "black-on-clue"; pos: Position }
  | { kind: "adjacent-blacks"; pos: Position; other: Position }
  | { kind: "line-on-blocked-cell"; pos: Position }
  | { kind: "cell-not-covered"; pos: Position }
  | { kind: "degree"; pos: Position; degree: number }
  | { kind: "not-single-loop"; pos: Position }
  | { kind: "arrow-count"; pos: Position; expected: number; actual: number };

const neighbours = (board: Board, solution: Solution, pos: Position): Position[] => {
  const result: Position[] = [];
  if (solution.vertical.has(toId({ x: pos.x, y: pos.y - 1 }))) {
    result.push({ x: pos.x, y: pos.y - 1 });
  }
  if (solution.vertical.has(toId(pos))) {
    result.push({ x: pos.x, y: pos.y + 1 });
  }
  if (solution.horizontal.has(toId({ x: pos.x - 1, y: pos.y }))) {
    result.push({ x: pos.x - 1, y: pos.y });
  }
  if (solution.horizontal.has(toId(pos))) {
    result.push({ x: pos.x + 1, y: pos.y });
  }
  return result.filter((p) => board.inBoard(p));
};

/** Returns every rule violation; an empty array means the solution is valid. */
export const validateSolution = (
  board: Board,
  solution: Solution
): ValidationError[] => {
  const errors: ValidationError[] = [];

  // Segments must stay inside the board and off blocked cells.
  const blocked = (pos: Position): boolean =>
    !board.inBoard(pos) ||
    solution.blacks.has(toId(pos)) ||
    cellAt(board, pos).qnum !== -1;

  solution.horizontal.forEach((id) => {
    const pos = toPos(id);
    const right = { x: pos.x + 1, y: pos.y };
    if (blocked(pos)) errors.push({ kind: "line-on-blocked-cell", pos });
    if (blocked(right)) errors.push({ kind: "line-on-blocked-cell", pos: right });
  });
  solution.vertical.forEach((id) => {
    const pos = toPos(id);
    const down = { x: pos.x, y: pos.y + 1 };
    if (blocked(pos)) errors.push({ kind: "line-on-blocked-cell", pos });
    if (blocked(down)) errors.push({ kind: "line-on-blocked-cell", pos: down });
  });

  const loopCells: Position[] = [];
  for (let i = 0; i < board.cell.length; i++) {
    const pos = { x: i % board.cols, y: Math.floor(i / board.cols) };
    const cell = board.cell[i]!;
    const isBlack = solution.blacks.has(toId(pos));
    const isClue = cell.qnum !== -1;

    if (isBlack && isClue) {
      errors.push({ kind: "black-on-clue", pos });
      continue;
    }
    if (isBlack) {
      const right = { x: pos.x + 1, y: pos.y };
      const down = { x: pos.x, y: pos.y + 1 };
      if (board.inBoard(right) && solution.blacks.has(toId(right))) {
        errors.push({ kind: "adjacent-blacks", pos, other: right });
      }
      if (board.inBoard(down) && solution.blacks.has(toId(down))) {
        errors.push({ kind: "adjacent-blacks", pos, other: down });
      }
      continue;
    }
    if (isClue) {
      continue;
    }

    const degree = neighbours(board, solution, pos).length;
    if (degree === 0) {
      errors.push({ kind: "cell-not-covered", pos });
    } else if (degree !== 2) {
      errors.push({ kind: "degree", pos, degree });
    } else {
      loopCells.push(pos);
    }
  }

  if (errors.length > 0) {
    return errors;
  }

  // Every free cell must belong to the same loop.
  if (loopCells.length > 0) {
    const seen = new Set<number>();
    const stack = [loopCells[0]!];
    seen.add(toId(loopCells[0]!));
    while (stack.length > 0) {
      const pos = stack.pop()!;
      for (const next of neighbours(board, solution, pos)) {
        if (!seen.has(toId(next))) {
          seen.add(toId(next));
          stack.push(next);
        }
      }
    }
    if (seen.size !== loopCells.length) {
      errors.push({ kind: "not-single-loop", pos: loopCells[0]! });
    }
  }

  for (let i = 0; i < board.cell.length; i++) {
    const cell = board.cell[i]!;
    if (cell.qdir === -1 || cell.qdir === 0 || cell.qnum < 0) {
      continue;
    }
    const pos = { x: i % board.cols, y: Math.floor(i / board.cols) };
    const actual = countBlacksAlongArrow(board, solution, pos, cell.qdir);
    if (actual !== cell.qnum) {
      errors.push({ kind: "arrow-count", pos, expected: cell.qnum, actual });
    }
  }

  return errors;
};

export const describeValidationError = (error: ValidationError): string => {
  const at = (pos: Position) => `(${pos.x + 1},${pos.y + 1})`;
  switch (error.kind) {
    case "black-on-clue":
      return `black cell on a clue at ${at(error.pos)}`;
    case "adjacent-blacks":
      return `adjacent black cells at ${at(error.pos)} and ${at(error.other)}`;
    case "line-on-blocked-cell":
      return `line runs through a blocked cell at ${at(error.pos)}`;
    case "cell-not-covered":
      return `cell not covered by the loop at ${at(error.pos)}`;
    case "degree":
      return `cell at ${at(error.pos)} has ${error.degree} line ends`;
    case "not-single-loop":
      return `the line forms more than one loop`;
    case "arrow-count":
      return `arrow at ${at(error.pos)} expects ${error.expected} black cells but sees ${error.actual}`;
  }
};
