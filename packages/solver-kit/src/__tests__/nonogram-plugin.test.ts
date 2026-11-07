/**
 * Tests for Nonogram plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createNonogramState,
  solveNonogram,
  createNonogramRunner,
  cloneState,
} from '../examples/nonogram-plugin.js';

describe('Nonogram Plugin Solver', () => {
  describe('createNonogramState', () => {
    it('should create initial state with clues', () => {
      const rowClues = [[1], [2]];
      const colClues = [[1], [1, 1]];
      const state = createNonogramState(2, 2, rowClues, colClues);

      expect(state.height).toBe(2);
      expect(state.width).toBe(2);
      expect(state.rowClues).toEqual([[1], [2]]);
      expect(state.colClues).toEqual([[1], [1, 1]]);
    });

    it('should initialize all cells as unknown', () => {
      const state = createNonogramState(2, 2, [[1], [1]], [[1], [1]]);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.cells.get(row, col)).toBe(CellState.UNKNOWN);
        }
      }
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect row clue violation', () => {
      // Row clue [2] but 3 consecutive blacks
      const state = createNonogramState(1, 3, [[2]], [[1], [1], [1]]);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(0, 2, CellState.BLACK);

      const runner = createNonogramRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect column clue violation', () => {
      // Column clue [1] but 2 consecutive blacks
      const state = createNonogramState(2, 1, [[1], [1]], [[1]]);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(1, 0, CellState.BLACK);

      const runner = createNonogramRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createNonogramState(2, 2, [[1], [1]], [[1], [1]]);

      const runner = createNonogramRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveNonogram', () => {
    it('should solve a 2x2 puzzle', () => {
      // Simple 2x2:
      // Row clues: [1], [1]
      // Col clues: [1], [1]
      // Solution: diagonal
      const state = createNonogramState(2, 2, [[1], [1]], [[1], [1]]);
      const solution = solveNonogram(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createNonogramRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should solve a 3x3 puzzle', () => {
      // 3x3 with full row in middle:
      // Row clues: [1], [3], [1]
      // Col clues: [1], [3], [1]
      const state = createNonogramState(3, 3, [[1], [3], [1]], [[1], [3], [1]]);
      const solution = solveNonogram(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createNonogramRunner();
        expect(runner.checkAll(solution)).toBe(true);
        // Middle row should be all black
        expect(solution.cells.get(1, 0)).toBe(CellState.BLACK);
        expect(solution.cells.get(1, 1)).toBe(CellState.BLACK);
        expect(solution.cells.get(1, 2)).toBe(CellState.BLACK);
      }
    });

    it('should verify full row solution', () => {
      // Full row = all black (clue [3])
      const state = createNonogramState(1, 3, [[3]], [[1], [1], [1]]);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(0, 2, CellState.BLACK);

      const runner = createNonogramRunner();
      expect(runner.checkAll(state)).toBe(true);
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createNonogramState(2, 2, [[1], [1]], [[1], [1]]);
      const clone = cloneState(state);

      clone.cells.set(0, 0, CellState.BLACK);

      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(clone.cells.get(0, 0)).toBe(CellState.BLACK);
    });
  });
});
