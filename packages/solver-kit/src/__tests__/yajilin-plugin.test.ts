/**
 * Tests for Yajilin plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState, Direction } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createYajilinState,
  solveYajilin,
  createYajilinRunner,
  cloneState,
  EdgeState,
} from '../examples/yajilin-plugin.js';

describe('Yajilin Plugin Solver', () => {
  describe('createYajilinState', () => {
    it('should create initial state with arrows', () => {
      const arrows = [
        { row: 0, col: 0, direction: Direction.RIGHT, count: 2 },
        { row: 1, col: 1, direction: Direction.DOWN, count: 1 },
      ];
      const state = createYajilinState(3, 3, arrows);

      expect(state.height).toBe(3);
      expect(state.width).toBe(3);

      const arrow1 = state.arrows.get(0, 0);
      expect(arrow1).not.toBeNull();
      expect(arrow1!.direction).toBe(Direction.RIGHT);
      expect(arrow1!.count).toBe(2);

      // Arrow cells are white
      expect(state.cells.get(0, 0)).toBe(CellState.WHITE);
      expect(state.cells.get(1, 1)).toBe(CellState.WHITE);
    });

    it('should initialize non-arrow cells as unknown', () => {
      const state = createYajilinState(2, 2, []);

      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          expect(state.cells.get(row, col)).toBe(CellState.UNKNOWN);
          expect(state.arrows.get(row, col)).toBeNull();
        }
      }
    });

    it('should close edges around arrow cells', () => {
      const arrows = [{ row: 1, col: 1, direction: Direction.UP, count: 0 }];
      const state = createYajilinState(3, 3, arrows);

      // Edges around (1,1) should be walls
      expect(state.vEdges.get(0, 1)).toBe(EdgeState.WALL); // above
      expect(state.vEdges.get(1, 1)).toBe(EdgeState.WALL); // below
      expect(state.hEdges.get(1, 0)).toBe(EdgeState.WALL); // left
      expect(state.hEdges.get(1, 1)).toBe(EdgeState.WALL); // right
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect adjacent black cells', () => {
      const state = createYajilinState(2, 2, []);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);

      const runner = createYajilinRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect line on black cell', () => {
      const state = createYajilinState(2, 2, []);

      state.cells.set(0, 0, CellState.BLACK);
      state.hEdges.set(0, 0, EdgeState.LINE); // Line to the right

      const runner = createYajilinRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid partial state', () => {
      const state = createYajilinState(3, 3, []);

      const runner = createYajilinRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('Arrow constraint', () => {
    it('should detect too many black cells in arrow direction', () => {
      const arrows = [{ row: 0, col: 0, direction: Direction.RIGHT, count: 1 }];
      const state = createYajilinState(1, 4, arrows);

      // Place 2 black cells to the right of arrow
      state.cells.set(0, 1, CellState.BLACK);
      state.cells.set(0, 3, CellState.BLACK);

      const runner = createYajilinRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect not enough cells for arrow count', () => {
      const arrows = [{ row: 0, col: 0, direction: Direction.RIGHT, count: 5 }];
      const state = createYajilinState(1, 3, arrows);

      // Only 2 cells to the right, but need 5 black
      const runner = createYajilinRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createYajilinState(2, 2, []);
      const clone = cloneState(state);

      clone.cells.set(0, 0, CellState.BLACK);
      clone.hEdges.set(0, 0, EdgeState.LINE);

      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(clone.cells.get(0, 0)).toBe(CellState.BLACK);
      expect(state.hEdges.get(0, 0)).toBe(EdgeState.UNKNOWN);
      expect(clone.hEdges.get(0, 0)).toBe(EdgeState.LINE);
    });
  });
});
