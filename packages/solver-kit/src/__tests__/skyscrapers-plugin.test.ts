/**
 * Tests for Skyscrapers plugin solver
 */

import { describe, it, expect } from 'vitest';
import { PropagationResult } from '../core/field.js';
import {
  createSkyscrapersState,
  solveSkyscrapers,
  createSkyscrapersRunner,
  cloneState,
} from '../examples/skyscrapers-plugin.js';

describe('Skyscrapers Plugin Solver', () => {
  describe('createSkyscrapersState', () => {
    it('should create initial state with clues', () => {
      const topClues = [2, null, 1];
      const bottomClues = [null, 2, null];
      const leftClues = [1, 2, null];
      const rightClues = [null, null, 1];

      const state = createSkyscrapersState(3, topClues, bottomClues, leftClues, rightClues);

      expect(state.size).toBe(3);
      expect(state.topClues).toEqual([2, null, 1]);
      expect(state.bottomClues).toEqual([null, 2, null]);
      expect(state.leftClues).toEqual([1, 2, null]);
      expect(state.rightClues).toEqual([null, null, 1]);
    });

    it('should initialize all cells with full candidates', () => {
      const state = createSkyscrapersState(
        3,
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [null, null, null]
      );

      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const cell = state.candidates.get(row, col);
          expect(cell.has(1)).toBe(true);
          expect(cell.has(2)).toBe(true);
          expect(cell.has(3)).toBe(true);
        }
      }
    });

    it('should handle given values', () => {
      const state = createSkyscrapersState(
        3,
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [{ row: 0, col: 0, value: 2 }]
      );

      expect(state.candidates.get(0, 0).isDetermined()).toBe(true);
      expect(state.candidates.get(0, 0).getValue()).toBe(2);
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect row uniqueness violation', () => {
      const state = createSkyscrapersState(
        3,
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [
          { row: 0, col: 0, value: 1 },
          { row: 0, col: 1, value: 1 },
        ]
      );

      const runner = createSkyscrapersRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect column uniqueness violation', () => {
      const state = createSkyscrapersState(
        3,
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [
          { row: 0, col: 0, value: 2 },
          { row: 1, col: 0, value: 2 },
        ]
      );

      const runner = createSkyscrapersRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createSkyscrapersState(
        3,
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [null, null, null],
        [{ row: 1, col: 1, value: 2 }]
      );

      const runner = createSkyscrapersRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveSkyscrapers', () => {
    it('should solve a simple 2x2 puzzle with no clues', () => {
      // 2x2 puzzle with no clues - should find some valid Latin square
      const state = createSkyscrapersState(
        2,
        [null, null],   // top
        [null, null],   // bottom
        [null, null],   // left
        [null, null]    // right
      );

      const solution = solveSkyscrapers(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createSkyscrapersRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should solve a 2x2 puzzle with given values', () => {
      // 2x2 puzzle with some given values
      const state = createSkyscrapersState(
        2,
        [null, null],
        [null, null],
        [null, null],
        [null, null],
        [{ row: 0, col: 0, value: 1 }]
      );

      const solution = solveSkyscrapers(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createSkyscrapersRunner();
        expect(runner.checkAll(solution)).toBe(true);
        expect(solution.candidates.get(0, 0).getValue()).toBe(1);
      }
    });

    it('should verify a valid solution', () => {
      // Manually set up a valid 2x2 Latin square and verify it
      const state = createSkyscrapersState(
        2,
        [null, null],
        [null, null],
        [null, null],
        [null, null],
        [
          { row: 0, col: 0, value: 1 },
          { row: 0, col: 1, value: 2 },
          { row: 1, col: 0, value: 2 },
          { row: 1, col: 1, value: 1 },
        ]
      );

      const runner = createSkyscrapersRunner();
      expect(runner.checkAll(state)).toBe(true);
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createSkyscrapersState(
        2,
        [null, null],
        [null, null],
        [null, null],
        [null, null]
      );
      const clone = cloneState(state);

      clone.candidates.get(0, 0).setTo(1);

      expect(state.candidates.get(0, 0).isDetermined()).toBe(false);
      expect(clone.candidates.get(0, 0).isDetermined()).toBe(true);
    });
  });
});
