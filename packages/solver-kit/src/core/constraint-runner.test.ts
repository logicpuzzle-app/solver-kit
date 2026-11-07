/**
 * Constraint Runner Tests
 */

import { describe, it, expect } from 'vitest';
import { ConstraintRunner, createRunner, RunStats } from './constraint-runner';
import { Constraint, PropagationResult, View } from './registry';

interface TestState {
  value: number;
  changed: boolean;
}

describe('ConstraintRunner', () => {
  describe('basic execution', () => {
    it('runs constraints until fixpoint', () => {
      const runner = new ConstraintRunner<TestState>();

      let callCount = 0;
      const constraint: Constraint<TestState> = {
        type: 'increment',
        name: 'Increment',
        propagate: (state) => {
          callCount++;
          if (state.value < 3) {
            state.value++;
            return PropagationResult.CHANGED;
          }
          return PropagationResult.NO_CHANGE;
        },
        isSatisfied: (state) => state.value >= 3,
      };

      runner.addConstraint(constraint);

      const state: TestState = { value: 0, changed: false };
      const { result, stats } = runner.run(state);

      expect(result).toBe(PropagationResult.NO_CHANGE);
      expect(state.value).toBe(3);
      expect(stats.rounds).toBe(4); // 3 changes + 1 no-change
    });

    it('detects contradictions', () => {
      const runner = new ConstraintRunner<TestState>();

      const constraint: Constraint<TestState> = {
        type: 'fail',
        name: 'Always Fail',
        propagate: () => PropagationResult.CONTRADICTION,
        isSatisfied: () => false,
      };

      runner.addConstraint(constraint);

      const state: TestState = { value: 0, changed: false };
      const { result } = runner.run(state);

      expect(result).toBe(PropagationResult.CONTRADICTION);
    });

    it('respects max rounds', () => {
      const runner = new ConstraintRunner<TestState>({ maxRounds: 5 });

      const constraint: Constraint<TestState> = {
        type: 'always-change',
        name: 'Always Change',
        propagate: (state) => {
          state.value++;
          return PropagationResult.CHANGED;
        },
        isSatisfied: () => false,
      };

      runner.addConstraint(constraint);

      const state: TestState = { value: 0, changed: false };
      const { stats } = runner.run(state);

      expect(stats.rounds).toBe(5);
    });
  });

  describe('multiple constraints', () => {
    it('runs multiple constraints per round', () => {
      const runner = new ConstraintRunner<TestState>();

      const c1: Constraint<TestState> = {
        type: 'c1',
        name: 'C1',
        propagate: (state) => {
          if (state.value < 2) {
            state.value++;
            return PropagationResult.CHANGED;
          }
          return PropagationResult.NO_CHANGE;
        },
        isSatisfied: () => true,
      };

      const c2: Constraint<TestState> = {
        type: 'c2',
        name: 'C2',
        propagate: (state) => {
          if (state.value >= 2 && !state.changed) {
            state.changed = true;
            return PropagationResult.CHANGED;
          }
          return PropagationResult.NO_CHANGE;
        },
        isSatisfied: () => true,
      };

      runner.addConstraints([c1, c2]);

      const state: TestState = { value: 0, changed: false };
      runner.run(state);

      expect(state.value).toBe(2);
      expect(state.changed).toBe(true);
    });
  });

  describe('satisfaction check', () => {
    it('checks if all constraints are satisfied', () => {
      const runner = new ConstraintRunner<TestState>();

      runner.addConstraint({
        type: 'positive',
        name: 'Positive',
        propagate: () => PropagationResult.NO_CHANGE,
        isSatisfied: (state) => state.value > 0,
      });

      expect(runner.checkAll({ value: 1, changed: false })).toBe(true);
      expect(runner.checkAll({ value: 0, changed: false })).toBe(false);
    });

    it('returns unsatisfied constraints', () => {
      const runner = new ConstraintRunner<TestState>();

      const c1: Constraint<TestState> = {
        type: 'always-satisfied',
        name: 'Always Satisfied',
        propagate: () => PropagationResult.NO_CHANGE,
        isSatisfied: () => true,
      };

      const c2: Constraint<TestState> = {
        type: 'never-satisfied',
        name: 'Never Satisfied',
        propagate: () => PropagationResult.NO_CHANGE,
        isSatisfied: () => false,
      };

      runner.addConstraints([c1, c2]);

      const unsatisfied = runner.getUnsatisfied({ value: 0, changed: false });
      expect(unsatisfied).toHaveLength(1);
      expect(unsatisfied[0].type).toBe('never-satisfied');
    });
  });

  describe('view caching', () => {
    it('caches view computations', () => {
      const runner = new ConstraintRunner<TestState>();

      let computeCount = 0;
      const view: View<TestState, number> = {
        type: 'double',
        compute: (state) => {
          computeCount++;
          return state.value * 2;
        },
        getDependencyKeys: (state) => [String(state.value)],
      };

      runner.addView(view);

      const state: TestState = { value: 5, changed: false };

      // First call computes
      const v1 = runner.getView<number>(state, 'double');
      expect(v1).toBe(10);
      expect(computeCount).toBe(1);

      // Second call with same state uses cache
      const v2 = runner.getView<number>(state, 'double');
      expect(v2).toBe(10);
      expect(computeCount).toBe(1);

      // Change state, should recompute
      state.value = 10;
      const v3 = runner.getView<number>(state, 'double');
      expect(v3).toBe(20);
      expect(computeCount).toBe(2);
    });
  });

  describe('cloning', () => {
    it('clones runner with same constraints', () => {
      const runner = new ConstraintRunner<TestState>();

      runner.addConstraint({
        type: 'test',
        name: 'Test',
        propagate: () => PropagationResult.NO_CHANGE,
        isSatisfied: () => true,
      });

      const cloned = runner.clone();
      expect(cloned.checkAll({ value: 0, changed: false })).toBe(true);
    });
  });
});

describe('createRunner', () => {
  it('creates runner with initial constraints', () => {
    const constraints: Constraint<TestState>[] = [
      {
        type: 'a',
        name: 'A',
        propagate: () => PropagationResult.NO_CHANGE,
        isSatisfied: () => true,
      },
      {
        type: 'b',
        name: 'B',
        propagate: () => PropagationResult.NO_CHANGE,
        isSatisfied: () => true,
      },
    ];

    const runner = createRunner(constraints);
    expect(runner.checkAll({ value: 0, changed: false })).toBe(true);
  });
});
