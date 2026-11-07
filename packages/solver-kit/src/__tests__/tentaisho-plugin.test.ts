/**
 * Tests for Tentaisho plugin solver
 */

import { describe, it, expect } from 'vitest';
import { PropagationResult } from '../core/field.js';
import {
  createTentaishoState,
  solveTentaisho,
  createTentaishoRunner,
  cloneState,
  getPossibleStars,
} from '../examples/tentaisho-plugin.js';

describe('Tentaisho Plugin Solver', () => {
  describe('createTentaishoState', () => {
    it('should create initial state with stars', () => {
      // 2x2 grid with star at center (1,1) in half-coords = (0.5, 0.5)
      const state = createTentaishoState(2, 2, [{ row2: 2, col2: 2 }]);

      expect(state.height).toBe(2);
      expect(state.width).toBe(2);
      expect(state.stars.length).toBe(1);
      expect(state.stars[0].row2).toBe(2);
      expect(state.stars[0].col2).toBe(2);
    });

    it('should initialize all cells as unassigned', () => {
      const state = createTentaishoState(2, 2, [{ row2: 2, col2: 2 }]);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.regions.get(row, col)).toBe(-1);
        }
      }
    });
  });

  describe('getPossibleStars', () => {
    it('should find stars that can include a cell', () => {
      // 2x2 grid with star at center corner (all 4 cells can be symmetric)
      const state = createTentaishoState(2, 2, [{ row2: 2, col2: 2 }]);

      const possible = getPossibleStars(state, 0, 0);
      expect(possible).toContain(0);
    });

    it('should exclude stars where symmetric cell is out of bounds', () => {
      // 2x2 grid with star at cell (0,0) center
      // Cell (1,1) has symmetric at (-1,-1) which is out of bounds
      const state = createTentaishoState(2, 2, [{ row2: 1, col2: 1 }]);

      const possible = getPossibleStars(state, 1, 1);
      expect(possible).not.toContain(0);
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect symmetry violation', () => {
      // 2x2 grid with star at corner (2,2)
      const state = createTentaishoState(2, 2, [
        { row2: 2, col2: 2 }, // star 0 at corner of 4 cells
        { row2: 1, col2: 1 }, // star 1 at center of cell (0,0)
      ]);

      // Assign (0,0) to star 0
      state.regions.set(0, 0, 0);
      // Symmetric of (0,0) around star 0 is (1,1)
      // But assign (1,1) to star 1 - violation!
      state.regions.set(1, 1, 1);

      const runner = createTentaishoRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      // 2x2 grid with star at corner
      const state = createTentaishoState(2, 2, [{ row2: 2, col2: 2 }]);

      // Assign (0,0) and its symmetric (1,1) to same region
      state.regions.set(0, 0, 0);
      state.regions.set(1, 1, 0);

      const runner = createTentaishoRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveTentaisho', () => {
    it('should solve a simple 2x2 puzzle', () => {
      // 2x2 grid with star at corner (2,2) - should fill all 4 cells
      const state = createTentaishoState(2, 2, [{ row2: 2, col2: 2 }]);

      const solution = solveTentaisho(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createTentaishoRunner();
        expect(runner.checkAll(solution)).toBe(true);
        // All cells should belong to region 0
        expect(solution.regions.get(0, 0)).toBe(0);
        expect(solution.regions.get(0, 1)).toBe(0);
        expect(solution.regions.get(1, 0)).toBe(0);
        expect(solution.regions.get(1, 1)).toBe(0);
      }
    });

    it('should solve a puzzle with two stars', () => {
      // 2x2 grid with stars at centers of cells (0,0) and (1,1)
      // Star at cell center (0,0) can only include that cell
      // Star at cell center (1,1) can only include that cell
      const state = createTentaishoState(2, 2, [
        { row2: 1, col2: 1 }, // center of (0,0)
        { row2: 3, col2: 3 }, // center of (1,1)
      ]);

      const solution = solveTentaisho(state);

      // This puzzle may or may not have a solution depending on which cells
      // each star can include. Cell-center stars can only include their own cell.
      // The other cells (0,1) and (1,0) cannot have valid symmetric partners.
      // So this puzzle should have no solution.
      expect(solution).toBeNull();
    });

    it('should solve a 1x2 puzzle', () => {
      // 1x2 grid with star at edge between cells
      // Star at (1, 2) - edge between (0,0) and (0,1)
      const state = createTentaishoState(1, 2, [{ row2: 1, col2: 2 }]);

      const solution = solveTentaisho(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createTentaishoRunner();
        expect(runner.checkAll(solution)).toBe(true);
        // Both cells should belong to region 0
        expect(solution.regions.get(0, 0)).toBe(0);
        expect(solution.regions.get(0, 1)).toBe(0);
      }
    });

    it('should verify a complete solution', () => {
      // 2x2 with star at corner - manually assign all cells
      const state = createTentaishoState(2, 2, [{ row2: 2, col2: 2 }]);

      state.regions.set(0, 0, 0);
      state.regions.set(0, 1, 0);
      state.regions.set(1, 0, 0);
      state.regions.set(1, 1, 0);

      const runner = createTentaishoRunner();
      expect(runner.checkAll(state)).toBe(true);
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createTentaishoState(2, 2, [{ row2: 2, col2: 2 }]);
      const clone = cloneState(state);

      clone.regions.set(0, 0, 0);

      expect(state.regions.get(0, 0)).toBe(-1);
      expect(clone.regions.get(0, 0)).toBe(0);
    });
  });
});
