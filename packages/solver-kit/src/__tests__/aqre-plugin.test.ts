/**
 * Tests for Aqre plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createAqreState,
  solveAqre,
  createAqreRunner,
  cloneState,
} from '../examples/aqre-plugin.js';

describe('Aqre Plugin Solver', () => {
  describe('createAqreState', () => {
    it('should create initial state with regions and numbers', () => {
      const regions = [
        [0, 0, 1, 1],
        [0, 0, 1, 1],
      ];
      const numbers = [{ row: 0, col: 0, value: 2 }];
      const state = createAqreState(2, 4, regions, numbers);

      expect(state.height).toBe(2);
      expect(state.width).toBe(4);
      expect(state.regionCount).toBe(2);
      expect(state.numbers.get(0, 0)).toBe(2);
    });

    it('should initialize all cells as unknown', () => {
      const state = createAqreState(2, 2, [[0, 0], [0, 0]], []);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.cells.get(row, col)).toBe(CellState.UNKNOWN);
        }
      }
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect too many shaded in region', () => {
      const regions = [[0, 0]];
      const state = createAqreState(1, 2, regions, [{ row: 0, col: 0, value: 1 }]);

      // Both cells shaded but only 1 allowed
      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);

      const runner = createAqreRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect 4 consecutive shaded in row', () => {
      const regions = [[0, 0, 0, 0]];
      const state = createAqreState(1, 4, regions, []);

      // 4 consecutive shaded
      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(0, 2, CellState.BLACK);
      state.cells.set(0, 3, CellState.BLACK);

      const runner = createAqreRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect 4 consecutive shaded in column', () => {
      const regions = [[0], [0], [0], [0]];
      const state = createAqreState(4, 1, regions, []);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(1, 0, CellState.BLACK);
      state.cells.set(2, 0, CellState.BLACK);
      state.cells.set(3, 0, CellState.BLACK);

      const runner = createAqreRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow 3 consecutive shaded', () => {
      const regions = [[0, 0, 0]];
      const state = createAqreState(1, 3, regions, [{ row: 0, col: 0, value: 3 }]);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(0, 2, CellState.BLACK);

      const runner = createAqreRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveAqre', () => {
    it('should solve a simple puzzle', () => {
      // Single region with 2 shaded cells
      const regions = [[0, 0], [0, 0]];
      const state = createAqreState(2, 2, regions, [{ row: 0, col: 0, value: 2 }]);
      const solution = solveAqre(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createAqreRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createAqreState(2, 2, [[0, 0], [0, 0]], []);
      const clone = cloneState(state);

      clone.cells.set(0, 0, CellState.BLACK);

      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(clone.cells.get(0, 0)).toBe(CellState.BLACK);
    });
  });
});
