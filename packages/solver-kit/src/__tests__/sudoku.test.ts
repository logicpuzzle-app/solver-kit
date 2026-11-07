/**
 * Sudoku Solver Tests
 */

import { describe, it, expect } from 'vitest';
import { SudokuSolver, SudokuField } from '../solvers/sudoku';
import { SolveStatus } from '../core/types';

describe('SudokuSolver', () => {
  describe('Basic functionality', () => {
    it('creates empty field', () => {
      const field = new SudokuField(9);
      expect(field.height).toBe(9);
      expect(field.width).toBe(9);
    });

    it('sets and gets numbers', () => {
      const field = new SudokuField(9);
      field.setNumber(0, 0, 5);
      expect(field.getValue(0, 0)).toBe(5);
    });

    it('clones field correctly', () => {
      const field = new SudokuField(9);
      field.setNumber(1, 1, 3);
      const cloned = field.clone();
      expect(cloned.getValue(1, 1)).toBe(3);
      expect(cloned).not.toBe(field);
    });
  });

  describe('fromString parser', () => {
    it('parses simple puzzle', () => {
      const solver = SudokuSolver.fromString(4, '1234');
      const field = solver.getField();
      expect(field.getValue(0, 0)).toBe(1);
      expect(field.getValue(0, 1)).toBe(2);
      expect(field.getValue(0, 2)).toBe(3);
      expect(field.getValue(0, 3)).toBe(4);
    });

    it('parses dots as empty cells', () => {
      const solver = SudokuSolver.fromString(4, '1...');
      const field = solver.getField();
      expect(field.getValue(0, 0)).toBe(1);
      expect(field.getValue(0, 1)).toBeNull();
    });
  });

  describe('Solver integration', () => {
    it('creates solver instance', () => {
      const field = new SudokuField(4);
      const solver = new SudokuSolver(field);
      expect(solver).toBeInstanceOf(SudokuSolver);
      expect(solver.getField()).toBe(field);
    });

    it('generates state dump', () => {
      const field = new SudokuField(4);
      const dump = field.getStateDump();
      expect(dump).toMatch(/^[0-9]+$/);
    });
  });
});
