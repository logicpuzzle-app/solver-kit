/**
 * Nonogram (Picross) Solver using Plugin Architecture
 *
 * Demonstrates how to use line constraint patterns.
 * Rules:
 * - Fill cells according to row/column clues
 * - Each clue shows consecutive filled cell groups in order
 * - Groups must be separated by at least one empty cell
 */

import {
  CellState,
  Position,
} from '../core/types.js';
import { Grid, PropagationResult } from '../core/field.js';
import { ConstraintRunner } from '../core/constraint-runner.js';
import { Constraint } from '../core/registry.js';

// ============================================
// Nonogram State
// ============================================

export interface NonogramState {
  height: number;
  width: number;
  cells: Grid<CellState>;
  rowClues: number[][];  // Clues for each row
  colClues: number[][];  // Clues for each column
}

// ============================================
// Helper functions
// ============================================

/**
 * Check if a line matches the given clue
 */
function lineMatchesClue(line: CellState[], clue: number[]): boolean {
  const groups: number[] = [];
  let current = 0;

  for (const cell of line) {
    if (cell === CellState.BLACK) {
      current++;
    } else if (current > 0) {
      groups.push(current);
      current = 0;
    }
  }
  if (current > 0) groups.push(current);

  if (groups.length !== clue.length) return false;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] !== clue[i]) return false;
  }
  return true;
}

/**
 * Check if a partial line can still match the clue
 */
function lineCanMatch(line: CellState[], clue: number[]): boolean {
  // Count current groups (treating UNKNOWN as potential separator)
  const groups: { size: number; complete: boolean }[] = [];
  let current = 0;
  let hasUnknown = false;

  for (let i = 0; i < line.length; i++) {
    const cell = line[i];
    if (cell === CellState.BLACK) {
      current++;
    } else if (cell === CellState.WHITE) {
      if (current > 0) {
        groups.push({ size: current, complete: true });
        current = 0;
      }
    } else {
      hasUnknown = true;
      if (current > 0) {
        groups.push({ size: current, complete: false });
        current = 0;
      }
    }
  }
  if (current > 0) {
    groups.push({ size: current, complete: line[line.length - 1] !== CellState.UNKNOWN });
  }

  // If no unknowns, must match exactly
  if (!hasUnknown) {
    return lineMatchesClue(line, clue);
  }

  // Check basic constraints
  const totalBlack = line.filter(c => c === CellState.BLACK).length;
  const totalUnknown = line.filter(c => c === CellState.UNKNOWN).length;
  const neededBlack = clue.reduce((a, b) => a + b, 0);

  // Not enough cells for required black
  if (totalBlack + totalUnknown < neededBlack) return false;

  // Too many black already
  if (totalBlack > neededBlack) return false;

  // Check if complete groups match prefix of clue
  let clueIdx = 0;
  for (const group of groups) {
    if (group.complete) {
      if (clueIdx >= clue.length) return false;
      if (group.size !== clue[clueIdx]) return false;
      clueIdx++;
    } else {
      // Incomplete group - check it doesn't exceed current clue
      if (clueIdx < clue.length && group.size > clue[clueIdx]) return false;
    }
  }

  return true;
}

// ============================================
// Nonogram Constraints
// ============================================

/**
 * Constraint: Row must match its clue
 */
export class RowClueConstraint implements Constraint<NonogramState> {
  readonly type = 'row-clue';
  readonly name = 'Row Clue';

  propagate(state: NonogramState): PropagationResult {
    for (let row = 0; row < state.height; row++) {
      const line: CellState[] = [];
      for (let col = 0; col < state.width; col++) {
        line.push(state.cells.get(row, col));
      }

      if (!lineCanMatch(line, state.rowClues[row])) {
        return PropagationResult.CONTRADICTION;
      }
    }
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: NonogramState): boolean {
    for (let row = 0; row < state.height; row++) {
      const line: CellState[] = [];
      for (let col = 0; col < state.width; col++) {
        line.push(state.cells.get(row, col));
      }

      if (!lineMatchesClue(line, state.rowClues[row])) {
        return false;
      }
    }
    return true;
  }
}

/**
 * Constraint: Column must match its clue
 */
export class ColClueConstraint implements Constraint<NonogramState> {
  readonly type = 'col-clue';
  readonly name = 'Column Clue';

  propagate(state: NonogramState): PropagationResult {
    for (let col = 0; col < state.width; col++) {
      const line: CellState[] = [];
      for (let row = 0; row < state.height; row++) {
        line.push(state.cells.get(row, col));
      }

      if (!lineCanMatch(line, state.colClues[col])) {
        return PropagationResult.CONTRADICTION;
      }
    }
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: NonogramState): boolean {
    for (let col = 0; col < state.width; col++) {
      const line: CellState[] = [];
      for (let row = 0; row < state.height; row++) {
        line.push(state.cells.get(row, col));
      }

      if (!lineMatchesClue(line, state.colClues[col])) {
        return false;
      }
    }
    return true;
  }
}

// ============================================
// Solver
// ============================================

export function createNonogramRunner(): ConstraintRunner<NonogramState> {
  const runner = new ConstraintRunner<NonogramState>();

  runner.addConstraints([
    new RowClueConstraint(),
    new ColClueConstraint(),
  ]);

  return runner;
}

/**
 * Check if state has unknown cells
 */
export function hasUnknownCells(state: NonogramState): boolean {
  for (let row = 0; row < state.height; row++) {
    for (let col = 0; col < state.width; col++) {
      if (state.cells.get(row, col) === CellState.UNKNOWN) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Get unknown cells for branching
 */
export function getUnknownCells(state: NonogramState): Position[] {
  const unknowns: Position[] = [];

  for (let row = 0; row < state.height; row++) {
    for (let col = 0; col < state.width; col++) {
      if (state.cells.get(row, col) === CellState.UNKNOWN) {
        unknowns.push({ row, col });
      }
    }
  }

  return unknowns;
}

/**
 * Clone state
 */
export function cloneState(state: NonogramState): NonogramState {
  return {
    height: state.height,
    width: state.width,
    cells: state.cells.clone(),
    rowClues: state.rowClues.map(c => [...c]),
    colClues: state.colClues.map(c => [...c]),
  };
}

/**
 * Simple solver using plugin constraints
 */
export function solveNonogram(state: NonogramState): NonogramState | null {
  const runner = createNonogramRunner();

  // Run propagation
  const { result } = runner.run(state);
  if (result === PropagationResult.CONTRADICTION) {
    return null;
  }

  // Check if solved
  if (!hasUnknownCells(state) && runner.checkAll(state)) {
    return state;
  }

  // Branch on first unknown cell
  const unknowns = getUnknownCells(state);
  if (unknowns.length === 0) {
    return runner.checkAll(state) ? state : null;
  }

  const pos = unknowns[0];

  // Try BLACK first
  const blackState = cloneState(state);
  blackState.cells.set(pos, CellState.BLACK);
  const blackResult = solveNonogram(blackState);
  if (blackResult) return blackResult;

  // Try WHITE
  const whiteState = cloneState(state);
  whiteState.cells.set(pos, CellState.WHITE);
  const whiteResult = solveNonogram(whiteState);
  if (whiteResult) return whiteResult;

  return null;
}

/**
 * Create initial state from puzzle
 */
export function createNonogramState(
  height: number,
  width: number,
  rowClues: number[][],
  colClues: number[][]
): NonogramState {
  const cells = new Grid<CellState>(height, width, () => CellState.UNKNOWN);

  return { height, width, cells, rowClues, colClues };
}
