/**
 * Tests for Minesweeper plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createMinesweeperState,
  solveMinesweeper,
  createMinesweeperRunner,
  cloneState,
} from '../examples/minesweeper-plugin.js';

describe('Minesweeper Plugin Solver', () => {
  describe('createMinesweeperState', () => {
    it('should create initial state with numbers', () => {
      const numbers = [
        { row: 0, col: 0, value: 1 },
        { row: 1, col: 1, value: 2 },
      ];
      const state = createMinesweeperState(3, 3, numbers);

      expect(state.height).toBe(3);
      expect(state.width).toBe(3);
      expect(state.numbers.get(0, 0)).toBe(1);
      expect(state.numbers.get(1, 1)).toBe(2);

      // Number cells are safe
      expect(state.cells.get(0, 0)).toBe(CellState.WHITE);
      expect(state.cells.get(1, 1)).toBe(CellState.WHITE);
    });

    it('should initialize non-number cells as unknown', () => {
      const state = createMinesweeperState(2, 2, []);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.cells.get(row, col)).toBe(CellState.UNKNOWN);
        }
      }
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect too many mines', () => {
      // Number 1 but 2 adjacent mines
      const state = createMinesweeperState(2, 2, [{ row: 0, col: 0, value: 1 }]);

      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(1, 0, CellState.BLACK);

      const runner = createMinesweeperRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect mine on number cell', () => {
      const state = createMinesweeperState(2, 2, [{ row: 0, col: 0, value: 1 }]);

      // Force number cell to mine
      state.cells.set(0, 0, CellState.BLACK);

      const runner = createMinesweeperRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect not enough cells for mines', () => {
      // Number 5 in corner - only 3 neighbors
      const state = createMinesweeperState(2, 2, [{ row: 0, col: 0, value: 5 }]);

      const runner = createMinesweeperRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createMinesweeperState(3, 3, [{ row: 1, col: 1, value: 2 }]);

      const runner = createMinesweeperRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveMinesweeper', () => {
    it('should solve a simple puzzle with no mines', () => {
      // Number 0 = no adjacent mines
      const state = createMinesweeperState(2, 2, [{ row: 0, col: 0, value: 0 }]);
      const solution = solveMinesweeper(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createMinesweeperRunner();
        expect(runner.checkAll(solution)).toBe(true);
        // All cells should be safe
        expect(solution.cells.get(0, 1)).toBe(CellState.WHITE);
        expect(solution.cells.get(1, 0)).toBe(CellState.WHITE);
        expect(solution.cells.get(1, 1)).toBe(CellState.WHITE);
      }
    });

    it('should solve a puzzle with mines', () => {
      // Number 1 in center of 1x3 - one end must be mine
      const state = createMinesweeperState(1, 3, [{ row: 0, col: 1, value: 1 }]);
      const solution = solveMinesweeper(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createMinesweeperRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createMinesweeperState(2, 2, []);
      const clone = cloneState(state);

      clone.cells.set(0, 0, CellState.BLACK);

      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(clone.cells.get(0, 0)).toBe(CellState.BLACK);
    });
  });
});
