/**
 * Tests for Cave plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createCaveState,
  solveCave,
  createCaveRunner,
  cloneState,
} from '../examples/cave-plugin.js';

describe('Cave Plugin Solver', () => {
  describe('createCaveState', () => {
    it('should create initial state with numbers', () => {
      const numbers = [
        { row: 1, col: 1, value: 5 },
      ];
      const state = createCaveState(3, 3, numbers);

      expect(state.height).toBe(3);
      expect(state.width).toBe(3);
      expect(state.numbers.get(1, 1)).toBe(5);
      expect(state.cells.get(1, 1)).toBe(CellState.WHITE);
    });

    it('should initialize non-number cells as unknown', () => {
      const state = createCaveState(2, 2, []);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.cells.get(row, col)).toBe(CellState.UNKNOWN);
        }
      }
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect number on wall cell', () => {
      const state = createCaveState(2, 2, [{ row: 0, col: 0, value: 2 }]);

      // Force number cell to wall
      state.cells.set(0, 0, CellState.BLACK);

      const runner = createCaveRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect visibility contradiction', () => {
      // Number 10 in 3x3 - max visibility is 5
      const state = createCaveState(3, 3, [{ row: 1, col: 1, value: 10 }]);

      const runner = createCaveRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createCaveState(3, 3, [{ row: 1, col: 1, value: 5 }]);

      const runner = createCaveRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveCave', () => {
    it('should solve all-cave puzzle', () => {
      // Number equals full grid visibility - no walls
      const state = createCaveState(1, 3, [{ row: 0, col: 1, value: 3 }]);
      const solution = solveCave(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createCaveRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should verify cave connectivity', () => {
      const state = createCaveState(3, 3, []);

      // All cave
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          state.cells.set(r, c, CellState.WHITE);
        }
      }

      const runner = createCaveRunner();
      expect(runner.checkAll(state)).toBe(true);
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createCaveState(2, 2, []);
      const clone = cloneState(state);

      clone.cells.set(0, 0, CellState.BLACK);

      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(clone.cells.get(0, 0)).toBe(CellState.BLACK);
    });
  });
});
