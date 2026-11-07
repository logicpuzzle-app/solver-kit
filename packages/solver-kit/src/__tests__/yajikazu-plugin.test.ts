/**
 * Tests for Yajisan-Kazusan plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState, Direction } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createYajikazuState,
  solveYajikazu,
  createYajikazuRunner,
  cloneState,
} from '../examples/yajikazu-plugin.js';

describe('Yajisan-Kazusan Plugin Solver', () => {
  describe('createYajikazuState', () => {
    it('should create initial state with clues', () => {
      const clues = [
        { row: 0, col: 0, direction: Direction.RIGHT, count: 2 },
      ];
      const state = createYajikazuState(2, 3, clues);

      expect(state.height).toBe(2);
      expect(state.width).toBe(3);

      const clue = state.clues.get(0, 0);
      expect(clue).not.toBeNull();
      expect(clue!.direction).toBe(Direction.RIGHT);
      expect(clue!.count).toBe(2);
    });

    it('should initialize all cells as unknown', () => {
      const state = createYajikazuState(2, 2, []);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.cells.get(row, col)).toBe(CellState.UNKNOWN);
        }
      }
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect adjacent shaded cells', () => {
      const state = createYajikazuState(2, 2, []);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);

      const runner = createYajikazuRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect too many shaded for white clue', () => {
      // Clue says 1 shaded to the right, but 2 are placed
      const clues = [{ row: 0, col: 0, direction: Direction.RIGHT, count: 1 }];
      const state = createYajikazuState(1, 4, clues);

      state.cells.set(0, 0, CellState.WHITE); // Make clue white (active)
      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(0, 2, CellState.WHITE);
      state.cells.set(0, 3, CellState.BLACK);

      const runner = createYajikazuRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createYajikazuState(2, 2, []);

      const runner = createYajikazuRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveYajikazu', () => {
    it('should solve a simple puzzle with no clues', () => {
      // All white is valid if connected
      const state = createYajikazuState(2, 2, []);
      const solution = solveYajikazu(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createYajikazuRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should solve a puzzle with arrow clue', () => {
      // Arrow pointing right expecting 1 shaded
      const clues = [{ row: 0, col: 0, direction: Direction.RIGHT, count: 1 }];
      const state = createYajikazuState(1, 3, clues);
      const solution = solveYajikazu(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createYajikazuRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createYajikazuState(2, 2, []);
      const clone = cloneState(state);

      clone.cells.set(0, 0, CellState.BLACK);

      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(clone.cells.get(0, 0)).toBe(CellState.BLACK);
    });
  });
});
