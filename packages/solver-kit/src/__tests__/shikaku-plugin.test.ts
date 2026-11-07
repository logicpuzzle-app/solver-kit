/**
 * Tests for Shikaku plugin solver
 */

import { describe, it, expect } from 'vitest';
import { PropagationResult } from '../core/field.js';
import {
  createShikakuState,
  solveShikaku,
  createShikakuRunner,
  cloneState,
} from '../examples/shikaku-plugin.js';

describe('Shikaku Plugin Solver', () => {
  describe('createShikakuState', () => {
    it('should create initial state with numbers', () => {
      const numbers = [
        { row: 0, col: 0, value: 4 },
        { row: 1, col: 2, value: 2 },
      ];
      const state = createShikakuState(3, 3, numbers);

      expect(state.height).toBe(3);
      expect(state.width).toBe(3);
      expect(state.numbers.get(0, 0)).toBe(4);
      expect(state.numbers.get(1, 2)).toBe(2);
      expect(state.rectangles).toHaveLength(0);
    });

    it('should initialize all cells as unassigned', () => {
      const state = createShikakuState(2, 2, []);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.assignments.get(row, col)).toBe(-1);
        }
      }
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect area mismatch', () => {
      const state = createShikakuState(2, 2, [{ row: 0, col: 0, value: 3 }]);

      // Manually add a 2x2 rectangle (area 4) containing a "3"
      state.rectangles.push({ top: 0, left: 0, bottom: 1, right: 1 });
      state.assignments.set(0, 0, 0);
      state.assignments.set(0, 1, 0);
      state.assignments.set(1, 0, 0);
      state.assignments.set(1, 1, 0);

      const runner = createShikakuRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid rectangle', () => {
      const state = createShikakuState(2, 2, [{ row: 0, col: 0, value: 4 }]);

      // Add a 2x2 rectangle (area 4) containing a "4"
      state.rectangles.push({ top: 0, left: 0, bottom: 1, right: 1 });
      state.assignments.set(0, 0, 0);
      state.assignments.set(0, 1, 0);
      state.assignments.set(1, 0, 0);
      state.assignments.set(1, 1, 0);

      const runner = createShikakuRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveShikaku', () => {
    it('should solve a simple 2x2 puzzle', () => {
      // 4 in corner = entire 2x2 grid
      const state = createShikakuState(2, 2, [{ row: 0, col: 0, value: 4 }]);
      const solution = solveShikaku(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createShikakuRunner();
        expect(runner.checkAll(solution)).toBe(true);
        expect(solution.rectangles).toHaveLength(1);
      }
    });

    it('should solve a 2x3 puzzle with two rectangles', () => {
      // 3 | 3
      // . | .
      // Split into two 1x3 columns
      const state = createShikakuState(3, 2, [
        { row: 0, col: 0, value: 3 },
        { row: 0, col: 1, value: 3 },
      ]);
      const solution = solveShikaku(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createShikakuRunner();
        expect(runner.checkAll(solution)).toBe(true);
        expect(solution.rectangles).toHaveLength(2);
      }
    });

    it('should solve a 3x3 puzzle', () => {
      // 6 | . | 3
      // . | . | .
      // . | . | .
      const state = createShikakuState(3, 3, [
        { row: 0, col: 0, value: 6 },
        { row: 0, col: 2, value: 3 },
      ]);
      const solution = solveShikaku(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createShikakuRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should return null for unsolvable puzzle', () => {
      // 5 in 2x2 is impossible (max area is 4)
      const state = createShikakuState(2, 2, [{ row: 0, col: 0, value: 5 }]);
      const solution = solveShikaku(state);

      expect(solution).toBeNull();
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createShikakuState(2, 2, []);
      const clone = cloneState(state);

      clone.assignments.set(0, 0, 1);
      clone.rectangles.push({ top: 0, left: 0, bottom: 0, right: 0 });

      expect(state.assignments.get(0, 0)).toBe(-1);
      expect(clone.assignments.get(0, 0)).toBe(1);
      expect(state.rectangles).toHaveLength(0);
      expect(clone.rectangles).toHaveLength(1);
    });
  });
});
