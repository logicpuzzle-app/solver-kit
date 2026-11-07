/**
 * Masyu Solver Tests
 */

import { describe, it, expect } from 'vitest';
import { MasyuSolver, MasyuField, PearlType } from '../solvers/masyu';
import { EdgeState, Direction } from '../core/types';

describe('MasyuSolver', () => {
  describe('Basic functionality', () => {
    it('creates empty field', () => {
      const field = new MasyuField(5, 5);
      expect(field.height).toBe(5);
      expect(field.width).toBe(5);
    });

    it('sets and gets pearls', () => {
      const field = new MasyuField(5, 5);
      field.setPearl(1, 1, PearlType.WHITE);
      field.setPearl(2, 2, PearlType.BLACK);
      expect(field.getPearl(1, 1)).toBe(PearlType.WHITE);
      expect(field.getPearl(2, 2)).toBe(PearlType.BLACK);
      expect(field.getPearl(0, 0)).toBe(PearlType.NONE);
    });

    it('sets and gets edges', () => {
      const field = new MasyuField(5, 5);
      field.setEdge(0, 0, Direction.RIGHT, EdgeState.LINE);
      expect(field.getEdge(0, 0, Direction.RIGHT)).toBe(EdgeState.LINE);
    });

    it('clones field correctly', () => {
      const field = new MasyuField(5, 5);
      field.setPearl(2, 2, PearlType.BLACK);
      const cloned = field.clone();
      expect(cloned.getPearl(2, 2)).toBe(PearlType.BLACK);
      expect(cloned).not.toBe(field);
    });
  });

  describe('fromString parser', () => {
    it('parses puzzle with pearls', () => {
      const solver = MasyuSolver.fromString(3, 3, [
        'o..',
        '.b.',
        '..w',
      ]);
      const field = solver.getField();
      expect(field.getPearl(0, 0)).toBe(PearlType.WHITE); // 'o' = white
      expect(field.getPearl(1, 1)).toBe(PearlType.BLACK); // 'b' = black
      expect(field.getPearl(2, 2)).toBe(PearlType.WHITE); // 'w' = white
    });
  });

  describe('Solver integration', () => {
    it('creates solver instance', () => {
      const field = new MasyuField(5, 5);
      const solver = new MasyuSolver(field);
      expect(solver).toBeInstanceOf(MasyuSolver);
      expect(solver.getField()).toBe(field);
    });

    it('generates state dump', () => {
      const field = new MasyuField(3, 3);
      const dump = field.getStateDump();
      expect(typeof dump).toBe('string');
    });
  });
});
