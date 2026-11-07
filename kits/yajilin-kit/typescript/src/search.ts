/*
 * Yajilin Kit — exhaustive search on top of the constraint engine.
 *
 * Depth-first, branching on cell colours first and on edges only once every cell is
 * decided — a loop cell with three usable sides and one line still has a free choice, so
 * cells alone are not enough. Edge branching prefers extending the loop from an open end,
 * which prunes far harder than picking an arbitrary edge.
 *
 * The engine state is mutated in place and rolled back with mark/undo rather than copied
 * per node. With no RNG the branch choice is fully determined by index order, so
 * uniqueness answers are identical in every port.
 */

import type { Board } from "./board.js";
import {
  CellState,
  EdgeState,
  createEngine,
  isSolved,
  mark,
  propagateEngine,
  remark,
  setCell,
  setEdge,
  toSolution,
  undo,
  type Engine,
  type Mark,
} from "./engine.js";
import type { Rng } from "./random.js";
import type { Solution } from "./solution.js";

export type SearchLimits = {
  /** Stop once this many solutions are found; uniqueness only needs 2. */
  limit: number;
  /** Give up after this many search nodes; 0 = unlimited. */
  maxNodes?: number;
  /**
   * Randomised search only: how often, in parts per thousand, a cell is tried as black
   * before it is tried as part of the loop. Raising it yields answers with more holes,
   * which is what generation needs — the default 500 tends to produce loops that cover
   * almost the whole board, leaving too few cells to turn into clues.
   */
  blackBias?: number;
};

export type SearchResult = {
  solutions: Solution[];
  nodes: number;
  /** True when `maxNodes` cut the search short, so the result may be incomplete. */
  aborted: boolean;
};

/**
 * The most constrained unknown cell — the one with the fewest usable sides and the most
 * line ends already attached. Ties are collected in a reusable buffer and resolved with a
 * single random draw; sampling them one by one cost more RNG calls than the scan itself.
 */
const pickBranchCell = (engine: Engine, rng: Rng | undefined, buffer: number[]): number => {
  let bestScore = -1;
  buffer.length = 0;
  for (let i = 0; i < engine.cellCount; i++) {
    if (engine.cell[i] !== CellState.Unknown) continue;
    const score = engine.blankCount[i]! * 2 + engine.lineCount[i]!;
    if (score > bestScore) {
      bestScore = score;
      buffer.length = 0;
      buffer.push(i);
    } else if (rng !== undefined && score === bestScore) {
      buffer.push(i);
    }
  }
  if (buffer.length === 0) return -1;
  if (rng === undefined || buffer.length === 1) return buffer[0]!;
  return buffer[rng.nextInt(buffer.length)]!;
};

/**
 * Deciding every cell does not decide every edge — a loop cell with three usable sides
 * and one line still has a free choice. Those are resolved by extending the loop from an
 * open end whenever possible, which prunes far harder than picking an arbitrary edge.
 */
const pickBranchEdge = (engine: Engine, rng: Rng | undefined, buffer: number[]): number => {
  let fallback = -1;
  buffer.length = 0;
  for (let e = 0; e < engine.edgeCount; e++) {
    if (engine.edge[e] !== EdgeState.Unknown) continue;
    const a = engine.edgeCells[e * 2]!;
    const b = engine.edgeCells[e * 2 + 1]!;
    const open =
      (engine.cell[a] === CellState.Line && engine.lineCount[a] === 1) ||
      (engine.cell[b] === CellState.Line && engine.lineCount[b] === 1);
    if (!open) {
      if (fallback < 0) fallback = e;
      continue;
    }
    buffer.push(e);
    if (rng === undefined) break;
  }
  if (buffer.length === 0) return fallback;
  if (buffer.length === 1) return buffer[0]!;
  return buffer[rng!.nextInt(buffer.length)]!;
};

export const searchEngine = (
  engine: Engine,
  limits: SearchLimits,
  rng?: Rng
): SearchResult => {
  const result: SearchResult = { solutions: [], nodes: 0, aborted: false };
  const maxNodes = limits.maxNodes ?? 0;
  const blackBias = limits.blackBias ?? 500;
  const buffer: number[] = [];
  // One reusable mark per depth; allocating a fresh one at every node showed up in the
  // profile as garbage-collector time.
  const marks: Mark[] = [];

  const visit = (depth: number): void => {
    if (result.solutions.length >= limits.limit || result.aborted) return;
    result.nodes++;
    if (maxNodes > 0 && result.nodes > maxNodes) {
      result.aborted = true;
      return;
    }

    if (!propagateEngine(engine)) {
      return;
    }

    if (marks[depth] === undefined) {
      marks[depth] = mark(engine);
    }
    const saved = marks[depth]!;

    const cell = pickBranchCell(engine, rng, buffer);
    if (cell >= 0) {
      const blackFirst = rng ? rng.nextInt(1000) < blackBias : true;
      const first = blackFirst ? CellState.Black : CellState.Line;
      const second = blackFirst ? CellState.Line : CellState.Black;

      remark(engine, saved);
      setCell(engine, cell, first);
      visit(depth + 1);
      undo(engine, saved);
      if (result.solutions.length >= limits.limit || result.aborted) return;

      remark(engine, saved);
      setCell(engine, cell, second);
      visit(depth + 1);
      undo(engine, saved);
      return;
    }

    const edge = pickBranchEdge(engine, rng, buffer);
    if (edge >= 0) {
      const lineFirst = rng ? rng.nextBoolean() : true;
      const first = lineFirst ? EdgeState.Line : EdgeState.Blank;
      const second = lineFirst ? EdgeState.Blank : EdgeState.Line;

      remark(engine, saved);
      setEdge(engine, edge, first);
      visit(depth + 1);
      undo(engine, saved);
      if (result.solutions.length >= limits.limit || result.aborted) return;

      remark(engine, saved);
      setEdge(engine, edge, second);
      visit(depth + 1);
      undo(engine, saved);
      return;
    }

    if (isSolved(engine)) {
      result.solutions.push(toSolution(engine));
    }
  };

  const root = mark(engine);
  visit(0);
  undo(engine, root);
  return result;
};

export const search = (
  board: Board,
  limits: SearchLimits,
  rng?: Rng
): SearchResult => searchEngine(createEngine(board), limits, rng);

/**
 * How much of the answer the clues pin down on their own, counted as cells and edges that
 * plain propagation decides without any branching. This is the objective the generator
 * anneals on: uniqueness is a yes/no answer that says nothing about how close a puzzle is
 * to being one, whereas coverage rises steadily as the clues start to bite, so a search
 * over clue configurations has a gradient to follow.
 *
 * Returns -1 when the board is already contradictory.
 */
export const propagationCoverage = (board: Board): number => {
  const engine = createEngine(board);
  if (!propagateEngine(engine)) {
    return -1;
  }
  let determined = 0;
  for (let i = 0; i < engine.cellCount; i++) {
    if (engine.cell[i] !== CellState.Unknown) determined++;
  }
  for (let e = 0; e < engine.edgeCount; e++) {
    if (engine.edge[e] !== EdgeState.Unknown) determined++;
  }
  return determined;
};

/**
 * Coverage plus the cells propagation could not decide. Those cells are exactly where the
 * clues say too little, so the generator aims its moves at them rather than at random
 * parts of the board.
 */
// Measuring the objective with a deliberately weakened engine was tried, on the theory
// that a stronger engine saturates coverage and flattens the gradient. It made no
// difference (12 of 16 against 13), so the objective uses the same engine as everything else.
export const analysePropagation = (
  board: Board
): { coverage: number; undetermined: number[] } => {
  const engine = createEngine(board);
  if (!propagateEngine(engine)) {
    return { coverage: -1, undetermined: [] };
  }
  let determined = 0;
  const undetermined: number[] = [];
  for (let i = 0; i < engine.cellCount; i++) {
    if (engine.cell[i] !== CellState.Unknown) {
      determined++;
    } else {
      undetermined.push(i);
    }
  }
  for (let e = 0; e < engine.edgeCount; e++) {
    if (engine.edge[e] !== EdgeState.Unknown) determined++;
  }
  return { coverage: determined, undetermined };
};

/** The coverage a fully determined board would reach. */
export const maximumCoverage = (board: Board): number => {
  const engine = createEngine(board);
  return engine.cellCount + engine.edgeCount;
};

/** How many solutions does this board have, counted up to `limit`? */
export const countSolutions = (board: Board, limit = 2, maxNodes = 0): SearchResult =>
  search(board, { limit, maxNodes });

export const hasUniqueSolution = (board: Board, maxNodes = 0): boolean => {
  const result = countSolutions(board, 2, maxNodes);
  return !result.aborted && result.solutions.length === 1;
};

/**
 * How many ways the loop can be drawn once the black cells are fixed, counted up to
 * `limit`. Arrow clues only ever count black cells, so if a black configuration admits
 * two different loops then no clue anywhere on the board can tell them apart and the
 * puzzle can never be made unique. Generation uses this to discard such answers early.
 */
export const countLoopRoutings = (
  board: Board,
  solution: Solution,
  limit = 2,
  maxNodes = 0
): SearchResult => {
  const engine = createEngine(board);
  for (let i = 0; i < engine.cellCount; i++) {
    if (engine.cell[i] !== CellState.Unknown) continue;
    const x = i % engine.cols;
    const y = Math.floor(i / engine.cols);
    setCell(
      engine,
      i,
      solution.blacks.has((y << 16) | x) ? CellState.Black : CellState.Line
    );
  }
  if (engine.contradiction) {
    return { solutions: [], nodes: 0, aborted: false };
  }
  return searchEngine(engine, { limit, maxNodes });
};

/**
 * A random valid solution, or undefined when the board admits none.
 *
 * A single search with no restarts. Restarting here was measured and reverted: inside the
 * generator's inner loop it turned a 20-puzzle 10x10 run from 25s/17 successes into
 * 38s/16, because every failure then cost eight times as much. Restarts are worth it only
 * for the very first draw on an empty board — see `findInitialSolution`.
 */
export const findRandomSolution = (
  board: Board,
  rng: Rng,
  maxNodes = 0,
  blackBias = 500
): Solution | undefined => {
  return search(board, { limit: 1, maxNodes, blackBias }, rng).solutions[0];
};

/** Restarts for the first draw on an empty board, and for the redraws after it. */
export const INITIAL_RESTARTS = 8;
export const REDRAW_RESTARTS = 3;

/**
 * A random answer, restarting only when the previous attempt ran out of node budget.
 *
 * The distinction matters: a search that *finished* without a solution has proved the
 * board unsolvable and restarting would be pure waste, whereas one that was cut off has
 * proved nothing. Randomised depth-first search here is heavy-tailed — most attempts
 * finish in milliseconds and the occasional one wanders into a barren region — so on the
 * cut-off case starting over is much cheaper than raising the budget.
 *
 * The empty board is the hard case and gets the most restarts; redraws after a clue has
 * been planted start from a far more constrained board and need fewer.
 */
export const drawSolution = (
  board: Board,
  rng: Rng,
  maxNodes = 0,
  blackBias = 500,
  restarts = REDRAW_RESTARTS
): Solution | undefined => {
  if (maxNodes <= 0) {
    return findRandomSolution(board, rng, maxNodes, blackBias);
  }
  for (let restart = 0; restart < restarts; restart++) {
    const result = search(board, { limit: 1, maxNodes, blackBias }, rng);
    if (result.solutions.length > 0) {
      return result.solutions[0];
    }
    if (!result.aborted) {
      return undefined;
    }
  }
  return undefined;
};

export const findInitialSolution = (
  board: Board,
  rng: Rng,
  maxNodes = 0,
  blackBias = 500
): Solution | undefined =>
  drawSolution(board, rng, maxNodes, blackBias, INITIAL_RESTARTS);
