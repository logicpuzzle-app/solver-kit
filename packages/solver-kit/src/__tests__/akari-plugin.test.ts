/**
 * Tests for Akari (Light Up) plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createAkariState,
  solveAkari,
  createAkariRunner,
  AkariCellType,
  placeLight,
  cloneState,
} from '../examples/akari-plugin.js';

describe('Akari Plugin Solver', () => {
  describe('createAkariState', () => {
    it('should create initial state from puzzle', () => {
      const puzzle = [
        '.#.',
        '1.0',
        '...',
      ];
      const state = createAkariState(3, 3, puzzle);

      expect(state.height).toBe(3);
      expect(state.width).toBe(3);
      expect(state.cellTypes.get(0, 1)).toBe(AkariCellType.WALL);
      expect(state.cellTypes.get(1, 0)).toBe(AkariCellType.WALL);
      expect(state.wallNumbers.get('1,0')).toBe(1);
      expect(state.cellTypes.get(1, 2)).toBe(AkariCellType.WALL);
      expect(state.wallNumbers.get('1,2')).toBe(0);
    });

    it('should initialize empty cells with unknown state', () => {
      const puzzle = [
        '...',
        '...',
      ];
      const state = createAkariState(2, 3, puzzle);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 3; col++) {
          expect(state.cellTypes.get(row, col)).toBe(AkariCellType.EMPTY);
          expect(state.cellStates.get(row, col)).toBe(CellState.UNKNOWN);
        }
      }
    });
  });

  describe('placeLight', () => {
    it('should mark cell as light', () => {
      const puzzle = ['...'];
      const state = createAkariState(1, 3, puzzle);

      placeLight(state, { row: 0, col: 1 });

      expect(state.cellTypes.get(0, 1)).toBe(AkariCellType.LIGHT);
    });

    it('should update lit cells', () => {
      const puzzle = ['...'];
      const state = createAkariState(1, 3, puzzle);

      placeLight(state, { row: 0, col: 1 });

      expect(state.litCells.has('0,0')).toBe(true);
      expect(state.litCells.has('0,2')).toBe(true);
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect light conflict', () => {
      const puzzle = ['...'];
      const state = createAkariState(1, 3, puzzle);

      placeLight(state, { row: 0, col: 0 });
      placeLight(state, { row: 0, col: 2 });

      const runner = createAkariRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect wall number violation', () => {
      const puzzle = [
        '.0.',
        '...',
      ];
      const state = createAkariState(2, 3, puzzle);

      // Place a light adjacent to wall with 0
      placeLight(state, { row: 0, col: 0 });

      const runner = createAkariRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveAkari', () => {
    it('should solve a simple 2x2 puzzle', () => {
      const puzzle = [
        '..',
        '.#',
      ];
      const state = createAkariState(2, 2, puzzle);
      const solution = solveAkari(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createAkariRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should solve a 1x3 horizontal puzzle', () => {
      // Simple 1x3: just one light can illuminate all cells
      const puzzle = ['...'];
      const state = createAkariState(1, 3, puzzle);
      const solution = solveAkari(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createAkariRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should return null for unsolvable puzzle', () => {
      // Wall with 4 lights needed but only 2 empty neighbors
      const puzzle = [
        '#4#',
        '...',
      ];
      const state = createAkariState(2, 3, puzzle);
      const solution = solveAkari(state);

      expect(solution).toBeNull();
    });
  });
});
