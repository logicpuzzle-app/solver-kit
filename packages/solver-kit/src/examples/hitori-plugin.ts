/**
 * Hitori Solver using Plugin Architecture
 *
 * Demonstrates how to use number uniqueness and connectivity constraints.
 * Rules:
 * - Paint some cells black to eliminate duplicate numbers
 * - No duplicate numbers in any row or column (among white cells)
 * - Black cells cannot be adjacent
 * - White cells must be connected
 */

import {
  CellState,
  Position,
  DIRECTIONS,
  adjacent,
} from '../core/types.js';
import { Grid, PropagationResult } from '../core/field.js';
import { ConstraintRunner } from '../core/constraint-runner.js';
import { Constraint } from '../core/registry.js';
import { isConnected } from '../constraints/plugins/component.js';

// ============================================
// Hitori State
// ============================================

export interface HitoriState {
  height: number;
  width: number;
  numbers: Grid<number>;  // Original numbers (always present)
  cells: Grid<CellState>; // WHITE = visible, BLACK = eliminated
}

// ============================================
// Hitori Constraints
// ============================================

/**
 * Constraint: No duplicate numbers in rows/columns among white cells
 */
export class NoDuplicateConstraint implements Constraint<HitoriState> {
  readonly type = 'no-duplicate';
  readonly name = 'No Duplicate';

  propagate(state: HitoriState): PropagationResult {
    // Check rows
    for (let row = 0; row < state.height; row++) {
      const seen = new Map<number, number>(); // number -> count of white cells
      let unknownCount = 0;

      for (let col = 0; col < state.width; col++) {
        const cell = state.cells.get(row, col);
        const num = state.numbers.get(row, col);

        if (cell === CellState.WHITE) {
          seen.set(num, (seen.get(num) || 0) + 1);
          if (seen.get(num)! > 1) {
            return PropagationResult.CONTRADICTION;
          }
        } else if (cell === CellState.UNKNOWN) {
          unknownCount++;
        }
      }
    }

    // Check columns
    for (let col = 0; col < state.width; col++) {
      const seen = new Map<number, number>();

      for (let row = 0; row < state.height; row++) {
        const cell = state.cells.get(row, col);
        const num = state.numbers.get(row, col);

        if (cell === CellState.WHITE) {
          seen.set(num, (seen.get(num) || 0) + 1);
          if (seen.get(num)! > 1) {
            return PropagationResult.CONTRADICTION;
          }
        }
      }
    }

    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: HitoriState): boolean {
    // Check rows
    for (let row = 0; row < state.height; row++) {
      const seen = new Set<number>();
      for (let col = 0; col < state.width; col++) {
        if (state.cells.get(row, col) !== CellState.WHITE) continue;
        const num = state.numbers.get(row, col);
        if (seen.has(num)) return false;
        seen.add(num);
      }
    }

    // Check columns
    for (let col = 0; col < state.width; col++) {
      const seen = new Set<number>();
      for (let row = 0; row < state.height; row++) {
        if (state.cells.get(row, col) !== CellState.WHITE) continue;
        const num = state.numbers.get(row, col);
        if (seen.has(num)) return false;
        seen.add(num);
      }
    }

    return true;
  }
}

/**
 * Constraint: Black cells cannot be adjacent
 */
export class NoAdjacentBlackConstraint implements Constraint<HitoriState> {
  readonly type = 'no-adjacent-black';
  readonly name = 'No Adjacent Black';

  propagate(state: HitoriState): PropagationResult {
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

  isSatisfied(state: HitoriState): boolean {
    return this.propagate(state) !== PropagationResult.CONTRADICTION;
  }
}

/**
 * Constraint: White cells must be connected
 */
export class WhiteConnectedConstraint implements Constraint<HitoriState> {
  readonly type = 'white-connected';
  readonly name = 'White Connected';

  propagate(_state: HitoriState): PropagationResult {
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: HitoriState): boolean {
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

export function createHitoriRunner(): ConstraintRunner<HitoriState> {
  const runner = new ConstraintRunner<HitoriState>();

  runner.addConstraints([
    new NoDuplicateConstraint(),
    new NoAdjacentBlackConstraint(),
    new WhiteConnectedConstraint(),
  ]);

  return runner;
}

/**
 * Check if state has unknown cells
 */
export function hasUnknownCells(state: HitoriState): boolean {
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
 * Get unknown cells for branching - prioritize cells with duplicate numbers
 */
export function getUnknownCells(state: HitoriState): Position[] {
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
export function cloneState(state: HitoriState): HitoriState {
  return {
    height: state.height,
    width: state.width,
    numbers: state.numbers.clone(),
    cells: state.cells.clone(),
  };
}

/**
 * Simple solver using plugin constraints
 */
export function solveHitori(state: HitoriState): HitoriState | null {
  const runner = createHitoriRunner();

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
  const whiteResult = solveHitori(whiteState);
  if (whiteResult) return whiteResult;

  // Try BLACK
  const blackState = cloneState(state);
  blackState.cells.set(pos, CellState.BLACK);
  const blackResult = solveHitori(blackState);
  if (blackResult) return blackResult;

  return null;
}

/**
 * Create initial state from puzzle
 */
export function createHitoriState(
  height: number,
  width: number,
  numbers: number[][]
): HitoriState {
  const numGrid = new Grid<number>(height, width, (r, c) => numbers[r][c]);
  const cells = new Grid<CellState>(height, width, () => CellState.UNKNOWN);

  return { height, width, numbers: numGrid, cells };
}
