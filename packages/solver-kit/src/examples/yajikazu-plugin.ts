/**
 * Yajisan-Kazusan Solver using Plugin Architecture
 *
 * Demonstrates how to use arrow clue and shading constraints.
 * Rules:
 * - Shade some cells
 * - White arrow clues are true: they show the count of shaded cells in that direction
 * - Shaded arrow clues may be false (ignored)
 * - No adjacent shaded cells
 * - White cells must be connected
 */

import {
  CellState,
  Position,
  Direction,
  DIRECTIONS,
  adjacent,
} from '../core/types.js';
import { Grid, PropagationResult } from '../core/field.js';
import { ConstraintRunner } from '../core/constraint-runner.js';
import { Constraint } from '../core/registry.js';
import { isConnected } from '../constraints/plugins/component.js';

// ============================================
// Yajisan-Kazusan State
// ============================================

export interface YajikazuClue {
  direction: Direction;
  count: number;
}

export interface YajikazuState {
  height: number;
  width: number;
  cells: Grid<CellState>;
  clues: Grid<YajikazuClue | null>;
}

// ============================================
// Helper functions
// ============================================

/**
 * Count shaded cells in a direction from a position
 */
function countShadedInDirection(
  state: YajikazuState,
  row: number,
  col: number,
  dir: Direction
): { current: number; possible: number } {
  let current = 0;
  let possible = 0;

  let r = row;
  let c = col;

  const move = () => {
    switch (dir) {
      case Direction.UP: r--; break;
      case Direction.DOWN: r++; break;
      case Direction.LEFT: c--; break;
      case Direction.RIGHT: c++; break;
    }
  };

  move();
  while (r >= 0 && r < state.height && c >= 0 && c < state.width) {
    const cell = state.cells.get(r, c);
    if (cell === CellState.BLACK) {
      current++;
      possible++;
    } else if (cell === CellState.UNKNOWN) {
      possible++;
    }
    move();
  }

  return { current, possible };
}

// ============================================
// Yajisan-Kazusan Constraints
// ============================================

/**
 * Constraint: White clue cells must be correct
 */
export class WhiteClueConstraint implements Constraint<YajikazuState> {
  readonly type = 'white-clue';
  readonly name = 'White Clue';

  propagate(state: YajikazuState): PropagationResult {
    for (let row = 0; row < state.height; row++) {
      for (let col = 0; col < state.width; col++) {
        const clue = state.clues.get(row, col);
        if (!clue) continue;

        // Only check white clue cells
        if (state.cells.get(row, col) !== CellState.WHITE) continue;

        const { current, possible } = countShadedInDirection(state, row, col, clue.direction);

        // Too many shaded
        if (current > clue.count) return PropagationResult.CONTRADICTION;

        // Can't reach required count
        if (possible < clue.count) return PropagationResult.CONTRADICTION;
      }
    }
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: YajikazuState): boolean {
    for (let row = 0; row < state.height; row++) {
      for (let col = 0; col < state.width; col++) {
        const clue = state.clues.get(row, col);
        if (!clue) continue;

        // Only check white clue cells
        if (state.cells.get(row, col) !== CellState.WHITE) continue;

        const { current, possible } = countShadedInDirection(state, row, col, clue.direction);
        if (current !== clue.count || possible !== clue.count) return false;
      }
    }
    return true;
  }
}

/**
 * Constraint: No adjacent shaded cells
 */
export class NoAdjacentShadedConstraint implements Constraint<YajikazuState> {
  readonly type = 'no-adjacent-shaded';
  readonly name = 'No Adjacent Shaded';

  propagate(state: YajikazuState): PropagationResult {
    for (let row = 0; row < state.height; row++) {
      for (let col = 0; col < state.width; col++) {
        if (state.cells.get(row, col) !== CellState.BLACK) continue;

        for (const dir of DIRECTIONS) {
          const adj = adjacent({ row, col }, dir);
          if (state.cells.inBounds(adj) && state.cells.get(adj) === CellState.BLACK) {
            return PropagationResult.CONTRADICTION;
          }
        }
      }
    }
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: YajikazuState): boolean {
    return this.propagate(state) !== PropagationResult.CONTRADICTION;
  }
}

/**
 * Constraint: White cells must be connected
 */
export class WhiteConnectedConstraint implements Constraint<YajikazuState> {
  readonly type = 'white-connected';
  readonly name = 'White Connected';

  propagate(_state: YajikazuState): PropagationResult {
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: YajikazuState): boolean {
    const whiteGrid = new Grid<boolean>(state.height, state.width, () => false);
    let hasAny = false;

    for (let row = 0; row < state.height; row++) {
      for (let col = 0; col < state.width; col++) {
        if (state.cells.get(row, col) !== CellState.BLACK) {
          whiteGrid.set(row, col, true);
          hasAny = true;
        }
      }
    }

    if (!hasAny) return true;

    return isConnected(whiteGrid, v => v === true, false);
  }
}

// ============================================
// Solver
// ============================================

export function createYajikazuRunner(): ConstraintRunner<YajikazuState> {
  const runner = new ConstraintRunner<YajikazuState>();

  runner.addConstraints([
    new WhiteClueConstraint(),
    new NoAdjacentShadedConstraint(),
    new WhiteConnectedConstraint(),
  ]);

  return runner;
}

/**
 * Check if state has unknown cells
 */
export function hasUnknownCells(state: YajikazuState): boolean {
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
export function getUnknownCells(state: YajikazuState): Position[] {
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
export function cloneState(state: YajikazuState): YajikazuState {
  return {
    height: state.height,
    width: state.width,
    cells: state.cells.clone(),
    clues: state.clues.clone(),
  };
}

/**
 * Simple solver using plugin constraints
 */
export function solveYajikazu(state: YajikazuState): YajikazuState | null {
  const runner = createYajikazuRunner();

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

  // Try WHITE first
  const whiteState = cloneState(state);
  whiteState.cells.set(pos, CellState.WHITE);
  const whiteResult = solveYajikazu(whiteState);
  if (whiteResult) return whiteResult;

  // Try BLACK
  const blackState = cloneState(state);
  blackState.cells.set(pos, CellState.BLACK);
  const blackResult = solveYajikazu(blackState);
  if (blackResult) return blackResult;

  return null;
}

/**
 * Create initial state from puzzle
 */
export function createYajikazuState(
  height: number,
  width: number,
  clues: Array<{ row: number; col: number; direction: Direction; count: number }>
): YajikazuState {
  const cells = new Grid<CellState>(height, width, () => CellState.UNKNOWN);
  const clueGrid = new Grid<YajikazuClue | null>(height, width, () => null);

  for (const clue of clues) {
    clueGrid.set(clue.row, clue.col, { direction: clue.direction, count: clue.count });
  }

  return { height, width, cells, clues: clueGrid };
}
