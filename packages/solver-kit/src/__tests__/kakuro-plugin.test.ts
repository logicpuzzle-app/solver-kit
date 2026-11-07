/**
 * Tests for Kakuro plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CandidateSet, PropagationResult } from '../core/field.js';
import {
  createKakuroState,
  solveKakuro,
  createKakuroRunner,
  KakuroGroup,
  cloneState,
} from '../examples/kakuro-plugin.js';

describe('Kakuro Plugin Solver', () => {
  describe('createKakuroState', () => {
    it('should create initial state with all candidates', () => {
      const whiteCells = [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
      ];
      const groups: KakuroGroup[] = [
        { sum: 3, cells: whiteCells },
      ];
      const state = createKakuroState(1, 2, whiteCells, groups);

      expect(state.height).toBe(1);
      expect(state.width).toBe(2);
      expect(state.candidates.get(0, 0)?.getAll()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(state.candidates.get(0, 1)?.getAll()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect sum exceeds clue', () => {
      const whiteCells = [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
      ];
      const groups: KakuroGroup[] = [
        { sum: 3, cells: whiteCells },
      ];
      const state = createKakuroState(1, 2, whiteCells, groups);

      // Set cells to 5 and 4 = 9, but sum should be 3
      const cand0 = state.candidates.get(0, 0)!;
      const cand1 = state.candidates.get(0, 1)!;
      for (const v of [1, 2, 3, 4, 6, 7, 8, 9]) cand0.eliminate(v);
      for (const v of [1, 2, 3, 5, 6, 7, 8, 9]) cand1.eliminate(v);

      const runner = createKakuroRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect duplicate values', () => {
      const whiteCells = [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
      ];
      const groups: KakuroGroup[] = [
        { sum: 4, cells: whiteCells },
      ];
      const state = createKakuroState(1, 2, whiteCells, groups);

      // Set both cells to 2 (duplicate)
      const cand0 = state.candidates.get(0, 0)!;
      const cand1 = state.candidates.get(0, 1)!;
      for (const v of [1, 3, 4, 5, 6, 7, 8, 9]) cand0.eliminate(v);
      for (const v of [1, 3, 4, 5, 6, 7, 8, 9]) cand1.eliminate(v);

      const runner = createKakuroRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveKakuro', () => {
    it('should solve a simple 2-cell puzzle', () => {
      const whiteCells = [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
      ];
      const groups: KakuroGroup[] = [
        { sum: 3, cells: whiteCells },
      ];
      const state = createKakuroState(1, 2, whiteCells, groups);
      const solution = solveKakuro(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const v1 = solution.candidates.get(0, 0)?.getAll()[0];
        const v2 = solution.candidates.get(0, 1)?.getAll()[0];
        expect(v1! + v2!).toBe(3);
        expect(v1).not.toBe(v2);
      }
    });

    it('should solve a 3-cell puzzle', () => {
      const whiteCells = [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
        { row: 0, col: 2 },
      ];
      const groups: KakuroGroup[] = [
        { sum: 6, cells: whiteCells },
      ];
      const state = createKakuroState(1, 3, whiteCells, groups);
      const solution = solveKakuro(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const values = whiteCells.map(p => solution.candidates.get(p)?.getAll()[0]!);
        expect(values.reduce((a, b) => a + b, 0)).toBe(6);
        expect(new Set(values).size).toBe(3); // All unique
      }
    });

    it('should solve puzzle with overlapping groups', () => {
      // 2x2 grid with 2 horizontal and 2 vertical groups
      const whiteCells = [
        { row: 0, col: 0 }, { row: 0, col: 1 },
        { row: 1, col: 0 }, { row: 1, col: 1 },
      ];
      const groups: KakuroGroup[] = [
        { sum: 3, cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
        { sum: 7, cells: [{ row: 1, col: 0 }, { row: 1, col: 1 }] },
        { sum: 4, cells: [{ row: 0, col: 0 }, { row: 1, col: 0 }] },
        { sum: 6, cells: [{ row: 0, col: 1 }, { row: 1, col: 1 }] },
      ];
      const state = createKakuroState(2, 2, whiteCells, groups);
      const solution = solveKakuro(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createKakuroRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should return null for unsolvable puzzle', () => {
      const whiteCells = [
        { row: 0, col: 0 },
        { row: 0, col: 1 },
      ];
      const groups: KakuroGroup[] = [
        { sum: 1, cells: whiteCells }, // Impossible: min is 1+2=3
      ];
      const state = createKakuroState(1, 2, whiteCells, groups);
      const solution = solveKakuro(state);

      expect(solution).toBeNull();
    });
  });
});
