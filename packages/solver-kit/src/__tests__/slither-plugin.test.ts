/**
 * Tests for Slither Link plugin solver
 */

import { describe, it, expect } from 'vitest';
import { EdgeState } from '../core/types.js';
import { Grid, PropagationResult } from '../core/field.js';
import {
  createSlitherState,
  solveSlither,
  createSlitherRunner,
  SlitherState,
} from '../examples/slither-plugin.js';

describe('Slither Plugin Solver', () => {
  describe('createSlitherState', () => {
    it('should create initial state from puzzle', () => {
      const puzzle = [
        '3.2',
        '.0.',
        '2.3',
      ];
      const state = createSlitherState(3, 3, puzzle);

      expect(state.height).toBe(3);
      expect(state.width).toBe(3);
      expect(state.numbers.get(0, 0)).toBe(3);
      expect(state.numbers.get(0, 1)).toBeNull();
      expect(state.numbers.get(0, 2)).toBe(2);
      expect(state.numbers.get(1, 1)).toBe(0);
    });

    it('should initialize all edges as unknown', () => {
      const state = createSlitherState(2, 2, ['..', '..']);

      for (let row = 0; row <= 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.horizontal.get(row, col)).toBe(EdgeState.UNKNOWN);
        }
      }
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col <= 2; col++) {
          expect(state.vertical.get(row, col)).toBe(EdgeState.UNKNOWN);
        }
      }
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect number clue violation', () => {
      const state = createSlitherState(2, 2, ['0.', '..']);

      // Set one edge around the 0 cell
      state.horizontal.set(0, 0, EdgeState.LINE);

      const runner = createSlitherRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      // Just test that we can create state without contradiction
      const state = createSlitherState(2, 2, ['..', '..']);

      const runner = createSlitherRunner();
      const { result } = runner.run(state);
      // All unknown should not be contradiction
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveSlither', () => {
    it('should solve a simple 2x2 puzzle with all 2s', () => {
      // A simple loop going around the outside
      const puzzle = [
        '22',
        '22',
      ];
      const state = createSlitherState(2, 2, puzzle);
      const solution = solveSlither(state);

      expect(solution).not.toBeNull();
      if (solution) {
        // Check that all number clues are satisfied
        const runner = createSlitherRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should return null for unsolvable puzzle', () => {
      // 0 in corner means no edges around it, but 3 in adjacent means 3 edges
      // This creates an impossible situation
      const puzzle = [
        '03',
        '30',
      ];
      const state = createSlitherState(2, 2, puzzle);
      const solution = solveSlither(state);

      expect(solution).toBeNull();
    });

    it('should solve a 3x3 puzzle', () => {
      const puzzle = [
        '.2.',
        '2.2',
        '.2.',
      ];
      const state = createSlitherState(3, 3, puzzle);
      const solution = solveSlither(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createSlitherRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });
  });
});
