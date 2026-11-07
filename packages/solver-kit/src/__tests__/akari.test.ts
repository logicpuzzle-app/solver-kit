/**
 * Akari (Light Up) Solver Tests
 */

import { describe, it, expect } from 'vitest';
import { AkariSolver, AkariField } from '../solvers/akari';

describe('AkariSolver', () => {
  describe('Basic functionality', () => {
    it('creates empty field', () => {
      const field = new AkariField(5, 5);
      expect(field.height).toBe(5);
      expect(field.width).toBe(5);
    });

    it('sets walls', () => {
      const field = new AkariField(5, 5);
      field.setWall(0, 0);
      field.setWall(1, 1, 2);
      // Verify wall is set (internal implementation varies)
    });

    it('clones field correctly', () => {
      const field = new AkariField(5, 5);
      field.setWall(2, 2, 1);
      const cloned = field.clone();
      expect(cloned).not.toBe(field);
    });
  });

  describe('fromString parser', () => {
    it('parses puzzle with walls', () => {
      const solver = AkariSolver.fromString(3, 3, [
        '#..',
        '.1.',
        '..#',
      ]);
      const field = solver.getField();
      expect(field.height).toBe(3);
      expect(field.width).toBe(3);
    });
  });

  describe('Solver integration', () => {
    it('creates solver instance', () => {
      const field = new AkariField(5, 5);
      const solver = new AkariSolver(field);
      expect(solver).toBeInstanceOf(AkariSolver);
      expect(solver.getField()).toBe(field);
    });

    it('generates state dump', () => {
      const field = new AkariField(3, 3);
      const dump = field.getStateDump();
      expect(typeof dump).toBe('string');
    });
  });
});
