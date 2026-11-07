/**
 * Registry System Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PluginRegistry,
  ConstraintRegistry,
  ViewRegistry,
  HeuristicRegistry,
  GeneratorRegistry,
  Constraint,
  View,
  Heuristic,
  Generator,
  PropagationResult,
  createConstraintRegistry,
  createViewRegistry,
  createHeuristicRegistry,
  createGeneratorRegistry,
} from './registry';

describe('PluginRegistry', () => {
  let registry: PluginRegistry<{ value: number }, { result: number }>;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe('registration', () => {
    it('registers a plugin', () => {
      registry.register('test', (params) => ({ result: params.value * 2 }));
      expect(registry.has('test')).toBe(true);
    });

    it('throws on duplicate registration', () => {
      registry.register('test', (params) => ({ result: params.value }));
      expect(() => registry.register('test', (params) => ({ result: params.value }))).toThrow();
    });

    it('lists registered plugins', () => {
      registry.register('a', () => ({ result: 1 }));
      registry.register('b', () => ({ result: 2 }));
      expect(registry.list()).toContain('a');
      expect(registry.list()).toContain('b');
    });
  });

  describe('creation', () => {
    it('creates a plugin instance', () => {
      registry.register('double', (params) => ({ result: params.value * 2 }));
      const plugin = registry.create('double', { value: 5 });
      expect(plugin.result).toBe(10);
    });

    it('throws on unknown plugin', () => {
      expect(() => registry.create('unknown', { value: 1 })).toThrow();
    });
  });

  describe('management', () => {
    it('unregisters a plugin', () => {
      registry.register('test', () => ({ result: 1 }));
      expect(registry.unregister('test')).toBe(true);
      expect(registry.has('test')).toBe(false);
    });

    it('clears all plugins', () => {
      registry.register('a', () => ({ result: 1 }));
      registry.register('b', () => ({ result: 2 }));
      registry.clear();
      expect(registry.list()).toHaveLength(0);
    });
  });
});

describe('ConstraintRegistry', () => {
  interface TestState {
    value: number;
  }

  it('creates multiple constraints from specs', () => {
    const registry = createConstraintRegistry<TestState>();

    const mockConstraint: Constraint<TestState> = {
      type: 'test',
      name: 'Test Constraint',
      propagate: () => PropagationResult.NO_CHANGE,
      isSatisfied: () => true,
    };

    registry.register('test', () => mockConstraint);

    const constraints = registry.createAll([
      { type: 'test', params: {} },
      { type: 'test', params: {} },
    ]);

    expect(constraints).toHaveLength(2);
    expect(constraints[0].type).toBe('test');
  });
});

describe('ViewRegistry', () => {
  interface TestState {
    data: number[];
  }

  it('creates views with caching support', () => {
    const registry = createViewRegistry<TestState>();

    const sumView: View<TestState, number> = {
      type: 'sum',
      compute: (state) => state.data.reduce((a, b) => a + b, 0),
      getDependencyKeys: (state) => [state.data.join(',')],
    };

    registry.register('sum', () => sumView);

    const view = registry.create('sum', {});
    expect(view.type).toBe('sum');

    const result = view.compute({ data: [1, 2, 3] });
    expect(result).toBe(6);
  });
});

describe('HeuristicRegistry', () => {
  interface TestState {
    value: number;
  }

  it('creates heuristics for branch ordering', () => {
    const registry = createHeuristicRegistry<TestState>();

    const minFirst: Heuristic<TestState> = {
      type: 'min-first',
      name: 'Minimum First',
      orderBranches: (state, candidates) => {
        return candidates.map((c, i) => ({
          ...c,
          score: -i, // Reverse order for testing
        }));
      },
    };

    registry.register('min-first', () => minFirst);

    const heuristic = registry.create('min-first', {});
    expect(heuristic.type).toBe('min-first');
  });
});

describe('GeneratorRegistry', () => {
  interface TestState {
    grid: number[][];
  }

  it('creates generators', () => {
    const registry = createGeneratorRegistry<TestState>();

    const randomGen: Generator<TestState> = {
      type: 'random',
      name: 'Random Generator',
      generate: (width, height) => ({
        puzzle: { grid: Array(height).fill(null).map(() => Array(width).fill(0)) },
        solution: { grid: Array(height).fill(null).map(() => Array(width).fill(1)) },
        metadata: { attempts: 1, clueCount: 0 },
      }),
    };

    registry.register('random', () => randomGen);

    const gen = registry.create('random', {});
    const result = gen.generate(3, 3);

    expect(result).not.toBeNull();
    expect(result?.puzzle.grid).toHaveLength(3);
    expect(result?.puzzle.grid[0]).toHaveLength(3);
  });
});
