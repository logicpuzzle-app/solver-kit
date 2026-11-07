/**
 * Constraint Runner
 *
 * Manages constraint execution with dependency tracking and caching.
 * Implements the propagate-until-fixpoint pattern.
 */

import { Constraint, PropagationResult, View } from './registry.js';

/**
 * Statistics from a constraint run
 */
export interface RunStats {
  /** Total propagation rounds */
  rounds: number;
  /** Constraints fired per type */
  constraintsFired: Map<string, number>;
  /** Total time in milliseconds */
  timeMs: number;
  /** Final result */
  result: PropagationResult;
}

/**
 * Options for constraint runner
 */
export interface RunnerOptions {
  /** Maximum propagation rounds before giving up */
  maxRounds?: number;
  /** Enable detailed logging */
  debug?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
}

const DEFAULT_OPTIONS: Required<RunnerOptions> = {
  maxRounds: 1000,
  debug: false,
  timeout: 30000,
};

/**
 * Runs constraints until fixpoint or contradiction
 */
export class ConstraintRunner<TState> {
  private constraints: Constraint<TState>[] = [];
  private views: View<TState, unknown>[] = [];
  private viewCache = new Map<string, { value: unknown; keys: string[] }>();
  private options: Required<RunnerOptions>;

  constructor(options?: RunnerOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Add a constraint to the runner
   */
  addConstraint(constraint: Constraint<TState>): this {
    this.constraints.push(constraint);
    return this;
  }

  /**
   * Add multiple constraints
   */
  addConstraints(constraints: Constraint<TState>[]): this {
    this.constraints.push(...constraints);
    return this;
  }

  /**
   * Add a view to the runner
   */
  addView(view: View<TState, unknown>): this {
    this.views.push(view);
    return this;
  }

  /**
   * Get a cached view value, computing if necessary
   */
  getView<T>(state: TState, viewType: string): T | undefined {
    const view = this.views.find(v => v.type === viewType);
    if (!view) return undefined;

    const cached = this.viewCache.get(viewType);
    const currentKeys = view.getDependencyKeys(state);

    // Check if cache is valid
    if (cached && this.arraysEqual(cached.keys, currentKeys)) {
      return cached.value as T;
    }

    // Compute and cache
    const value = view.compute(state);
    this.viewCache.set(viewType, { value, keys: currentKeys });
    return value as T;
  }

  /**
   * Invalidate all view caches
   */
  invalidateCache(): void {
    this.viewCache.clear();
  }

  /**
   * Run all constraints until fixpoint
   * @param state The field state (will be mutated)
   * @returns Propagation result and statistics
   */
  run(state: TState): { result: PropagationResult; stats: RunStats } {
    const startTime = Date.now();
    const constraintsFired = new Map<string, number>();
    let rounds = 0;

    // Initialize counters
    for (const c of this.constraints) {
      constraintsFired.set(c.type, 0);
    }

    while (rounds < this.options.maxRounds) {
      // Check timeout
      if (Date.now() - startTime > this.options.timeout) {
        return {
          result: PropagationResult.NO_CHANGE,
          stats: {
            rounds,
            constraintsFired,
            timeMs: Date.now() - startTime,
            result: PropagationResult.NO_CHANGE,
          },
        };
      }

      rounds++;
      let changed = false;

      // Invalidate view cache at start of each round
      this.invalidateCache();

      // Run each constraint
      for (const constraint of this.constraints) {
        const result = constraint.propagate(state);

        if (this.options.debug) {
          console.log(`[${constraint.type}] ${result}`);
        }

        if (result === PropagationResult.CONTRADICTION) {
          return {
            result: PropagationResult.CONTRADICTION,
            stats: {
              rounds,
              constraintsFired,
              timeMs: Date.now() - startTime,
              result: PropagationResult.CONTRADICTION,
            },
          };
        }

        if (result === PropagationResult.CHANGED) {
          changed = true;
          constraintsFired.set(
            constraint.type,
            (constraintsFired.get(constraint.type) || 0) + 1
          );
        }
      }

      // Fixpoint reached
      if (!changed) {
        return {
          result: PropagationResult.NO_CHANGE,
          stats: {
            rounds,
            constraintsFired,
            timeMs: Date.now() - startTime,
            result: PropagationResult.NO_CHANGE,
          },
        };
      }
    }

    // Max rounds exceeded
    if (this.options.debug) {
      console.warn(`Max rounds (${this.options.maxRounds}) exceeded`);
    }

    return {
      result: PropagationResult.CHANGED, // Still changing, might not be at fixpoint
      stats: {
        rounds,
        constraintsFired,
        timeMs: Date.now() - startTime,
        result: PropagationResult.CHANGED,
      },
    };
  }

  /**
   * Check if all constraints are satisfied
   */
  checkAll(state: TState): boolean {
    for (const constraint of this.constraints) {
      if (!constraint.isSatisfied(state)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get list of unsatisfied constraints
   */
  getUnsatisfied(state: TState): Constraint<TState>[] {
    return this.constraints.filter(c => !c.isSatisfied(state));
  }

  /**
   * Clone runner with same constraints but fresh cache
   */
  clone(): ConstraintRunner<TState> {
    const runner = new ConstraintRunner<TState>(this.options);
    runner.constraints = [...this.constraints];
    runner.views = [...this.views];
    return runner;
  }

  private arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}

/**
 * Create a constraint runner with the given constraints
 */
export function createRunner<TState>(
  constraints: Constraint<TState>[],
  options?: RunnerOptions
): ConstraintRunner<TState> {
  const runner = new ConstraintRunner<TState>(options);
  runner.addConstraints(constraints);
  return runner;
}
