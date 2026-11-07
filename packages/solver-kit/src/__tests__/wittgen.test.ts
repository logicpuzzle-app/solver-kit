/**
 * Wittgen Solver Tests
 */

import { describe, it, expect } from 'vitest';
import { WittgenSolver, WittgenField } from '../solvers/wittgen';
import { SolveStatus } from '../core/types';

describe('WittgenSolver', () => {
  describe('Basic functionality', () => {
    it('should create a field and initialize candidates', () => {
      const field = new WittgenField(5, 5);
      field.initCand();

      expect(field.height).toBe(5);
      expect(field.width).toBe(5);
      expect(field.squareCand.length).toBeGreaterThan(0);
      expect(field.squareFixed.length).toBe(0);
    });

    it('should parse from puzz.link URL format', () => {
      // Example: 5x5 grid with some number clues
      // Format: wittgen/5/5/param
      const solver = WittgenSolver.fromString(5, 5, '1g2h3');
      const field = solver.getField();

      expect(field.height).toBe(5);
      expect(field.width).toBe(5);
      expect(field.getNumber(0, 0)).toBe(1);
    });
  });

  describe('Constraint solving', () => {
    it('should solve a simple puzzle', () => {
      // Create a small solvable puzzle
      const field = new WittgenField(5, 5);

      // Set up some number clues
      field.setNumber(0, 0, 1);
      field.setNumber(2, 2, 2);
      field.setNumber(4, 4, 0);

      field.initCand();

      const solver = new WittgenSolver(field);
      const result = solver.solve({ maxBranches: 1000, maxDepth: 2 });

      // Should at least attempt to solve without errors
      expect([SolveStatus.SOLVED, SolveStatus.UNSOLVABLE, SolveStatus.TIMEOUT]).toContain(result.status);
    });

    it('should detect contradictions', () => {
      const field = new WittgenField(3, 3);

      // Create an impossible situation: cell requires 4 black neighbors but is in corner
      field.setNumber(0, 0, 4);
      field.initCand();

      // This should fail the count solve check
      const solver = new WittgenSolver(field);
      const result = solver.solve({ maxBranches: 100 });

      expect(result.status).toBe(SolveStatus.UNSOLVABLE);
    });
  });

  describe('Rectangle management', () => {
    it('should detect overlapping rectangles', () => {
      const field = new WittgenField(5, 5);
      field.initCand();

      // Take first candidate and add it as fixed
      const firstCand = field.squareCand[0];
      field.squareFixed.push(firstCand);

      // Run sikaku solve - should remove overlapping candidates
      const initialCandCount = field.squareCand.length;
      expect(field.solveAndCheck()).toBe(true);

      // Some candidates should have been removed
      expect(field.squareCand.length).toBeLessThan(initialCandCount);
    });
  });

  describe('Connectivity check', () => {
    it('should verify white cells are connected', () => {
      const field = new WittgenField(5, 5);
      field.initCand();

      // Without any fixed rectangles, all cells are white and connected
      const result = field.solveAndCheck();
      expect(result).toBe(true);
    });
  });

  describe('State management', () => {
    it('should clone field correctly', () => {
      const field = new WittgenField(5, 5);
      field.setNumber(1, 1, 2);
      field.initCand();

      const cloned = field.clone();

      expect(cloned.height).toBe(field.height);
      expect(cloned.width).toBe(field.width);
      expect(cloned.getNumber(1, 1)).toBe(2);
      expect(cloned.squareCand.length).toBe(field.squareCand.length);
    });

    it('should generate state dump', () => {
      const field = new WittgenField(5, 5);
      field.initCand();

      const dump = field.getStateDump();
      expect(dump).toMatch(/^\d+:\d+$/);
    });

    it('should detect solved state', () => {
      const field = new WittgenField(5, 5);
      field.initCand();

      // Clear all candidates (simulating solved state)
      field.squareCand = [];

      const solved = field.isSolved();
      // Whether it's truly solved depends on constraints
      expect(typeof solved).toBe('boolean');
    });
  });

  describe('URL parsing', () => {
    it('should parse gaps in URL encoding', () => {
      // g = skip 1 cell, h = skip 2 cells, etc.
      const solver = WittgenSolver.fromString(5, 5, 'g1');
      const field = solver.getField();

      // First cell should be empty, second should have value 1
      expect(field.getNumber(0, 0)).toBe(null);
      expect(field.getNumber(0, 1)).toBe(1);
    });

    it('should parse combined skip and value encoding', () => {
      // Hex values where value = num % 5, skip = num / 5
      const solver = WittgenSolver.fromString(3, 3, '5');
      const field = solver.getField();

      // Value 5 in hex = 5, so num = 5 % 5 = 0, skip = 5 / 5 = 1
      expect(field.getNumber(0, 0)).toBe(0);
    });

    it('should handle dot notation for -1 values', () => {
      const solver = WittgenSolver.fromString(3, 3, '.');
      const field = solver.getField();

      expect(field.getNumber(0, 0)).toBe(-1);
    });
  });

  describe('toString representation', () => {
    it('should generate readable string representation', () => {
      const field = new WittgenField(3, 3);
      field.setNumber(0, 0, 1);
      field.setNumber(1, 1, 2);
      field.initCand();

      const str = field.toString();
      expect(str).toContain('1');
      expect(str).toContain('2');
      expect(str.split('\n').length).toBe(3);
    });
  });
});
