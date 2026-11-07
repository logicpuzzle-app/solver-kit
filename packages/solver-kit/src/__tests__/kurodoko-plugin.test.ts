/**
 * Tests for Kurodoko plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createKurodokoState,
  solveKurodoko,
  createKurodokoRunner,
  cloneState,
} from '../examples/kurodoko-plugin.js';

describe('Kurodoko Plugin Solver', () => {
  describe('createKurodokoState', () => {
    it('should create initial state with numbers', () => {
      const numbers = [
        { row: 0, col: 0, value: 3 },
        { row: 1, col: 1, value: 2 },
      ];
      const state = createKurodokoState(3, 3, numbers);

      expect(state.height).toBe(3);
      expect(state.width).toBe(3);
      expect(state.numbers.get(0, 0)).toBe(3);
      expect(state.numbers.get(1, 1)).toBe(2);

      // Number cells are white
      expect(state.cells.get(0, 0)).toBe(CellState.WHITE);
      expect(state.cells.get(1, 1)).toBe(CellState.WHITE);
    });

    it('should initialize non-number cells as unknown', () => {
      const state = createKurodokoState(2, 2, []);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.cells.get(row, col)).toBe(CellState.UNKNOWN);
          expect(state.numbers.get(row, col)).toBeNull();
        }
      }
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect adjacent black cells', () => {
      const state = createKurodokoState(2, 2, []);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);

      const runner = createKurodokoRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect black on number cell', () => {
      const state = createKurodokoState(2, 2, [{ row: 0, col: 0, value: 2 }]);

      // Force number cell to black
      state.cells.set(0, 0, CellState.BLACK);

      const runner = createKurodokoRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect visibility constraint violation', () => {
      // Number 5 in corner of 2x2 - can only see max 3 cells
      const state = createKurodokoState(2, 2, [{ row: 0, col: 0, value: 5 }]);

      const runner = createKurodokoRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createKurodokoState(3, 3, [{ row: 1, col: 1, value: 5 }]);

      const runner = createKurodokoRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveKurodoko', () => {
    it('should solve a 1x3 puzzle', () => {
      // 3 = sees all 3 cells
      const state = createKurodokoState(1, 3, [{ row: 0, col: 1, value: 3 }]);
      const solution = solveKurodoko(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createKurodokoRunner();
        expect(runner.checkAll(solution)).toBe(true);
        // All cells should be white
        expect(solution.cells.get(0, 0)).toBe(CellState.WHITE);
        expect(solution.cells.get(0, 2)).toBe(CellState.WHITE);
      }
    });

    it('should solve a puzzle requiring black cells', () => {
      // 1 in corner = only sees itself, neighbors must be black
      // But black cells can't be adjacent, so this requires careful placement
      // Use 2 in a 1x3: sees 2 cells, so one neighbor must be black
      const state = createKurodokoState(1, 3, [{ row: 0, col: 0, value: 2 }]);
      const solution = solveKurodoko(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createKurodokoRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createKurodokoState(2, 2, []);
      const clone = cloneState(state);

      clone.cells.set(0, 0, CellState.BLACK);

      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(clone.cells.get(0, 0)).toBe(CellState.BLACK);
    });
  });
});
