/**
 * Sudoku Solver using Plugin Architecture
 *
 * Demonstrates how to use Latin Square constraint patterns.
 * Uses:
 * - Row uniqueness constraints
 * - Column uniqueness constraints
 * - Box uniqueness constraints
 */

import { Position } from '../core/types.js';
import { Grid, CandidateSet, PropagationResult } from '../core/field.js';
import { ConstraintRunner } from '../core/constraint-runner.js';
import { Constraint } from '../core/registry.js';

// ============================================
// Sudoku State
// ============================================

export interface SudokuState {
  size: number;
  boxHeight: number;
  boxWidth: number;
  candidates: Grid<CandidateSet<number>>;
}

// ============================================
// Helper functions
// ============================================

function getValue(state: SudokuState, row: number, col: number): number | null {
  const cand = state.candidates.get(row, col);
  return cand.isDetermined() ? cand.getValue() : null;
}

function getBoxStart(state: SudokuState, row: number, col: number): { boxRow: number; boxCol: number } {
  const boxRow = Math.floor(row / state.boxHeight) * state.boxHeight;
  const boxCol = Math.floor(col / state.boxWidth) * state.boxWidth;
  return { boxRow, boxCol };
}

// ============================================
// Sudoku Constraints using Plugins
// ============================================

/**
 * Constraint: No duplicate values in any row
 */
export class RowUniquenessConstraint implements Constraint<SudokuState> {
  readonly type = 'row-uniqueness';
  readonly name = 'Row Uniqueness';

  propagate(state: SudokuState): PropagationResult {
    for (let row = 0; row < state.size; row++) {
      const seen = new Set<number>();

      for (let col = 0; col < state.size; col++) {
        const value = getValue(state, row, col);
        if (value !== null) {
          if (seen.has(value)) {
            return PropagationResult.CONTRADICTION;
          }
          seen.add(value);
        }
      }

      // Check if any number has no valid placement
      for (let num = 1; num <= state.size; num++) {
        if (seen.has(num)) continue;

        let canPlace = false;
        for (let col = 0; col < state.size; col++) {
          if (state.candidates.get(row, col).has(num)) {
            canPlace = true;
            break;
          }
        }
        if (!canPlace) {
          return PropagationResult.CONTRADICTION;
        }
      }
    }
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: SudokuState): boolean {
    for (let row = 0; row < state.size; row++) {
      const seen = new Set<number>();
      for (let col = 0; col < state.size; col++) {
        const value = getValue(state, row, col);
        if (value === null) return false;
        if (seen.has(value)) return false;
        seen.add(value);
      }
    }
    return true;
  }
}

/**
 * Constraint: No duplicate values in any column
 */
export class ColumnUniquenessConstraint implements Constraint<SudokuState> {
  readonly type = 'column-uniqueness';
  readonly name = 'Column Uniqueness';

  propagate(state: SudokuState): PropagationResult {
    for (let col = 0; col < state.size; col++) {
      const seen = new Set<number>();

      for (let row = 0; row < state.size; row++) {
        const value = getValue(state, row, col);
        if (value !== null) {
          if (seen.has(value)) {
            return PropagationResult.CONTRADICTION;
          }
          seen.add(value);
        }
      }

      // Check if any number has no valid placement
      for (let num = 1; num <= state.size; num++) {
        if (seen.has(num)) continue;

        let canPlace = false;
        for (let row = 0; row < state.size; row++) {
          if (state.candidates.get(row, col).has(num)) {
            canPlace = true;
            break;
          }
        }
        if (!canPlace) {
          return PropagationResult.CONTRADICTION;
        }
      }
    }
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: SudokuState): boolean {
    for (let col = 0; col < state.size; col++) {
      const seen = new Set<number>();
      for (let row = 0; row < state.size; row++) {
        const value = getValue(state, row, col);
        if (value === null) return false;
        if (seen.has(value)) return false;
        seen.add(value);
      }
    }
    return true;
  }
}

/**
 * Constraint: No duplicate values in any box
 */
export class BoxUniquenessConstraint implements Constraint<SudokuState> {
  readonly type = 'box-uniqueness';
  readonly name = 'Box Uniqueness';

  propagate(state: SudokuState): PropagationResult {
    for (let boxRow = 0; boxRow < state.size; boxRow += state.boxHeight) {
      for (let boxCol = 0; boxCol < state.size; boxCol += state.boxWidth) {
        const seen = new Set<number>();

        for (let r = boxRow; r < boxRow + state.boxHeight; r++) {
          for (let c = boxCol; c < boxCol + state.boxWidth; c++) {
            const value = getValue(state, r, c);
            if (value !== null) {
              if (seen.has(value)) {
                return PropagationResult.CONTRADICTION;
              }
              seen.add(value);
            }
          }
        }

        // Check if any number has no valid placement
        for (let num = 1; num <= state.size; num++) {
          if (seen.has(num)) continue;

          let canPlace = false;
          for (let r = boxRow; r < boxRow + state.boxHeight; r++) {
            for (let c = boxCol; c < boxCol + state.boxWidth; c++) {
              if (state.candidates.get(r, c).has(num)) {
                canPlace = true;
                break;
              }
            }
            if (canPlace) break;
          }
          if (!canPlace) {
            return PropagationResult.CONTRADICTION;
          }
        }
      }
    }
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: SudokuState): boolean {
    for (let boxRow = 0; boxRow < state.size; boxRow += state.boxHeight) {
      for (let boxCol = 0; boxCol < state.size; boxCol += state.boxWidth) {
        const seen = new Set<number>();
        for (let r = boxRow; r < boxRow + state.boxHeight; r++) {
          for (let c = boxCol; c < boxCol + state.boxWidth; c++) {
            const value = getValue(state, r, c);
            if (value === null) return false;
            if (seen.has(value)) return false;
            seen.add(value);
          }
        }
      }
    }
    return true;
  }
}

/**
 * Constraint: All cells must have at least one candidate
 */
export class ValidCandidatesConstraint implements Constraint<SudokuState> {
  readonly type = 'valid-candidates';
  readonly name = 'Valid Candidates';

  propagate(state: SudokuState): PropagationResult {
    for (let row = 0; row < state.size; row++) {
      for (let col = 0; col < state.size; col++) {
        if (state.candidates.get(row, col).isContradiction()) {
          return PropagationResult.CONTRADICTION;
        }
      }
    }
    return PropagationResult.NO_CHANGE;
  }

  isSatisfied(state: SudokuState): boolean {
    for (let row = 0; row < state.size; row++) {
      for (let col = 0; col < state.size; col++) {
        if (!state.candidates.get(row, col).isDetermined()) {
          return false;
        }
      }
    }
    return true;
  }
}

// ============================================
// Propagation helpers
// ============================================

/**
 * Naked single elimination: eliminate determined values from peers
 */
function nakedSingleElimination(state: SudokuState): boolean {
  let changed = false;

  for (let row = 0; row < state.size; row++) {
    for (let col = 0; col < state.size; col++) {
      const cand = state.candidates.get(row, col);
      if (!cand.isDetermined()) continue;

      const value = cand.getValue();

      // Eliminate from row
      for (let c = 0; c < state.size; c++) {
        if (c !== col && state.candidates.get(row, c).eliminate(value)) {
          changed = true;
        }
      }

      // Eliminate from column
      for (let r = 0; r < state.size; r++) {
        if (r !== row && state.candidates.get(r, col).eliminate(value)) {
          changed = true;
        }
      }

      // Eliminate from box
      const { boxRow, boxCol } = getBoxStart(state, row, col);
      for (let r = boxRow; r < boxRow + state.boxHeight; r++) {
        for (let c = boxCol; c < boxCol + state.boxWidth; c++) {
          if ((r !== row || c !== col) && state.candidates.get(r, c).eliminate(value)) {
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}

/**
 * Hidden single: if a number can only go in one place in a unit, place it
 */
function hiddenSingleElimination(state: SudokuState): boolean {
  let changed = false;

  // Check rows
  for (let row = 0; row < state.size; row++) {
    for (let num = 1; num <= state.size; num++) {
      const positions: number[] = [];
      for (let col = 0; col < state.size; col++) {
        if (state.candidates.get(row, col).has(num)) {
          positions.push(col);
        }
      }
      if (positions.length === 1) {
        const col = positions[0];
        if (!state.candidates.get(row, col).isDetermined()) {
          state.candidates.get(row, col).setTo(num);
          changed = true;
        }
      }
    }
  }

  // Check columns
  for (let col = 0; col < state.size; col++) {
    for (let num = 1; num <= state.size; num++) {
      const positions: number[] = [];
      for (let row = 0; row < state.size; row++) {
        if (state.candidates.get(row, col).has(num)) {
          positions.push(row);
        }
      }
      if (positions.length === 1) {
        const row = positions[0];
        if (!state.candidates.get(row, col).isDetermined()) {
          state.candidates.get(row, col).setTo(num);
          changed = true;
        }
      }
    }
  }

  // Check boxes
  for (let boxRow = 0; boxRow < state.size; boxRow += state.boxHeight) {
    for (let boxCol = 0; boxCol < state.size; boxCol += state.boxWidth) {
      for (let num = 1; num <= state.size; num++) {
        const positions: Position[] = [];
        for (let r = boxRow; r < boxRow + state.boxHeight; r++) {
          for (let c = boxCol; c < boxCol + state.boxWidth; c++) {
            if (state.candidates.get(r, c).has(num)) {
              positions.push({ row: r, col: c });
            }
          }
        }
        if (positions.length === 1) {
          const { row, col } = positions[0];
          if (!state.candidates.get(row, col).isDetermined()) {
            state.candidates.get(row, col).setTo(num);
            changed = true;
          }
        }
      }
    }
  }

  return changed;
}

// ============================================
// Solver
// ============================================

export function createSudokuRunner(): ConstraintRunner<SudokuState> {
  const runner = new ConstraintRunner<SudokuState>();

  runner.addConstraints([
    new RowUniquenessConstraint(),
    new ColumnUniquenessConstraint(),
    new BoxUniquenessConstraint(),
    new ValidCandidatesConstraint(),
  ]);

  return runner;
}

/**
 * Check if state is fully determined
 */
export function isComplete(state: SudokuState): boolean {
  for (let row = 0; row < state.size; row++) {
    for (let col = 0; col < state.size; col++) {
      if (!state.candidates.get(row, col).isDetermined()) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Clone state
 */
export function cloneState(state: SudokuState): SudokuState {
  const candidatesCopy = new Grid<CandidateSet<number>>(
    state.size, state.size,
    () => new CandidateSet<number>([])
  );

  for (let row = 0; row < state.size; row++) {
    for (let col = 0; col < state.size; col++) {
      candidatesCopy.set(row, col, state.candidates.get(row, col).clone());
    }
  }

  return {
    size: state.size,
    boxHeight: state.boxHeight,
    boxWidth: state.boxWidth,
    candidates: candidatesCopy,
  };
}

/**
 * Get cell with fewest candidates for branching
 */
function getBestBranchCell(state: SudokuState): { pos: Position; candidates: number[] } | null {
  let best: { pos: Position; candidates: number[] } | null = null;

  for (let row = 0; row < state.size; row++) {
    for (let col = 0; col < state.size; col++) {
      const cand = state.candidates.get(row, col);
      if (cand.isDetermined()) continue;

      const all = cand.getAll();
      if (!best || all.length < best.candidates.length) {
        best = { pos: { row, col }, candidates: all };
      }
    }
  }

  return best;
}

/**
 * Simple solver using plugin constraints
 */
export function solveSudoku(state: SudokuState): SudokuState | null {
  const runner = createSudokuRunner();

  // Propagate candidates
  let changed = true;
  while (changed) {
    changed = nakedSingleElimination(state) || hiddenSingleElimination(state);

    const { result } = runner.run(state);
    if (result === PropagationResult.CONTRADICTION) {
      return null;
    }
  }

  // Check if solved
  if (isComplete(state) && runner.checkAll(state)) {
    return state;
  }

  // Branch on cell with fewest candidates
  const branch = getBestBranchCell(state);
  if (!branch) {
    return runner.checkAll(state) ? state : null;
  }

  for (const value of branch.candidates) {
    const newState = cloneState(state);
    newState.candidates.get(branch.pos).setTo(value);

    const result = solveSudoku(newState);
    if (result) return result;
  }

  return null;
}

/**
 * Create initial state from puzzle string
 */
export function createSudokuState(
  size: number,
  puzzle: string,
  boxHeight?: number,
  boxWidth?: number
): SudokuState {
  // Default box sizes
  let bh = boxHeight;
  let bw = boxWidth;
  if (!bh || !bw) {
    if (size === 4) { bh = 2; bw = 2; }
    else if (size === 6) { bh = 2; bw = 3; }
    else if (size === 9) { bh = 3; bw = 3; }
    else if (size === 16) { bh = 4; bw = 4; }
    else {
      bh = Math.floor(Math.sqrt(size));
      bw = Math.ceil(size / bh);
    }
  }

  const allCandidates = Array.from({ length: size }, (_, i) => i + 1);
  const candidates = new Grid<CandidateSet<number>>(
    size, size,
    () => new CandidateSet(allCandidates)
  );

  for (let i = 0; i < puzzle.length && i < size * size; i++) {
    const ch = puzzle[i];
    const row = Math.floor(i / size);
    const col = i % size;

    let num = 0;
    if (ch >= '1' && ch <= '9') {
      num = parseInt(ch);
    } else if (ch >= 'a' && ch <= 'g') {
      num = ch.charCodeAt(0) - 'a'.charCodeAt(0) + 10;
    } else if (ch >= 'A' && ch <= 'G') {
      num = ch.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
    }

    if (num > 0 && num <= size) {
      candidates.get(row, col).setTo(num);
    }
  }

  return { size, boxHeight: bh!, boxWidth: bw!, candidates };
}

/**
 * Create state from string array
 */
export function createSudokuStateFromArray(puzzle: string[]): SudokuState {
  const size = puzzle.length;
  return createSudokuState(size, puzzle.join(''));
}
