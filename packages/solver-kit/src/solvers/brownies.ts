import { BaseSolver } from '../core/solver.js';
import { SolveResult, SolveStatus } from '../core/types.js';
import { FieldState } from '../core/field.js';

// Brownies: Each '9' is a brownie that must move orthogonally into an empty cell.
// After moving, all brownies are numbered from top-left to bottom-right (reading order),
// and each brownie must see its target number in the same row/column without other brownies blocking.
// The initial puzzle gives '9' cells and static numbers (or -1 for empty).

type Position = { y: number; x: number };

function posToKey(pos: Position): string {
  return `${pos.y},${pos.x}`;
}

export type BrowniesClueCell = {
  y: number;
  x: number;
  value: number; // -1 empty, 0..15 for hex-like encoding, 9 denotes a brownie start
};

export type BrowniesInput = {
  height: number;
  width: number;
  clues: BrowniesClueCell[];
};

// Field state for Brownies
export class BrowniesField implements FieldState<BrowniesField> {
  readonly height: number;
  readonly width: number;
  // Fixed numbers (from clues). -1 means blank.
  readonly numbers: number[][];
  // Current brownie positions (list of positions in reading order)
  brownies: Position[];
  // Candidate target positions for each brownie start
  candidates: Map<string, Set<string>>;

  constructor(height: number, width: number, numbers: number[][], brownies: Position[], candidates: Map<string, Set<string>>) {
    this.height = height;
    this.width = width;
    this.numbers = numbers;
    this.brownies = brownies;
    this.candidates = candidates;
  }

  static fromInput(input: BrowniesInput): BrowniesField {
    const numbers: number[][] = Array.from({ length: input.height }, () => Array(input.width).fill(-1));
    const brownies: Position[] = [];
    input.clues.forEach((c) => {
      numbers[c.y][c.x] = c.value;
      if (c.value === 9) {
        brownies.push({ y: c.y, x: c.x });
      }
    });

    // Build candidates: each 9 can move orthogonally until another clue
    const candidates = new Map<string, Set<string>>();
    for (const b of brownies) {
      const key = posToKey(b);
      const set = new Set<string>();
      set.add(key); // staying put is allowed
      const deltas = [
        { dy: -1, dx: 0 },
        { dy: 1, dx: 0 },
        { dy: 0, dx: -1 },
        { dy: 0, dx: 1 },
      ];
      for (const d of deltas) {
        let y = b.y + d.dy;
        let x = b.x + d.dx;
        while (y >= 0 && y < input.height && x >= 0 && x < input.width) {
          if (numbers[y][x] !== -1) break; // stop at other clue
          set.add(posToKey({ y, x }));
          y += d.dy;
          x += d.dx;
        }
      }
      candidates.set(key, set);
    }

    return new BrowniesField(input.height, input.width, numbers, brownies, candidates);
  }

  clone(): BrowniesField {
    const clonedCandidates = new Map<string, Set<string>>();
    this.candidates.forEach((set, k) => clonedCandidates.set(k, new Set(set)));
    return new BrowniesField(this.height, this.width, this.numbers.map((r) => [...r]), [...this.brownies], clonedCandidates);
  }

  isSolved(): boolean {
    // Solved if each brownie has a single candidate (fixed position) and constraints hold
    for (const set of this.candidates.values()) {
      if (set.size !== 1) return false;
    }
    return this.check();
  }

  getStateDump(): string {
    const assignments = [...this.candidates.entries()]
      .map(([from, set]) => `${from}:${[...set].sort().join('|')}`)
      .sort();
    return assignments.join(',');
  }

  // Constraint: after assigning positions, number brownies by reading order and each must see its number
  private check(): boolean {
    // Build set of occupied cells
    const occupied = new Set<string>();
    const fixed: Position[] = [];
    for (const [, set] of this.candidates.entries()) {
      if (set.size === 1) {
        const posKey = [...set][0];
        if (occupied.has(posKey)) return false; // collision
        occupied.add(posKey);
        const [y, x] = posKey.split(',').map(Number);
        fixed.push({ y, x });
      }
    }
    if (fixed.length !== this.brownies.length) return true; // not all placed yet

    // Sort brownies by reading order and assign numbers starting from 0
    fixed.sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
    for (let i = 0; i < fixed.length; i++) {
      const targetNum = i;
      const pos = fixed[i];
      if (!this.seesNumber(pos, targetNum, occupied)) {
        return false;
      }
    }
    return true;
  }

  private seesNumber(pos: Position, target: number, occupied: Set<string>): boolean {
    // Look in four directions until boundary or occupied brownie or fixed clue number (non -1)
    const deltas = [
      { dy: -1, dx: 0 },
      { dy: 1, dx: 0 },
      { dy: 0, dx: -1 },
      { dy: 0, dx: 1 },
    ];
    for (const d of deltas) {
      let y = pos.y + d.dy;
      let x = pos.x + d.dx;
      while (y >= 0 && y < this.height && x >= 0 && x < this.width) {
        const key = posToKey({ y, x });
        if (occupied.has(key)) break;
        const clue = this.numbers[y][x];
        if (clue !== -1) {
          if (clue === target) return true;
          break;
        }
        y += d.dy;
        x += d.dx;
      }
    }
    return false;
  }

  solveAndCheck(): boolean {
    let changed = true;
    while (changed) {
      changed = false;
      // Remove candidates that collide with fixed placements
      const fixed = new Set<string>();
      this.candidates.forEach((set) => {
        if (set.size === 1) fixed.add([...set][0]);
      });

      this.candidates.forEach((set, from) => {
        const before = set.size;
        for (const pos of [...set]) {
          if (fixed.has(pos) && set.size > 1) {
            set.delete(pos);
          }
        }
        if (set.size === 0) {
          set.add(from); // avoid empty; will fail later
        }
        if (set.size !== before) changed = true;
      });

      // If all fixed, check constraints
      if ([...this.candidates.values()].every((s) => s.size === 1)) {
        return this.check();
      }
    }
    return true;
  }

  // Branch on a candidate with multiple options
  candSolve(): BrowniesField[] {
    // pick a brownie with largest candidate set
    let targetKey: string | null = null;
    let maxSize = 1;
    this.candidates.forEach((set, key) => {
      if (set.size > maxSize) {
        maxSize = set.size;
        targetKey = key;
      }
    });
    if (!targetKey) return [];
    const set = this.candidates.get(targetKey)!;
    return [...set].map((posKey) => {
      const clone = this.clone();
      clone.candidates.set(targetKey!, new Set([posKey]));
      return clone;
    });
  }
}

export class BrowniesSolver extends BaseSolver<BrowniesField> {
  constructor(field: BrowniesField) {
    super(field);
  }

  protected getBranchCandidates(state: BrowniesField) {
    return state.candSolve().map((nextState) => ({
      apply: () => nextState,
    }));
  }
}

export function solveBrownies(input: BrowniesInput): SolveResult<BrowniesField> {
  const field = BrowniesField.fromInput(input);
  const solver = new BrowniesSolver(field);
  const result = solver.solve();
  if (result.status === SolveStatus.SOLVED) {
    return result as SolveResult<BrowniesField>;
  }
  return result as SolveResult<BrowniesField>;
}
