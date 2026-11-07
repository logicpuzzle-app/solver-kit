/**
 * Tests for Sudoku plugin solver
 */

import { describe, it, expect } from 'vitest';
import { PropagationResult } from '../core/field.js';
import {
  createSudokuState,
  createSudokuStateFromArray,
  solveSudoku,
  createSudokuRunner,
  cloneState,
} from '../examples/sudoku-plugin.js';

describe('Sudoku Plugin Solver', () => {
  describe('createSudokuState', () => {
    it('should create 9x9 state from string', () => {
      const puzzle = '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';
      const state = createSudokuState(9, puzzle);

      expect(state.size).toBe(9);
      expect(state.boxHeight).toBe(3);
      expect(state.boxWidth).toBe(3);
      expect(state.candidates.get(0, 0).getValue()).toBe(5);
      expect(state.candidates.get(0, 1).getValue()).toBe(3);
      expect(state.candidates.get(0, 2).isDetermined()).toBe(false);
    });

    it('should create 4x4 state', () => {
      const puzzle = '1..4.3....2.4..1';
      const state = createSudokuState(4, puzzle);

      expect(state.size).toBe(4);
      expect(state.boxHeight).toBe(2);
      expect(state.boxWidth).toBe(2);
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect row duplicate', () => {
      const puzzle = '11.......';  // Two 1s in first row
      const state = createSudokuState(4, puzzle + '.'.repeat(7));

      const runner = createSudokuRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect column duplicate', () => {
      const state = createSudokuState(4, '1...1...............');

      const runner = createSudokuRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect box duplicate', () => {
      // 4x4 with 2x2 boxes: put two 1s in same box
      const puzzle = '1.....1.........';
      const state = createSudokuState(4, puzzle);

      // (0,0) = 1, (1,2) = 1 - different boxes, should be OK
      // Let's create actual duplicate in same box
      const badPuzzle = '1..11...............';  // (0,0)=1, (0,3)=1, (1,0)=1
      const badState = createSudokuState(4, badPuzzle);

      const runner = createSudokuRunner();
      const { result } = runner.run(badState);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid state', () => {
      const puzzle = '1234341223414123';  // Valid 4x4 sudoku
      const state = createSudokuState(4, puzzle);

      const runner = createSudokuRunner();
      expect(runner.checkAll(state)).toBe(true);
    });
  });

  describe('solveSudoku', () => {
    it('should solve a simple 4x4 puzzle', () => {
      // Valid 4x4 puzzle with unique solution
      const puzzle = '..3..4..1..2....';
      const state = createSudokuState(4, puzzle);
      const solution = solveSudoku(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createSudokuRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should solve a 9x9 puzzle', () => {
      const puzzle = '53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79';
      const state = createSudokuState(9, puzzle);
      const solution = solveSudoku(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createSudokuRunner();
        expect(runner.checkAll(solution)).toBe(true);

        // Verify some known values
        expect(solution.candidates.get(0, 0).getValue()).toBe(5);
        expect(solution.candidates.get(0, 1).getValue()).toBe(3);
        expect(solution.candidates.get(8, 8).getValue()).toBe(9);
      }
    });

    it('should return null for unsolvable puzzle', () => {
      // Row has two 1s - unsolvable
      const puzzle = '11..............';
      const state = createSudokuState(4, puzzle);
      const solution = solveSudoku(state);

      expect(solution).toBeNull();
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createSudokuState(4, '1...............');
      const clone = cloneState(state);

      clone.candidates.get(0, 1).setTo(2);

      expect(state.candidates.get(0, 1).isDetermined()).toBe(false);
      expect(clone.candidates.get(0, 1).getValue()).toBe(2);
    });
  });
});
