/**
 * Tests for Kropki plugin solver
 */

import { describe, it, expect } from 'vitest';
import { PropagationResult } from '../core/field.js';
import {
  createKropkiState,
  solveKropki,
  createKropkiRunner,
  cloneState,
} from '../examples/kropki-plugin.js';

describe('Kropki Plugin Solver', () => {
  describe('createKropkiState', () => {
    it('should create initial state with dots', () => {
      const state = createKropkiState(
        3,
        [{ row: 0, col: 0, type: 'white' }],
        [{ row: 0, col: 0, type: 'black' }]
      );

      expect(state.size).toBe(3);
      expect(state.hDots.get(0, 0)).toBe('white');
      expect(state.hDots.get(0, 1)).toBe('none');
      expect(state.vDots.get(0, 0)).toBe('black');
      expect(state.vDots.get(0, 1)).toBe('none');
    });

    it('should initialize all cells with full candidates', () => {
      const state = createKropkiState(3, [], []);

      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const cell = state.candidates.get(row, col);
          expect(cell.has(1)).toBe(true);
          expect(cell.has(2)).toBe(true);
          expect(cell.has(3)).toBe(true);
        }
      }
    });

    it('should handle given values', () => {
      const state = createKropkiState(3, [], [], [{ row: 0, col: 0, value: 2 }]);

      expect(state.candidates.get(0, 0).isDetermined()).toBe(true);
      expect(state.candidates.get(0, 0).getValue()).toBe(2);
    });
  });

  describe('ConstraintRunner', () => {
    it('should detect row uniqueness violation', () => {
      const state = createKropkiState(
        3,
        [],
        [],
        [
          { row: 0, col: 0, value: 1 },
          { row: 0, col: 1, value: 1 },
        ]
      );

      const runner = createKropkiRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect white dot violation', () => {
      // White dot requires difference of 1
      // 1 and 3 differ by 2 - violation
      const state = createKropkiState(
        3,
        [{ row: 0, col: 0, type: 'white' }],
        [],
        [
          { row: 0, col: 0, value: 1 },
          { row: 0, col: 1, value: 3 },
        ]
      );

      const runner = createKropkiRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect black dot violation', () => {
      // Black dot requires one is double
      // 1 and 3 don't satisfy (1*2=2, 3*2=6)
      const state = createKropkiState(
        3,
        [{ row: 0, col: 0, type: 'black' }],
        [],
        [
          { row: 0, col: 0, value: 1 },
          { row: 0, col: 1, value: 3 },
        ]
      );

      const runner = createKropkiRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should detect no-dot violation', () => {
      // No dot means neither white nor black applies
      // 1 and 2: white (differ by 1) and black (2=1*2) both apply
      const state = createKropkiState(
        3,
        [], // No horizontal dot at (0,0)
        [],
        [
          { row: 0, col: 0, value: 1 },
          { row: 0, col: 1, value: 2 },
        ]
      );

      const runner = createKropkiRunner();
      const { result } = runner.run(state);
      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid white dot', () => {
      // 2 and 3 differ by 1 - valid white dot
      const state = createKropkiState(
        3,
        [{ row: 0, col: 0, type: 'white' }],
        [],
        [
          { row: 0, col: 0, value: 2 },
          { row: 0, col: 1, value: 3 },
        ]
      );

      const runner = createKropkiRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });

    it('should allow valid black dot', () => {
      // 1 and 2: 2 = 1*2 - valid black dot
      const state = createKropkiState(
        3,
        [{ row: 0, col: 0, type: 'black' }],
        [],
        [
          { row: 0, col: 0, value: 1 },
          { row: 0, col: 1, value: 2 },
        ]
      );

      const runner = createKropkiRunner();
      const { result } = runner.run(state);
      expect(result).not.toBe(PropagationResult.CONTRADICTION);
    });
  });

  describe('solveKropki', () => {
    it('should solve a simple 2x2 with no dots', () => {
      // No dots means all adjacent pairs must satisfy "none"
      // For 2x2 (values 1,2), 1-2 always have white/black relation
      // So no valid solution exists
      const state = createKropkiState(2, [], []);
      const solution = solveKropki(state);

      // Actually for 2x2 with values 1,2:
      // Any valid Latin square will have 1,2 adjacent - which violates "no dot"
      expect(solution).toBeNull();
    });

    it('should solve a 2x2 with proper dots', () => {
      // 2x2 Latin square with proper dots
      // Solution: 1 2
      //           2 1
      // All adjacent pairs are 1-2 (black dot)
      const state = createKropkiState(
        2,
        [
          { row: 0, col: 0, type: 'black' }, // 1-2 horizontal (row 0)
          { row: 1, col: 0, type: 'black' }, // 2-1 horizontal (row 1)
        ],
        [
          { row: 0, col: 0, type: 'black' }, // 1-2 vertical
          { row: 0, col: 1, type: 'black' }, // 2-1 vertical
        ]
      );

      const solution = solveKropki(state);

      expect(solution).not.toBeNull();
      if (solution) {
        const runner = createKropkiRunner();
        expect(runner.checkAll(solution)).toBe(true);
      }
    });

    it('should verify a valid solution', () => {
      // Set up a valid 2x2: 1 2 / 2 1 with black dots
      const state = createKropkiState(
        2,
        [{ row: 0, col: 0, type: 'black' }, { row: 1, col: 0, type: 'black' }],
        [{ row: 0, col: 0, type: 'black' }, { row: 0, col: 1, type: 'black' }],
        [
          { row: 0, col: 0, value: 1 },
          { row: 0, col: 1, value: 2 },
          { row: 1, col: 0, value: 2 },
          { row: 1, col: 1, value: 1 },
        ]
      );

      const runner = createKropkiRunner();
      expect(runner.checkAll(state)).toBe(true);
    });
  });

  describe('cloneState', () => {
    it('should create independent copy', () => {
      const state = createKropkiState(2, [], []);
      const clone = cloneState(state);

      clone.candidates.get(0, 0).setTo(1);

      expect(state.candidates.get(0, 0).isDetermined()).toBe(false);
      expect(clone.candidates.get(0, 0).isDetermined()).toBe(true);
    });
  });
});
