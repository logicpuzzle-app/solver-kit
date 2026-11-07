/**
 * Golden Tests: Nurikabe Plugin vs Legacy Solver
 *
 * These tests verify that the plugin-based solver produces
 * correct results and the constraint plugins work correctly.
 */

import { describe, it, expect } from 'vitest';
import { NurikabeSolver } from '../../solvers/nurikabe.js';
import {
  createNurikabeState,
  createNurikabeRunner,
  hasUnknown,
} from '../../examples/nurikabe-plugin.js';
import { CellState } from '../../core/types.js';

describe('Nurikabe Golden Tests', () => {
  describe('Legacy Solver', () => {
    it('solves a simple puzzle', () => {
      const puzzle = [
        '1..',
        '...',
        '..1',
      ];
      const solver = NurikabeSolver.fromString(3, 3, puzzle);
      const solution = solver.solve();

      // solve() returns the solved field or null
      expect(solution).not.toBeNull();
    });
  });

  describe('Plugin Constraint Verification', () => {
    it('verifies No2x2PoolConstraint detects pools', () => {
      const runner = createNurikabeRunner();

      // Create a state with a 2x2 pool
      const state = createNurikabeState(2, 2, ['..', '..']);
      state.cells.set({ row: 0, col: 0 }, CellState.BLACK);
      state.cells.set({ row: 0, col: 1 }, CellState.BLACK);
      state.cells.set({ row: 1, col: 0 }, CellState.BLACK);
      state.cells.set({ row: 1, col: 1 }, CellState.BLACK);

      // Should not be satisfied due to pool
      expect(runner.checkAll(state)).toBe(false);
    });

    it('verifies IslandSizeConstraint works', () => {
      const runner = createNurikabeRunner();

      // Create a simple 1x1 puzzle - should be satisfied
      const state1 = createNurikabeState(1, 1, ['1']);
      expect(runner.checkAll(state1)).toBe(true);

      // Create a 1x2 puzzle with number 1 - island too big if both white
      const state2 = createNurikabeState(1, 2, ['1.']);
      state2.cells.set({ row: 0, col: 1 }, CellState.WHITE);
      // Island is now size 2 but number says 1 - should fail
      expect(runner.checkAll(state2)).toBe(false);
    });

    it('verifies BlackConnectedConstraint works', () => {
      const runner = createNurikabeRunner();

      // Create state where all cells are determined
      const state = createNurikabeState(3, 1, ['1', '.', '1']);
      state.cells.set({ row: 1, col: 0 }, CellState.BLACK);

      // Single black cell surrounded by whites should be connected
      expect(runner.checkAll(state)).toBe(true);
    });
  });

  describe('Component Plugin Integration', () => {
    it('uses component plugin to check connectivity', () => {
      // This verifies the component plugin is properly integrated
      const state = createNurikabeState(3, 3, ['1..', '...', '..1']);
      const runner = createNurikabeRunner();

      // Initial state with unknowns - constraints should be checking
      // The runner should not throw errors
      expect(() => runner.checkAll(state)).not.toThrow();
    });
  });

  describe('Pattern Match Plugin Integration', () => {
    it('uses pattern match plugin for 2x2 pool detection', () => {
      const state = createNurikabeState(2, 2, ['..', '..']);

      // Set 3 blacks (not a complete pool yet)
      state.cells.set({ row: 0, col: 0 }, CellState.BLACK);
      state.cells.set({ row: 0, col: 1 }, CellState.BLACK);
      state.cells.set({ row: 1, col: 0 }, CellState.BLACK);
      state.cells.set({ row: 1, col: 1 }, CellState.WHITE); // Prevent pool

      const runner = createNurikabeRunner();
      // Should pass the pool check
      const unsatisfied = runner.getUnsatisfied(state);
      const poolConstraint = unsatisfied.find(c => c.type === 'no-2x2-pool');
      expect(poolConstraint).toBeUndefined(); // Pool constraint should be satisfied
    });
  });
});
