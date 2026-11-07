/**
 * Tests for Hashiwokakero plugin solver
 */

import { describe, it, expect } from 'vitest';
import { PropagationResult } from '../core/field.js';
import {
  createHashiState,
  solveHashi,
  createHashiRunner,
  cloneState,
} from '../examples/hashiwokakero-plugin.js';

describe('Hashiwokakero Plugin Solver', () => {
  describe('createHashiState', () => {
    it('should create initial state with islands', () => {
      const islands = [
        { row: 0, col: 0, value: 2 },
        { row: 0, col: 2, value: 2 },
      ];
      const state = createHashiState(1, 3, islands);

      expect(state.height).toBe(1);
      expect(state.width).toBe(3);
      expect(state.islands.get(0, 0)).toBe(2);
      expect(state.islands.get(0, 2)).toBe(2);
      expect(state.islands.get(0, 1)).toBeNull();
    });

    it('should initialize all bridges as 0 (unknown)', () => {
      const state = createHashiState(2, 2, []);

      expect(state.hBridges.get(0, 0)).toBe(0);
      expect(state.vBridges.get(0, 0)).toBe(0);
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect too many bridges on island', () => {
      // Island with value 1 but 2 bridges
      const state = createHashiState(1, 3, [
        { row: 0, col: 0, value: 1 },
        { row: 0, col: 2, value: 2 },
      ]);

      // Set 2 bridges
      state.hBridges.set(0, 0, 2);
      state.hBridges.set(0, 1, 2);

      const runner = createHashiRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect not enough possible bridges', () => {
      // Island with value 5 but only 1 neighbor (max 2 bridges)
      const state = createHashiState(1, 2, [
        { row: 0, col: 0, value: 5 },
        { row: 0, col: 1, value: 2 },
      ]);

      const runner = createHashiRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createHashiState(1, 3, [
        { row: 0, col: 0, value: 2 },
        { row: 0, col: 2, value: 2 },
      ]);

      const runner = createHashiRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveHashi', () => {
    it('should solve a simple 2-island puzzle', () => {
      // 2 - - 2 (needs 2 bridges)
      const state = createHashiState(1, 3, [
        { row: 0, col: 0, value: 2 },
        { row: 0, col: 2, value: 2 },
      ]);
      const solution = solveHashi(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createHashiRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should solve a simple 1-bridge puzzle', () => {
      // 1 - 1
      const state = createHashiState(1, 2, [
        { row: 0, col: 0, value: 1 },
        { row: 0, col: 1, value: 1 },
      ]);
      const solution = solveHashi(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createHashiRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should solve a linear 3-island puzzle', () => {
      // 1 - 2 - 1
      const state = createHashiState(1, 5, [
        { row: 0, col: 0, value: 1 },
        { row: 0, col: 2, value: 2 },
        { row: 0, col: 4, value: 1 },
      ]);
      const solution = solveHashi(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createHashiRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createHashiState(2, 2, []);
      const clone = cloneState(state);

      clone.hBridges.set(0, 0, 1);

      expect(state.hBridges.get(0, 0)).toBe(0);
      expect(clone.hBridges.get(0, 0)).toBe(1);
    });
  });
});
