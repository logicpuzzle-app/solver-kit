# Building (Skyscrapers) Solver Usage

## Overview

The Building solver implements the Skyscrapers puzzle, also known as Building puzzle. In this puzzle, you fill an N×N grid with numbers 1 to N such that each number appears exactly once in each row and column (Latin square property). The numbers represent building heights, and hints around the edges indicate how many buildings are visible from that direction.

## Rules

1. Fill each row and column with numbers 1 to N (Latin square)
2. Numbers represent building heights (1 = shortest, N = tallest)
3. Hints on edges show how many buildings are visible from that direction
4. Taller buildings block shorter ones behind them

## Visibility Examples

When counting visible buildings from a direction:
- `[1, 2, 3, 4]` from left → 4 visible (all ascending)
- `[4, 3, 2, 1]` from left → 1 visible (4 blocks all others)
- `[2, 1, 4, 3]` from left → 2 visible (see 2, then see 4)
- `[2, 3, 1, 4]` from left → 3 visible (see 2, then 3, then 4)

## Basic Usage

```typescript
import { BuildingSolver } from '@langue-de-chat-llc/solver-kit';

// Create a 4×4 puzzle with hints
const size = 4;
const upHints = [2, null, 1, 3];      // Hints from top edge
const downHints = [2, 2, null, 1];    // Hints from bottom edge
const leftHints = [2, 1, 3, 2];       // Hints from left edge
const rightHints = [2, 3, 1, null];   // Hints from right edge

// Create solver from hints
const solver = BuildingSolver.fromHints(
  size,
  upHints,
  downHints,
  leftHints,
  rightHints
);

// Solve the puzzle
const result = solver.solve();

// Check result
if (result.status === 'solved') {
  console.log('Solution found!');
  console.log(result.state.toString());
  console.log('Difficulty:', result.difficulty);
} else {
  console.log('Status:', result.status);
}
```

## Example Puzzle and Solution

### Puzzle:
```
    2   1 3
  +---------+
2 | ? ? ? ? | 2
1 | ? ? ? ? | 3
3 | ? ? ? ? | 1
2 | ? ? ? ? | ?
  +---------+
    2 2   1
```

### Solution:
```
    2   1 3
  +---------+
2 | 3 4 1 2 | 2
1 | 4 3 2 1 | 3
3 | 1 2 4 3 | 1
2 | 2 1 3 4 | ?
  +---------+
    2 2   1
```

## API Reference

### BuildingSolver.fromHints()

Create a solver from hint arrays.

```typescript
static fromHints(
  size: number,
  upHints: (number | null)[],
  downHints: (number | null)[],
  leftHints: (number | null)[],
  rightHints: (number | null)[]
): BuildingSolver
```

**Parameters:**
- `size`: The grid size (N for an N×N puzzle)
- `upHints`: Array of hints from top edge (null for no hint)
- `downHints`: Array of hints from bottom edge (null for no hint)
- `leftHints`: Array of hints from left edge (null for no hint)
- `rightHints`: Array of hints from right edge (null for no hint)

### BuildingSolver.fromString()

Create a solver from pzprv3-style encoded string.

```typescript
static fromString(size: number, param: string): BuildingSolver
```

**Parameters:**
- `size`: The grid size (N for an N×N puzzle)
- `param`: Encoded puzzle string in pzprv3 format

### solve()

Solve the puzzle.

```typescript
solve(config?: SolverConfig): SolveResult<BuildingField>
```

**Returns:** A `SolveResult` object with:
- `status`: 'solved' | 'unsolvable' | 'multiple' | 'timeout' | 'error'
- `state`: The solved field state (if status is 'solved')
- `difficulty`: Estimated difficulty level
- `propagationCount`: Number of constraint propagation steps
- `branchCount`: Number of branching attempts

## Algorithm Details

The solver uses a candidate-based approach:

1. **Candidate Generation**: Pre-generates all valid permutations of 1 to N for each row and column that satisfy the visibility hints
2. **Constraint Propagation**: When a row or column is determined to have a unique candidate, filters out incompatible candidates in the perpendicular direction
3. **Branching**: When propagation stalls, branches on the row/column with the fewest remaining candidates
4. **Backtracking**: Uses depth-limited search with backtracking to find the unique solution

The visibility counting algorithm is:
```typescript
function countVisible(line: number[]): number {
  let max = 0;
  let count = 0;
  for (const height of line) {
    if (height > max) {
      max = height;
      count++;
    }
  }
  return count;
}
```

## Performance

The solver is optimized for typical puzzle sizes (4×4 to 9×9):
- Small puzzles (4×4): Usually solved in milliseconds
- Medium puzzles (6×6): Typically solved in under 1 second
- Large puzzles (9×9): May take several seconds depending on difficulty

The solver includes configurable limits:
- Maximum recursion depth (default: 3)
- Maximum branches (default: 10000)
- Timeout (default: 30000ms)

## File Location

`/Users/HHosono/Files/0_Group/LogicPuzzleApp/packages/solver-kit/src/solvers/building.ts`
