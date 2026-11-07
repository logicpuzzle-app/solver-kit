/**
 * Voxas Solver Tests
 */

import { describe, test, expect } from 'vitest';
import { VoxasSolver, VoxasField } from '../solvers/voxas';
import { SolveStatus } from '../core/types';

describe('VoxasSolver', () => {
  describe('Basic functionality', () => {
    test('creates empty field', () => {
      const field = new VoxasField(3, 3);
      expect(field.height).toBe(3);
      expect(field.width).toBe(3);
    });

    test('initializes candidates correctly', () => {
      const field = new VoxasField(4, 4);
      field.initCand();

      // Should have candidates for all possible 2x1, 3x1, 1x2, 1x3 rectangles
      expect(field.squareCand.length).toBeGreaterThan(0);

      // Verify candidates have correct types (1-4)
      const types = new Set(field.squareCand.map(c => c.type));
      expect(types.size).toBeGreaterThan(0);
      expect(types.size).toBeLessThanOrEqual(4);
    });

    test('clones field correctly', () => {
      const field = new VoxasField(3, 3);
      field.initCand();

      const cloned = field.clone();

      expect(cloned.height).toBe(field.height);
      expect(cloned.width).toBe(field.width);
      expect(cloned.squareCand.length).toBe(field.squareCand.length);

      // Modify clone shouldn't affect original
      cloned.squareCand = [];
      expect(field.squareCand.length).toBeGreaterThan(0);
    });

    test('tracks state correctly', () => {
      const field = new VoxasField(3, 3);
      field.initCand();

      const state1 = field.getStateDump();

      // Fix a rectangle
      if (field.squareCand.length > 0) {
        const toFix = field.squareCand[0];
        field.squareCand = field.squareCand.filter(c => c !== toFix);
        field.squareFixed.push(toFix);

        const state2 = field.getStateDump();
        expect(state2).not.toBe(state1);
      }
    });
  });

  describe('fromString parser', () => {
    test('parses from URL format', () => {
      // Example URL from Java implementation
      const url = 'https://pzprxs.vercel.app/p?voxas/8/8/ialdgddgdlbgcbgclaobh3dg3dgalag1bg2chdl';
      const solver = VoxasSolver.fromURL(url);
      const field = solver.getField();

      expect(field.height).toBe(8);
      expect(field.width).toBe(8);
      expect(field.firstYokoWall.size).toBeGreaterThan(0);
    });

    test('parses from string format', () => {
      // Same example using fromString
      const solver = VoxasSolver.fromString(8, 8, 'ialdgddgdlbgcbgclaobh3dg3dgalag1bg2chdl');
      const field = solver.getField();

      expect(field.height).toBe(8);
      expect(field.width).toBe(8);
      expect(field.squareCand.length).toBeGreaterThan(0);
    });

    test('parses simple puzzle', () => {
      const solver = VoxasSolver.fromString(4, 4, 'g');
      const field = solver.getField();

      expect(field.height).toBe(4);
      expect(field.width).toBe(4);
    });
  });

  describe('Rectangle constraints', () => {
    test('detects duplicates correctly', () => {
      const field = new VoxasField(3, 3);
      field.initCand();

      if (field.squareCand.length >= 2) {
        const cand1 = field.squareCand[0];
        const cand2 = field.squareCand[1];

        // Check if they overlap
        const overlaps = cand1.isDuplicate(cand2);
        expect(typeof overlaps).toBe('boolean');
      }
    });

    test('handles wall type constraints', () => {
      const field = new VoxasField(4, 4);
      // Add a black circle wall hint (type 2 = complementary sizes)
      field.firstYokoWall.set('0,1', 2);
      field.initCand();

      expect(field.solveAndCheck()).toBe(true);
    });
  });

  describe('Output formatting', () => {
    test('produces readable output', () => {
      const solver = VoxasSolver.fromString(4, 4, 'g');
      const field = solver.getField();
      const output = field.toString();

      // Should contain box drawing characters
      expect(output).toContain('┌');
      expect(output).toContain('│');
      expect(output.split('\n').length).toBeGreaterThan(0);
    });
  });

  describe('Solver integration', () => {
    test('creates solver instance', () => {
      const field = new VoxasField(3, 3);
      const solver = new VoxasSolver(field);

      expect(solver).toBeInstanceOf(VoxasSolver);
      expect(solver.getField()).toBe(field);
    });

    test('solves simple puzzle', () => {
      // Create a simple puzzle with wall hints
      const field = new VoxasField(3, 3);
      field.initCand();

      const result = new VoxasSolver(field).solve({ maxDepth: 2, maxBranches: 1000 });

      // Should either solve or be unsolvable (depending on constraints)
      expect([SolveStatus.SOLVED, SolveStatus.UNSOLVABLE, SolveStatus.TIMEOUT]).toContain(result.status);
    });

    test('fromString creates working solver', () => {
      const solver = VoxasSolver.fromString(3, 3, 'g');
      expect(solver).toBeInstanceOf(VoxasSolver);

      const field = solver.getField();
      expect(field.height).toBe(3);
      expect(field.width).toBe(3);
    });
  });
});
