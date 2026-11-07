/**
 * Plugin Registry System
 *
 * Provides type-safe registries for constraints, views, heuristics, and generators.
 * Each plugin type can be registered with a unique ID and factory function.
 */

import { PropagationResult } from './field.js';

// ============================================
// Base Registry
// ============================================

/**
 * Generic plugin registry with type-safe registration and retrieval
 */
export class PluginRegistry<TParams, TPlugin> {
  private plugins = new Map<string, (params: TParams) => TPlugin>();

  /**
   * Register a plugin factory
   * @param id Unique plugin identifier
   * @param factory Function that creates plugin instances
   */
  register(id: string, factory: (params: TParams) => TPlugin): void {
    if (this.plugins.has(id)) {
      throw new Error(`Plugin '${id}' is already registered`);
    }
    this.plugins.set(id, factory);
  }

  /**
   * Create a plugin instance
   * @param id Plugin identifier
   * @param params Parameters to pass to the factory
   */
  create(id: string, params: TParams): TPlugin {
    const factory = this.plugins.get(id);
    if (!factory) {
      throw new Error(`Plugin '${id}' not found. Available: ${this.list().join(', ')}`);
    }
    return factory(params);
  }

  /**
   * Check if a plugin is registered
   */
  has(id: string): boolean {
    return this.plugins.has(id);
  }

  /**
   * List all registered plugin IDs
   */
  list(): string[] {
    return Array.from(this.plugins.keys());
  }

  /**
   * Unregister a plugin
   */
  unregister(id: string): boolean {
    return this.plugins.delete(id);
  }

  /**
   * Clear all registered plugins
   */
  clear(): void {
    this.plugins.clear();
  }
}

// ============================================
// Constraint Plugin System
// ============================================

// Re-export PropagationResult from field.js for convenience
export { PropagationResult } from './field.js';

/**
 * Base interface for all constraints
 */
export interface Constraint<TState> {
  /** Unique constraint type identifier */
  readonly type: string;

  /** Human-readable name */
  readonly name: string;

  /**
   * Apply constraint propagation
   * @param state Current field state
   * @returns Propagation result
   */
  propagate(state: TState): PropagationResult;

  /**
   * Check if constraint is satisfied
   * @param state Current field state
   */
  isSatisfied(state: TState): boolean;
}

/**
 * Parameters for creating constraints
 */
export interface ConstraintParams {
  [key: string]: unknown;
}

/**
 * Constraint factory function type
 */
export type ConstraintFactory<TState, TParams extends ConstraintParams = ConstraintParams> =
  (params: TParams) => Constraint<TState>;

/**
 * Registry for constraint plugins
 */
export class ConstraintRegistry<TState> extends PluginRegistry<ConstraintParams, Constraint<TState>> {
  /**
   * Create multiple constraints from specifications
   */
  createAll(specs: Array<{ type: string; params: ConstraintParams }>): Constraint<TState>[] {
    return specs.map(spec => this.create(spec.type, spec.params));
  }
}

// ============================================
// View Plugin System
// ============================================

/**
 * Derived view that can be computed from field state
 * Views are cached and invalidated based on dependency keys
 */
export interface View<TState, TValue> {
  /** Unique view type identifier */
  readonly type: string;

  /**
   * Compute the view value
   * @param state Current field state
   */
  compute(state: TState): TValue;

  /**
   * Get cache dependency keys
   * Used to invalidate cache when dependencies change
   */
  getDependencyKeys(state: TState): string[];
}

/**
 * Parameters for creating views
 */
export interface ViewParams {
  [key: string]: unknown;
}

/**
 * View factory function type
 */
export type ViewFactory<TState, TValue, TParams extends ViewParams = ViewParams> =
  (params: TParams) => View<TState, TValue>;

/**
 * Registry for view plugins
 */
export class ViewRegistry<TState> extends PluginRegistry<ViewParams, View<TState, unknown>> {}

// ============================================
// Heuristic Plugin System
// ============================================

/**
 * Branch candidate with score for prioritization
 */
export interface ScoredBranch<TState> {
  /** Function to apply this branch choice */
  apply: (state: TState) => TState;
  /** Score for prioritization (higher = try first) */
  score: number;
  /** Description for debugging */
  description?: string;
}

/**
 * Heuristic for choosing branch order
 */
export interface Heuristic<TState> {
  /** Unique heuristic type identifier */
  readonly type: string;

  /** Human-readable name */
  readonly name: string;

  /**
   * Score and order branch candidates
   * @param state Current field state
   * @param candidates Raw branch candidates
   * @returns Scored and ordered candidates
   */
  orderBranches(
    state: TState,
    candidates: Array<{ apply: (s: TState) => TState; description?: string }>
  ): ScoredBranch<TState>[];
}

/**
 * Parameters for creating heuristics
 */
export interface HeuristicParams {
  [key: string]: unknown;
}

/**
 * Heuristic factory function type
 */
export type HeuristicFactory<TState, TParams extends HeuristicParams = HeuristicParams> =
  (params: TParams) => Heuristic<TState>;

/**
 * Registry for heuristic plugins
 */
export class HeuristicRegistry<TState> extends PluginRegistry<HeuristicParams, Heuristic<TState>> {}

// ============================================
// Generator Plugin System
// ============================================

/**
 * Result of puzzle generation (extended version for plugin system)
 */
export interface PluginGeneratorResult<TState> {
  /** Generated puzzle state (with clues only) */
  puzzle: TState;
  /** Solution state */
  solution: TState;
  /** Generation metadata */
  metadata: {
    attempts: number;
    clueCount: number;
    difficulty?: string;
  };
}

/**
 * Puzzle generator interface
 */
export interface Generator<TState> {
  /** Unique generator type identifier */
  readonly type: string;

  /** Human-readable name */
  readonly name: string;

  /**
   * Generate a puzzle
   * @param width Grid width
   * @param height Grid height
   * @param options Generation options
   */
  generate(
    width: number,
    height: number,
    options?: GeneratorOptions
  ): PluginGeneratorResult<TState> | null;
}

/**
 * Options for puzzle generation
 */
export interface GeneratorOptions {
  /** Target difficulty */
  difficulty?: 'easy' | 'medium' | 'hard' | 'extreme';
  /** Maximum attempts before giving up */
  maxAttempts?: number;
  /** Minimum clue count */
  minClues?: number;
  /** Maximum clue count */
  maxClues?: number;
  /** Random seed for reproducibility */
  seed?: number;
}

/**
 * Parameters for creating generators
 */
export interface GeneratorParams {
  [key: string]: unknown;
}

/**
 * Generator factory function type
 */
export type GeneratorFactory<TState, TParams extends GeneratorParams = GeneratorParams> =
  (params: TParams) => Generator<TState>;

/**
 * Registry for generator plugins
 */
export class GeneratorRegistry<TState> extends PluginRegistry<GeneratorParams, Generator<TState>> {}

// ============================================
// Global Registries
// ============================================

/**
 * Global constraint registry (generic, use createConstraintRegistry for typed version)
 */
export const constraintRegistry = new ConstraintRegistry<unknown>();

/**
 * Global view registry
 */
export const viewRegistry = new ViewRegistry<unknown>();

/**
 * Global heuristic registry
 */
export const heuristicRegistry = new HeuristicRegistry<unknown>();

/**
 * Global generator registry
 */
export const generatorRegistry = new GeneratorRegistry<unknown>();

// ============================================
// Factory Functions for Typed Registries
// ============================================

/**
 * Create a typed constraint registry
 */
export function createConstraintRegistry<TState>(): ConstraintRegistry<TState> {
  return new ConstraintRegistry<TState>();
}

/**
 * Create a typed view registry
 */
export function createViewRegistry<TState>(): ViewRegistry<TState> {
  return new ViewRegistry<TState>();
}

/**
 * Create a typed heuristic registry
 */
export function createHeuristicRegistry<TState>(): HeuristicRegistry<TState> {
  return new HeuristicRegistry<TState>();
}

/**
 * Create a typed generator registry
 */
export function createGeneratorRegistry<TState>(): GeneratorRegistry<TState> {
  return new GeneratorRegistry<TState>();
}
