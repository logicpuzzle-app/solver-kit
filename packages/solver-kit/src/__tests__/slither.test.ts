/**
 * Slither Link Solver Tests
 */

import { describe, it, expect } from 'vitest';
import { SlitherSolver, SlitherField } from '../solvers/slither';
import { EdgeState } from '../core/types';

describe('SlitherSolver', () => {
  describe('Basic functionality', () => {
    it('creates empty field', () => {
      const field = new SlitherField(5, 5);
      expect(field.height).toBe(5);
      expect(field.width).toBe(5);
    });

    it('sets and gets numbers', () => {
      const field = new SlitherField(5, 5);
      field.setNumber(1, 1, 3);
      expect(field.getNumber(1, 1)).toBe(3);
    });

    it('sets and gets edges', () => {
      const field = new SlitherField(5, 5);
      field.setHorizontalEdge(0, 0, EdgeState.LINE);
      expect(field.getHorizontalEdge(0, 0)).toBe(EdgeState.LINE);
    });

    it('clones field correctly', () => {
      const field = new SlitherField(5, 5);
      field.setNumber(2, 2, 2);
      const cloned = field.clone();
      expect(cloned.getNumber(2, 2)).toBe(2);
      expect(cloned).not.toBe(field);
    });
  });

  describe('fromString parser', () => {
    it('parses puzzle with numbers', () => {
      const solver = SlitherSolver.fromString(3, 3, [
        '123',
        '0.0',
        '321',
      ]);
      const field = solver.getField();
      expect(field.getNumber(0, 0)).toBe(1);
      expect(field.getNumber(0, 1)).toBe(2);
      expect(field.getNumber(0, 2)).toBe(3);
      expect(field.getNumber(1, 0)).toBe(0);
      expect(field.getNumber(1, 1)).toBeNull();
    });
  });

  describe('Solver integration', () => {
    it('creates solver instance', () => {
      const field = new SlitherField(5, 5);
      const solver = new SlitherSolver(field);
      expect(solver).toBeInstanceOf(SlitherSolver);
      expect(solver.getField()).toBe(field);
    });

    it('generates state dump', () => {
      const field = new SlitherField(3, 3);
      const dump = field.getStateDump();
      expect(typeof dump).toBe('string');
    });
  });
});
