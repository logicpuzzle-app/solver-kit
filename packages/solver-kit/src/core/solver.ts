/**
 * SolverEngine - Core solving algorithm
 * Implements the SDVX pattern: propagate → branch with depth limit
 */

import { FieldState } from './field.js';
import { SolveResult, SolveStatus, Difficulty } from './types.js';

/**
 * Configuration for solver
 */
export interface SolverConfig {
  /** Maximum recursion depth for branching (default: 3) */
  maxDepth?: number;
  /** Maximum total branches to try (default: 10000) */
  maxBranches?: number;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
}

const DEFAULT_CONFIG: Required<SolverConfig> = {
  maxDepth: 50,
  maxBranches: 100000,
  timeout: 60000,
};

/**
 * Solver interface
 * Each puzzle type implements this
 */
export interface Solver<TState extends FieldState<TState>> {
  /** Get current field state */
  getField(): TState;

  /** Run the solver */
  solve(config?: SolverConfig): SolveResult<TState>;
}

/**
 * Branch candidate - represents a choice point for backtracking
 */
export interface BranchCandidate<TState extends FieldState<TState>> {
  /** Create modified state with this branch choice applied */
  apply(state: TState): TState;
  /** Description for debugging */
  description?: string;
}

/**
 * Abstract base class for puzzle solvers
 * Implements the core propagate-branch loop from SDVX
 */
export abstract class BaseSolver<TState extends FieldState<TState>> implements Solver<TState> {
  protected field: TState;
  protected propagationCount = 0;
  protected branchCount = 0;
  protected startTime = 0;
  protected config: Required<SolverConfig> = DEFAULT_CONFIG;

  constructor(field: TState) {
    this.field = field;
  }

  getField(): TState {
    return this.field;
  }

  /**
   * Get branch candidates for backtracking
   * Override this to provide puzzle-specific branching logic
   */
  protected abstract getBranchCandidates(state: TState): BranchCandidate<TState>[];

  /**
   * Main solve method
   * Implements SDVX's solve() pattern
   */
  solve(config?: SolverConfig): SolveResult<TState> {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.propagationCount = 0;
    this.branchCount = 0;
    this.startTime = Date.now();

    try {
      const result = this.solveInternal(this.field, 0);
      return {
        ...result,
        propagationCount: this.propagationCount,
        branchCount: this.branchCount,
        difficulty: this.estimateDifficulty(),
      };
    } catch (error) {
      return {
        status: SolveStatus.ERROR,
        propagationCount: this.propagationCount,
        branchCount: this.branchCount,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Internal recursive solving
   */
  private solveInternal(state: TState, depth: number): SolveResult<TState> {
    // Check timeout
    if (Date.now() - this.startTime > this.config.timeout) {
      return { status: SolveStatus.TIMEOUT, propagationCount: 0, branchCount: 0 };
    }

    // Check branch limit
    if (this.branchCount > this.config.maxBranches) {
      return { status: SolveStatus.TIMEOUT, propagationCount: 0, branchCount: 0 };
    }

    // Propagation loop
    let changed = true;
    while (changed) {
      const beforeState = state.getStateDump();
      this.propagationCount++;

      // Apply constraint propagation
      if (!state.solveAndCheck()) {
        return { status: SolveStatus.UNSOLVABLE, propagationCount: 0, branchCount: 0 };
      }

      // Check if solved
      if (state.isSolved()) {
        return { status: SolveStatus.SOLVED, state, propagationCount: 0, branchCount: 0 };
      }

      changed = state.getStateDump() !== beforeState;
    }

    // No progress - try branching if depth allows
    if (depth >= this.config.maxDepth) {
      // Can't branch deeper, may need to give up
      return { status: SolveStatus.TIMEOUT, propagationCount: 0, branchCount: 0 };
    }

    // Get branch candidates
    const candidates = this.getBranchCandidates(state);
    if (candidates.length === 0) {
      // No more branching options but not solved - unsolvable or multiple solutions
      return { status: SolveStatus.UNSOLVABLE, propagationCount: 0, branchCount: 0 };
    }

    // Try each candidate
    let solutionFound: TState | null = null;

    for (const candidate of candidates) {
      this.branchCount++;

      // Create virtual copy and apply candidate
      const virtual = candidate.apply(state.clone());

      // Recursively solve
      const result = this.solveInternal(virtual, depth + 1);

      if (result.status === SolveStatus.SOLVED) {
        if (solutionFound !== null) {
          // Multiple solutions found - return current state as common confirmed part
          return { status: SolveStatus.MULTIPLE, state, propagationCount: 0, branchCount: 0 };
        }
        solutionFound = result.state!;
        // Continue checking for multiple solutions
      } else if (result.status === SolveStatus.MULTIPLE) {
        // Propagate MULTIPLE status with common confirmed state
        return { status: SolveStatus.MULTIPLE, state: result.state || state, propagationCount: 0, branchCount: 0 };
      }
      // UNSOLVABLE or TIMEOUT for this branch - try next
    }

    if (solutionFound !== null) {
      return { status: SolveStatus.SOLVED, state: solutionFound, propagationCount: 0, branchCount: 0 };
    }

    return { status: SolveStatus.UNSOLVABLE, propagationCount: 0, branchCount: 0 };
  }

  /**
   * Estimate difficulty based on solving statistics
   * Maps to SDVX's difficulty calculation
   */
  protected estimateDifficulty(): Difficulty {
    // Formula inspired by SDVX: sqrt(branchCount * factor)
    const score = Math.sqrt(this.branchCount * 10 + this.propagationCount);

    if (score < 5) return Difficulty.EASY;
    if (score < 15) return Difficulty.MEDIUM;
    if (score < 30) return Difficulty.HARD;
    if (score < 50) return Difficulty.EXPERT;
    return Difficulty.EXTREME;
  }
}

/**
 * Simple solver for puzzles that only need propagation (no branching)
 */
export abstract class PropagationOnlySolver<TState extends FieldState<TState>>
  extends BaseSolver<TState> {

  protected getBranchCandidates(_state: TState): BranchCandidate<TState>[] {
    // No branching - propagation only
    return [];
  }
}
