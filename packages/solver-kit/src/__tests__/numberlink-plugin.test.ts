/**
 * Tests for Numberlink plugin solver
 */

import { describe, it, expect } from 'vitest';
import { PropagationResult } from '../core/field.js';
import {
  createNumberlinkState,
  solveNumberlink,
  createNumberlinkRunner,
  cloneState,
  EdgeState,
} from '../examples/numberlink-plugin.js';

describe('Numberlink Plugin Solver', () => {
  describe('createNumberlinkState', () => {
    it('should create initial state with numbers', () => {
      const numbers = [
        { row: 0, col: 0, value: 1 },
        { row: 1, col: 1, value: 1 },
        { row: 0, col: 1, value: 2 },
        { row: 1, col: 0, value: 2 },
      ];
      const state = createNumberlinkState(2, 2, numbers);

      expect(state.height).toBe(2);
      expect(state.width).toBe(2);
      expect(state.numbers.get(0, 0)).toBe(1);
      expect(state.numbers.get(1, 1)).toBe(1);
      expect(state.numbers.get(0, 1)).toBe(2);
      expect(state.numbers.get(1, 0)).toBe(2);
    });

    it('should initialize all edges as unknown', () => {
      const state = createNumberlinkState(2, 2, []);

      // hEdges: 2 rows x 1 col
      expect(state.hEdges.get(0, 0)).toBe(EdgeState.UNKNOWN);
      expect(state.hEdges.get(1, 0)).toBe(EdgeState.UNKNOWN);

      // vEdges: 1 row x 2 cols
      expect(state.vEdges.get(0, 0)).toBe(EdgeState.UNKNOWN);
      expect(state.vEdges.get(0, 1)).toBe(EdgeState.UNKNOWN);
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect endpoint with too many paths', () => {
      const state = createNumberlinkState(2, 2, [
        { row: 0, col: 0, value: 1 },
        { row: 1, col: 1, value: 1 },
      ]);

      // Set 2 paths from endpoint (0,0)
      state.hEdges.set(0, 0, EdgeState.PATH);
      state.vEdges.set(0, 0, EdgeState.PATH);

      const runner = createNumberlinkRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect dead end in non-endpoint', () => {
      const state = createNumberlinkState(3, 1, [
        { row: 0, col: 0, value: 1 },
        { row: 2, col: 0, value: 1 },
      ]);

      // Create dead end at middle cell
      state.vEdges.set(0, 0, EdgeState.PATH);
      state.vEdges.set(1, 0, EdgeState.WALL);

      const runner = createNumberlinkRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createNumberlinkState(2, 2, [
        { row: 0, col: 0, value: 1 },
        { row: 1, col: 1, value: 1 },
      ]);

      const runner = createNumberlinkRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveNumberlink', () => {
    it('should solve a simple 2x1 puzzle', () => {
      // 1 - 1 (straight path)
      const state = createNumberlinkState(1, 2, [
        { row: 0, col: 0, value: 1 },
        { row: 0, col: 1, value: 1 },
      ]);
      const solution = solveNumberlink(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createNumberlinkRunner();
        expect(runner.checkAll(solution)).toBe(true);
        expect(solution.hEdges.get(0, 0)).toBe(EdgeState.PATH);
      }
    });

    it('should solve a 3x1 puzzle', () => {
      // 1 - . - 1
      const state = createNumberlinkState(1, 3, [
        { row: 0, col: 0, value: 1 },
        { row: 0, col: 2, value: 1 },
      ]);
      const solution = solveNumberlink(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createNumberlinkRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createNumberlinkState(2, 2, []);
      const clone = cloneState(state);

      clone.hEdges.set(0, 0, EdgeState.PATH);

      expect(state.hEdges.get(0, 0)).toBe(EdgeState.UNKNOWN);
      expect(clone.hEdges.get(0, 0)).toBe(EdgeState.PATH);
    });
  });
});
