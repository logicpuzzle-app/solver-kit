/**
 * Tests for Hitori plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createHitoriState,
  solveHitori,
  createHitoriRunner,
  cloneState,
} from '../examples/hitori-plugin.js';

describe('Hitori Plugin Solver', () => {
  describe('createHitoriState', () => {
    it('should create initial state with numbers', () => {
      const numbers = [
        [1, 2, 3],
        [2, 1, 1],
        [3, 3, 2],
      ];
      const state = createHitoriState(3, 3, numbers);

      expect(state.height).toBe(3);
      expect(state.width).toBe(3);
      expect(state.numbers.get(0, 0)).toBe(1);
      expect(state.numbers.get(1, 2)).toBe(1);
    });

    it('should initialize all cells as unknown', () => {
      const state = createHitoriState(2, 2, [[1, 2], [3, 4]]);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.cells.get(row, col)).toBe(CellState.UNKNOWN);
        }
      }
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect duplicate numbers in row', () => {
      const state = createHitoriState(1, 3, [[1, 1, 2]]);

      // Both 1s are white - contradiction
      state.cells.set(0, 0, CellState.WHITE);
      state.cells.set(0, 1, CellState.WHITE);
      state.cells.set(0, 2, CellState.WHITE);

      const runner = createHitoriRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect duplicate numbers in column', () => {
      const state = createHitoriState(3, 1, [[1], [1], [2]]);

      state.cells.set(0, 0, CellState.WHITE);
      state.cells.set(1, 0, CellState.WHITE);
      state.cells.set(2, 0, CellState.WHITE);

      const runner = createHitoriRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect adjacent black cells', () => {
      const state = createHitoriState(2, 2, [[1, 2], [3, 4]]);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);

      const runner = createHitoriRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createHitoriState(2, 2, [[1, 2], [3, 4]]);

      const runner = createHitoriRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveHitori', () => {
    it('should solve a puzzle with no duplicates', () => {
      // All unique - all white
      const state = createHitoriState(2, 2, [[1, 2], [3, 4]]);
      const solution = solveHitori(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createHitoriRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should solve a simple puzzle with duplicates', () => {
      // 1 1 2 - one 1 must be black
      // 3 2 1
      const state = createHitoriState(2, 3, [
        [1, 1, 2],
        [3, 2, 1],
      ]);
      const solution = solveHitori(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createHitoriRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createHitoriState(2, 2, [[1, 2], [3, 4]]);
      const clone = cloneState(state);

      clone.cells.set(0, 0, CellState.BLACK);

      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(clone.cells.get(0, 0)).toBe(CellState.BLACK);
    });
  });
});
