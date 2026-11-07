/**
 * Tests for LITS plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createLITSState,
  solveLITS,
  createLITSRunner,
  cloneState,
} from '../examples/lits-plugin.js';

describe('LITS Plugin Solver', () => {
  describe('createLITSState', () => {
    it('should create initial state with regions', () => {
      const regions = [
        [0, 0, 1, 1],
        [0, 0, 1, 1],
      ];
      const state = createLITSState(2, 4, regions);

      expect(state.height).toBe(2);
      expect(state.width).toBe(4);
      expect(state.regionCount).toBe(2);
      expect(state.regions.get(0, 0)).toBe(0);
      expect(state.regions.get(0, 2)).toBe(1);
    });

    it('should initialize all cells as unknown', () => {
      const state = createLITSState(2, 2, [[0, 0], [0, 0]]);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.cells.get(row, col)).toBe(CellState.UNKNOWN);
        }
      }
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect too many black cells in region', () => {
      // Region with 5 black cells (should be 4)
      const regions = [
        [0, 0, 0],
        [0, 0, 0],
      ];
      const state = createLITSState(2, 3, regions);

      // Set 5 cells to black
      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(0, 2, CellState.BLACK);
      state.cells.set(1, 0, CellState.BLACK);
      state.cells.set(1, 1, CellState.BLACK);

      const runner = createLITSRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect 2x2 black area', () => {
      const state = createLITSState(2, 2, [[0, 0], [0, 0]]);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(1, 0, CellState.BLACK);
      state.cells.set(1, 1, CellState.BLACK);

      const runner = createLITSRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const regions = [
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ];
      const state = createLITSState(2, 5, regions);

      const runner = createLITSRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveLITS', () => {
    it('should verify I-tetromino is valid', () => {
      // Single region with I-tetromino shape
      const regions = [
        [0, 0, 0, 0],
      ];
      const state = createLITSState(1, 4, regions);

      // Set I-tetromino
      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(0, 2, CellState.BLACK);
      state.cells.set(0, 3, CellState.BLACK);

      const runner = createLITSRunner();
      expect(runner.checkAll(state)).toBe(true);
    });

    it('should verify L-tetromino is valid', () => {
      // L-shape tetromino
      const regions = [
        [0, 0],
        [0, 0],
        [0, 0],
      ];
      const state = createLITSState(3, 2, regions);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(1, 0, CellState.BLACK);
      state.cells.set(2, 0, CellState.BLACK);
      state.cells.set(2, 1, CellState.BLACK);
      state.cells.set(0, 1, CellState.WHITE);
      state.cells.set(1, 1, CellState.WHITE);

      const runner = createLITSRunner();
      expect(runner.checkAll(state)).toBe(true);
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createLITSState(2, 2, [[0, 0], [0, 0]]);
      const clone = cloneState(state);

      clone.cells.set(0, 0, CellState.BLACK);

      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(clone.cells.get(0, 0)).toBe(CellState.BLACK);
    });
  });
});
