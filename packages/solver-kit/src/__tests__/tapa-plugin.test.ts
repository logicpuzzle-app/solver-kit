/**
 * Tests for Tapa plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createTapaState,
  solveTapa,
  createTapaRunner,
  cloneState,
} from '../examples/tapa-plugin.js';

describe('Tapa Plugin Solver', () => {
  describe('createTapaState', () => {
    it('should create initial state with clues', () => {
      const clues = [
        { row: 0, col: 0, values: [1, 2] },
        { row: 1, col: 1, values: [3] },
      ];
      const state = createTapaState(3, 3, clues);

      expect(state.height).toBe(3);
      expect(state.width).toBe(3);

      const clue1 = state.clues.get(0, 0);
      expect(clue1).toEqual([1, 2]);

      const clue2 = state.clues.get(1, 1);
      expect(clue2).toEqual([3]);

      // Clue cells are white
      expect(state.cells.get(0, 0)).toBe(CellState.WHITE);
      expect(state.cells.get(1, 1)).toBe(CellState.WHITE);
    });

    it('should initialize non-clue cells as unknown', () => {
      const state = createTapaState(2, 2, []);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.cells.get(row, col)).toBe(CellState.UNKNOWN);
          expect(state.clues.get(row, col)).toBeNull();
        }
      }
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect 2x2 black area', () => {
      const state = createTapaState(2, 2, []);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(1, 0, CellState.BLACK);
      state.cells.set(1, 1, CellState.BLACK);

      const runner = createTapaRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect black on clue cell', () => {
      const state = createTapaState(2, 2, [{ row: 0, col: 0, values: [1] }]);

      // Force clue cell to black (override the white)
      state.cells.set(0, 0, CellState.BLACK);

      const runner = createTapaRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createTapaState(3, 3, []);

      const runner = createTapaRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('Clue constraint', () => {
    it('should detect too many black around clue', () => {
      // Clue [1] means exactly 1 black cell around it
      const state = createTapaState(3, 3, [{ row: 1, col: 1, values: [1] }]);

      // Place 2 black cells around the clue
      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(2, 1, CellState.BLACK);

      const runner = createTapaRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect not enough cells for clue', () => {
      // Clue [5] needs 5 black cells around it, but center has only 8 neighbors
      const state = createTapaState(3, 3, [{ row: 1, col: 1, values: [5] }]);

      // Make all neighbors white except 2
      state.cells.set(0, 0, CellState.WHITE);
      state.cells.set(0, 1, CellState.WHITE);
      state.cells.set(0, 2, CellState.WHITE);
      state.cells.set(1, 0, CellState.WHITE);
      state.cells.set(1, 2, CellState.WHITE);
      state.cells.set(2, 0, CellState.WHITE);
      // Only 2 cells left (2,1) and (2,2)

      const runner = createTapaRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createTapaState(2, 2, []);
      const clone = cloneState(state);

      clone.cells.set(0, 0, CellState.BLACK);

      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(clone.cells.get(0, 0)).toBe(CellState.BLACK);
    });
  });
});
