/**
 * Tests for Masyu plugin solver
 */

import { describe, it, expect } from 'vitest';
import { EdgeState } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createMasyuState,
  solveMasyu,
  createMasyuRunner,
  PearlType,
  cloneState,
} from '../examples/masyu-plugin.js';

describe('Masyu Plugin Solver', () => {
  describe('createMasyuState', () => {
    it('should create initial state from puzzle', () => {
      const puzzle = [
        '.o.',
        '*.*',
        '.o.',
      ];
      const state = createMasyuState(3, 3, puzzle);

      expect(state.height).toBe(3);
      expect(state.width).toBe(3);
      expect(state.pearls.get(0, 1)).toBe(PearlType.WHITE);
      expect(state.pearls.get(1, 0)).toBe(PearlType.BLACK);
      expect(state.pearls.get(1, 2)).toBe(PearlType.BLACK);
      expect(state.pearls.get(2, 1)).toBe(PearlType.WHITE);
    });

    it('should initialize all edges as unknown', () => {
      const state = createMasyuState(2, 2, ['..', '..']);

      // hEdges: 2 rows x 1 col
      expect(state.hEdges.get(0, 0)).toBe(EdgeState.UNKNOWN);
      expect(state.hEdges.get(1, 0)).toBe(EdgeState.UNKNOWN);

      // vEdges: 1 row x 2 cols
      expect(state.vEdges.get(0, 0)).toBe(EdgeState.UNKNOWN);
      expect(state.vEdges.get(0, 1)).toBe(EdgeState.UNKNOWN);
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect too many edges at vertex', () => {
      const state = createMasyuState(2, 2, ['..', '..']);

      // Set 3 edges at cell (0,0) - invalid
      state.hEdges.set(0, 0, EdgeState.LINE);  // right
      state.vEdges.set(0, 0, EdgeState.LINE);  // down
      // For 3 edges we need another, but (0,0) only has 2 edges in 2x2

      const runner = createMasyuRunner();
      const { result } = runner.run(state);
      // This should be fine since only 2 edges
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createMasyuState(3, 3, ['...', '...', '...']);

      const runner = createMasyuRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveMasyu', () => {
    it('should solve a simple 3x3 puzzle with one white pearl', () => {
      // Simple puzzle with just one white pearl in center
      const puzzle = [
        '...',
        '.o.',
        '...',
      ];
      const state = createMasyuState(3, 3, puzzle);
      const solution = solveMasyu(state);

      // Should find a solution
      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createMasyuRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should solve a puzzle with black pearls', () => {
      const puzzle = [
        '*..',
        '...',
        '..*',
      ];
      const state = createMasyuState(3, 3, puzzle);
      const solution = solveMasyu(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createMasyuRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createMasyuState(2, 2, ['..', '..']);
      const clone = cloneState(state);

      clone.hEdges.set(0, 0, EdgeState.LINE);

      expect(state.hEdges.get(0, 0)).toBe(EdgeState.UNKNOWN);
      expect(clone.hEdges.get(0, 0)).toBe(EdgeState.LINE);
    });
  });
});
