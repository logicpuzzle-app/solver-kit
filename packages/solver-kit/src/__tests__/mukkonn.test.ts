/**
 * Mukkonn Solver Tests
 */

import { describe, test, expect } from 'vitest';
import { MukokonnSolver, MukokonnField, MukokonnCompass } from '../solvers/mukkonn';
import { SolveStatus } from '../core/types';

describe('MukokonnSolver', () => {
  describe('Basic functionality', () => {
    test('creates empty field', () => {
      const field = new MukokonnField(3, 3);
      expect(field.height).toBe(3);
      expect(field.width).toBe(3);
    });

    test('sets and gets compass', () => {
      const field = new MukokonnField(3, 3);
      const compass: MukokonnCompass = { up: 1, right: 2, down: 1, left: 0 };
      field.setCompass(1, 1, compass);

      const retrieved = field.getCompass(1, 1);
      expect(retrieved).toEqual(compass);
    });

    test('clones field correctly', () => {
      const field = new MukokonnField(3, 3);
      const compass: MukokonnCompass = { up: 1, right: -1, down: 2, left: 1 };
      field.setCompass(0, 0, compass);

      const cloned = field.clone();
      expect(cloned.getCompass(0, 0)).toEqual(compass);
      expect(cloned).not.toBe(field);
    });
  });

  describe('fromString parser', () => {
    test('parses simple puzzle from puzz.link format', () => {
      // Simple 3x3 puzzle with one compass at (0,0)
      // Format: up/down/left/right
      const solver = MukokonnSolver.fromString(3, 3, '1010g');
      const field = solver.getField();

      const compass = field.getCompass(0, 0);
      expect(compass).not.toBeNull();
      expect(compass?.up).toBe(1);
      expect(compass?.down).toBe(0);
      expect(compass?.left).toBe(1);
      expect(compass?.right).toBe(0);
    });

    test('parses puzzle with gaps', () => {
      // 3x3 with compass at position 2 (skipping first 2 cells with 'h')
      const solver = MukokonnSolver.fromString(3, 3, 'h2121');
      const field = solver.getField();

      expect(field.getCompass(0, 0)).toBeNull();
      expect(field.getCompass(0, 1)).toBeNull();

      const compass = field.getCompass(0, 2);
      expect(compass).not.toBeNull();
      expect(compass?.up).toBe(2);
      expect(compass?.down).toBe(1);
      expect(compass?.left).toBe(2);
      expect(compass?.right).toBe(1);
    });

    test('parses puzzle with no-constraint directions', () => {
      // Compass with some directions unconstrained (.)
      const solver = MukokonnSolver.fromString(2, 2, '.1.2');
      const field = solver.getField();

      const compass = field.getCompass(0, 0);
      expect(compass?.up).toBe(-1);  // . means no constraint
      expect(compass?.down).toBe(1);
      expect(compass?.left).toBe(-1);
      expect(compass?.right).toBe(2);
    });
  });

  describe('Constraint solving', () => {
    test('field clones correctly', () => {
      const field = new MukokonnField(3, 3);
      const compass: MukokonnCompass = { up: 0, right: 0, down: 0, left: 0 };
      field.setCompass(0, 0, compass);
      const cloned = field.clone();
      expect(cloned.getCompass(0, 0)).toEqual(compass);
    });

    test('field generates state dump', () => {
      const field = new MukokonnField(3, 3);
      const dump = field.getStateDump();
      expect(typeof dump).toBe('string');
    });
  });

  describe('Solver integration', () => {
    test('creates solver instance', () => {
      const field = new MukokonnField(3, 3);
      const solver = new MukokonnSolver(field);

      expect(solver).toBeInstanceOf(MukokonnSolver);
      expect(solver.getField()).toBe(field);
    });

    test('fromString creates working solver', () => {
      const solver = MukokonnSolver.fromString(3, 3, '1111');
      expect(solver).toBeInstanceOf(MukokonnSolver);

      const field = solver.getField();
      expect(field.height).toBe(3);
      expect(field.width).toBe(3);
    });
  });
});
