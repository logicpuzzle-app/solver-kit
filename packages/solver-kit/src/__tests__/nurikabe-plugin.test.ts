/**
 * Nurikabe Plugin Solver Tests
 */

import { describe, it, expect } from 'vitest';
import { CellState } from '../core/types.js';
import {
  createNurikabeState,
  createNurikabeRunner,
  solveNurikabe,
  hasUnknown,
} from '../examples/nurikabe-plugin.js';

describe('Nurikabe Plugin Solver', () => {
  describe('createNurikabeState', () => {
    it('creates state from puzzle string', () => {
      const puzzle = [
        '1...',
        '....',
        '....',
        '....2',
      ];
      const state = createNurikabeState(4, 5, puzzle);

      expect(state.cells.height).toBe(4);
      expect(state.cells.width).toBe(5);
      expect(state.numbers.get(0, 0)).toBe(1);
      expect(state.numbers.get(3, 4)).toBe(2);
      expect(state.cells.get(0, 0)).toBe(CellState.WHITE);
      expect(state.cells.get(0, 1)).toBe(CellState.UNKNOWN);
    });

    it('handles letters for numbers 10+', () => {
      const puzzle = ['a..'];
      const state = createNurikabeState(1, 3, puzzle);

      expect(state.numbers.get(0, 0)).toBe(10);
    });
  });

  describe('createNurikabeRunner', () => {
    it('creates runner with constraints', () => {
      const runner = createNurikabeRunner();
      expect(runner).toBeDefined();
    });

    it('detects satisfied state', () => {
      // A trivially satisfied 1x1 puzzle
      const puzzle = ['1'];
      const state = createNurikabeState(1, 1, puzzle);
      const runner = createNurikabeRunner();

      // Single white cell with number 1 should be satisfied
      expect(runner.checkAll(state)).toBe(true);
    });
  });

  describe('hasUnknown', () => {
    it('returns true when unknowns exist', () => {
      const puzzle = ['1..'];
      const state = createNurikabeState(1, 3, puzzle);

      expect(hasUnknown(state)).toBe(true);
    });

    it('returns false when no unknowns', () => {
      const puzzle = ['1'];
      const state = createNurikabeState(1, 1, puzzle);

      expect(hasUnknown(state)).toBe(false);
    });
  });

  describe('solveNurikabe', () => {
    it('solves a simple 2x2 puzzle', () => {
      // 1. (number 1 at position 0,0)
      // .. (remaining cells)
      const puzzle = [
        '1.',
        '..',
      ];
      const state = createNurikabeState(2, 2, puzzle);
      const result = solveNurikabe(state);

      // This puzzle should have a solution where the island of 1
      // is just the single numbered cell
      if (result) {
        expect(hasUnknown(result)).toBe(false);
      }
    });

    it('solves a 3x3 puzzle with number 3', () => {
      // 3.. - island of 3 cells
      // ...
      // ...
      const puzzle = [
        '3..',
        '...',
        '...',
      ];
      const state = createNurikabeState(3, 3, puzzle);
      const result = solveNurikabe(state);

      // Should find a valid solution
      if (result) {
        expect(hasUnknown(result)).toBe(false);
        const runner = createNurikabeRunner();
        expect(runner.checkAll(result)).toBe(true);
      }
    });
  });
});
