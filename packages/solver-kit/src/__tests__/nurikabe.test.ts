/**
 * Nurikabe Solver Tests
 */

import { describe, it, expect } from 'vitest';
import { NurikabeSolver, NurikabeField } from '../solvers/nurikabe';
import { CellState } from '../core/types';

describe('NurikabeSolver', () => {
  describe('Basic functionality', () => {
    it('creates empty field', () => {
      const field = new NurikabeField(5, 5);
      expect(field.height).toBe(5);
      expect(field.width).toBe(5);
    });

    it('sets and gets numbers', () => {
      const field = new NurikabeField(5, 5);
      field.setNumber(1, 1, 3);
      expect(field.getNumber(1, 1)).toBe(3);
      // Setting a number also marks the cell as white
      expect(field.getCell(1, 1)).toBe(CellState.WHITE);
    });

    it('sets cells to black and white', () => {
      const field = new NurikabeField(5, 5);
      field.setBlack(0, 0);
      field.setWhite(0, 1);
      expect(field.getCell(0, 0)).toBe(CellState.BLACK);
      expect(field.getCell(0, 1)).toBe(CellState.WHITE);
    });

    it('clones field correctly', () => {
      const field = new NurikabeField(5, 5);
      field.setNumber(2, 2, 4);
      const cloned = field.clone();
      expect(cloned.getNumber(2, 2)).toBe(4);
      expect(cloned).not.toBe(field);
    });
  });

  describe('fromString parser', () => {
    it('parses puzzle with numbers', () => {
      const solver = NurikabeSolver.fromString(3, 3, [
        '1..',
        '...',
        '..2',
      ]);
      const field = solver.getField();
      expect(field.getNumber(0, 0)).toBe(1);
      expect(field.getNumber(2, 2)).toBe(2);
      expect(field.getNumber(1, 1)).toBeNull();
    });
  });

  describe('Solver integration', () => {
    it('creates solver instance', () => {
      const field = new NurikabeField(5, 5);
      const solver = new NurikabeSolver(field);
      expect(solver).toBeInstanceOf(NurikabeSolver);
      expect(solver.getField()).toBe(field);
    });

    it('generates state dump', () => {
      const field = new NurikabeField(3, 3);
      const dump = field.getStateDump();
      expect(typeof dump).toBe('string');
    });
  });
});
