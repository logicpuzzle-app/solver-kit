/**
 * Minesweeper Solver using Plugin Architecture
 *
 * Demonstrates how to use neighbor counting constraints.
 * Rules:
 * - Place mines in some cells
 * - Numbers show how many mines are in the 8 adjacent cells
 * - Number cells cannot contain mines
 */

import {
  CellState,
  Position,
} from '../core/types.js';
import { Grid, PropagationResult } from '../core/field.js';
import { ConstraintRunner } from '../core/constraint-runner.js';
import { Constraint } from '../core/registry.js';

// ============================================
// Minesweeper State
// ============================================

export interface MinesweeperState {
  height: number;
  width: number;
  cells: Grid<CellState>;  // BLACK = mine, WHITE = safe
  numbers: Grid<number | null>;
}

// ============================================
// Helper functions
// ============================================

/**
 * Get 8 neighbors
 */
function getNeighbors8(state: MinesweeperState, row: number, col: number): Position[] {
  const neighbors: Position[] = [];
  const offsets = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1],
  ];

  for (const [dr, dc] of offsets) {
    const r = row + dr;
    const c = col + dc;
    if (r >= 0 && r < state.height && c >= 0 && c < state.width) {
      neighbors.push({ row: r, col: c });
    }
  }

  return neighbors;
}

/**
 * Count mines around a cell
 */
function countMines(state: MinesweeperState, row: number, col: number): { mines: number; unknown: number } {
  const neighbors = getNeighbors8(state, row, col);
  let mines = 0;
  let unknown = 0;

  for (const pos of neighbors) {
    const cell = state.cells.get(pos);
    if (cell === CellState.BLACK) mines++;
    else if (cell === CellState.UNKNOWN) unknown++;
  }

  return { mines, unknown };
}

// ============================================
// Minesweeper Constraints
// ============================================

/**
 * Constraint: Number cells show adjacent mine count
 */
export class MineCountConstraint implements Constraint<MinesweeperState> {
  readonly type = 'mine-count';
  readonly name = 'Mine Count';

  propagate(state: MinesweeperState): PropagationResult {
    for (let row = 0; row < state.height; row++) {
      for (let col = 0; col < state.width; col++) {
        const num = state.numbers.get(row, col);
        if (num === null) continue;

        const { mines, unknown } = countMines(state, row, col);

        // Too many mines
        if (mines > num) return PropagationResult.CONTRADICTION;

        // Can't reach required mines
        if (mines + unknown < num) return PropagationResult.CONTRADICTION;
      }
    }
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: MinesweeperState): boolean {
    for (let row = 0; row < state.height; row++) {
      for (let col = 0; col < state.width; col++) {
        const num = state.numbers.get(row, col);
        if (num === null) continue;

        const { mines, unknown } = countMines(state, row, col);
        if (mines !== num || unknown !== 0) return false;
      }
    }
    return true;
  }
}

/**
 * Constraint: Number cells cannot be mines
 */
export class NumberSafeConstraint implements Constraint<MinesweeperState> {
  readonly type = 'number-safe';
  readonly name = 'Number Safe';

  propagate(state: MinesweeperState): PropagationResult {
    for (let row = 0; row < state.height; row++) {
      for (let col = 0; col < state.width; col++) {
        if (state.numbers.get(row, col) !== null &&
            state.cells.get(row, col) === CellState.BLACK) {
          return PropagationResult.CONTRADICTION;
        }
      }
    }
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: MinesweeperState): boolean {
    return this.propagate(state) !== PropagationResult.CONTRADICTION;
  }
}

// ============================================
// Solver
// ============================================

export function createMinesweeperRunner(): ConstraintRunner<MinesweeperState> {
  const runner = new ConstraintRunner<MinesweeperState>();

  runner.addConstraints([
    new MineCountConstraint(),
    new NumberSafeConstraint(),
  ]);

  return runner;
}

/**
 * Check if state has unknown cells
 */
export function hasUnknownCells(state: MinesweeperState): boolean {
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
export function getUnknownCells(state: MinesweeperState): Position[] {
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
export function cloneState(state: MinesweeperState): MinesweeperState {
  return {
    height: state.height,
    width: state.width,
    cells: state.cells.clone(),
    numbers: state.numbers.clone(),
  };
}

/**
 * Simple solver using plugin constraints
 */
export function solveMinesweeper(state: MinesweeperState): MinesweeperState | null {
  const runner = createMinesweeperRunner();

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

  // Try SAFE first (more common)
  const safeState = cloneState(state);
  safeState.cells.set(pos, CellState.WHITE);
  const safeResult = solveMinesweeper(safeState);
  if (safeResult) return safeResult;

  // Try MINE
  const mineState = cloneState(state);
  mineState.cells.set(pos, CellState.BLACK);
  const mineResult = solveMinesweeper(mineState);
  if (mineResult) return mineResult;

  return null;
}

/**
 * Create initial state from puzzle
 */
export function createMinesweeperState(
  height: number,
  width: number,
  numbers: Array<{ row: number; col: number; value: number }>
): MinesweeperState {
  const cells = new Grid<CellState>(height, width, () => CellState.UNKNOWN);
  const numGrid = new Grid<number | null>(height, width, () => null);

  for (const num of numbers) {
    numGrid.set(num.row, num.col, num.value);
    cells.set(num.row, num.col, CellState.WHITE);
  }

  return { height, width, cells, numbers: numGrid };
}
