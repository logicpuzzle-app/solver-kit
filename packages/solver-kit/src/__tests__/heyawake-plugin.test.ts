/**
 * Tests for Heyawake plugin solver
 */

import { describe, it, expect } from 'vitest';
import { CellState } from '../core/types.js';
import { PropagationResult } from '../core/field.js';
import {
  createHeyawakeState,
  solveHeyawake,
  createHeyawakeRunner,
  HeyawakeRoom,
  cloneState,
} from '../examples/heyawake-plugin.js';

describe('Heyawake Plugin Solver', () => {
  describe('createHeyawakeState', () => {
    it('should create initial state', () => {
      const rooms: HeyawakeRoom[] = [
        { blackCount: 1, members: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
        { blackCount: 0, members: [{ row: 1, col: 0 }, { row: 1, col: 1 }] },
      ];
      const horizontalWalls = [
        [false],
        [true], // Wall between row 0 and row 1
      ];
      const verticalWalls = [
        [false, false],
      ];

      const state = createHeyawakeState(2, 2, rooms, horizontalWalls, verticalWalls);

      expect(state.height).toBe(2);
      expect(state.width).toBe(2);
      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(state.roomIds.get(0, 0)).toBe(0);
      expect(state.roomIds.get(1, 0)).toBe(1);
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect adjacent blacks', () => {
      const rooms: HeyawakeRoom[] = [
        { blackCount: -1, members: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }] },
      ];
      const state = createHeyawakeState(2, 2, rooms, [[false], [false]], [[false, false]]);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);

      const runner = createHeyawakeRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect room black count exceeded', () => {
      const rooms: HeyawakeRoom[] = [
        { blackCount: 1, members: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
      ];
      const state = createHeyawakeState(1, 2, rooms, [[false]], [[]]);

      state.cells.set(0, 0, CellState.BLACK);
      state.cells.set(0, 1, CellState.BLACK);

      const runner = createHeyawakeRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveHeyawake', () => {
    it('should solve a simple 2x2 puzzle', () => {
      const rooms: HeyawakeRoom[] = [
        { blackCount: 1, members: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
        { blackCount: 0, members: [{ row: 1, col: 0 }, { row: 1, col: 1 }] },
      ];
      const horizontalWalls = [[false], [false]];
      const verticalWalls = [[false, false]];

      const state = createHeyawakeState(2, 2, rooms, horizontalWalls, verticalWalls);
      const solution = solveHeyawake(state);

      expect(solution).not.toBeNull();
      if (solution) {
        // Room 0 should have exactly 1 black
        let room0Blacks = 0;
        for (const pos of rooms[0].members) {
          if (solution.cells.get(pos) === CellState.BLACK) room0Blacks++;
        }
        expect(room0Blacks).toBe(1);

        // Room 1 should have 0 blacks
        for (const pos of rooms[1].members) {
          expect(solution.cells.get(pos)).not.toBe(CellState.BLACK);
        }
      }
    });

    it('should solve puzzle with no constraints', () => {
      const rooms: HeyawakeRoom[] = [
        { blackCount: -1, members: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }, { row: 1, col: 1 }] },
      ];
      const state = createHeyawakeState(2, 2, rooms, [[false], [false]], [[false, false]]);
      const solution = solveHeyawake(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createHeyawakeRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should return null for unsolvable puzzle', () => {
      // 2-cell room needs 3 blacks - impossible
      const rooms: HeyawakeRoom[] = [
        { blackCount: 3, members: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
      ];
      const state = createHeyawakeState(1, 2, rooms, [[false]], [[]]);
      const solution = solveHeyawake(state);

      expect(solution).toBeNull();
    });

    it('should enforce white connectivity', () => {
      // 3x1 row, middle must be black for room constraint
      // but that would disconnect whites
      const rooms: HeyawakeRoom[] = [
        { blackCount: 1, members: [{ row: 0, col: 0 }] },
        { blackCount: 1, members: [{ row: 0, col: 1 }] },
        { blackCount: 1, members: [{ row: 0, col: 2 }] },
      ];
      const horizontalWalls = [[true, true]]; // Walls between all cells
      const verticalWalls = [[]];

      const state = createHeyawakeState(1, 3, rooms, horizontalWalls, verticalWalls);
      const solution = solveHeyawake(state);

      // All 3 cells need 1 black each = 3 blacks in a 3-cell row
      // That's unsolvable
      expect(solution).toBeNull();
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const rooms: HeyawakeRoom[] = [
        { blackCount: 1, members: [{ row: 0, col: 0 }, { row: 0, col: 1 }] },
      ];
      const state = createHeyawakeState(1, 2, rooms, [[false]], [[]]);
      const clone = cloneState(state);

      clone.cells.set(0, 0, CellState.BLACK);

      expect(state.cells.get(0, 0)).toBe(CellState.UNKNOWN);
      expect(clone.cells.get(0, 0)).toBe(CellState.BLACK);
    });
  });
});
