# @logicpuzzle-app/solver-kit

Abstract puzzle solver framework implementing constraint propagation and backtracking algorithms.

## Features

- **Core Solving Engine**: Propagate-branch pattern with configurable depth limits
- **Generic Field State**: Abstract interface for any puzzle type
- **Constraint Primitives**: Reusable constraint checkers (connectivity, loops, uniqueness, etc.)
- **Difficulty Estimation**: Automatic difficulty calculation based on solving steps
- **TypeScript First**: Full type safety with comprehensive type definitions

## Installation

```bash
npm install @logicpuzzle-app/solver-kit
```

> **Note**: This package is published to GitHub Packages. You need to configure npm to use the GitHub registry for the `@logicpuzzle-app` scope:
>
> ```bash
> echo "@logicpuzzle-app:registry=https://npm.pkg.github.com" >> .npmrc
> ```

## Quick Start

```typescript
import { AkariSolver, SolveStatus } from '@logicpuzzle-app/solver-kit';

// Define puzzle (# = wall, 0-4 = numbered wall)
const puzzle = [
  '..#..',
  '.1...',
  '#...#',
  '...2.',
  '..#..',
];

// Create and run solver
const solver = AkariSolver.fromString(5, 5, puzzle);
const result = solver.solve();

if (result.status === SolveStatus.SOLVED) {
  console.log('Solution found!');
  console.log(result.state?.toString());
  console.log(`Difficulty: ${result.difficulty}`);
}
```

## Architecture

The solver follows the SDVX pattern:

1. **Constraint Propagation** (`solveAndCheck`): Apply logical deductions
2. **Progress Detection**: Compare state dumps before/after
3. **Branching** (`candSolve`): If stuck, make educated guesses with backtracking
4. **Depth Limiting**: Cap recursion to avoid infinite loops

### Creating a Custom Solver

```typescript
import {
  FieldState,
  BaseSolver,
  BranchCandidate,
  SolveResult,
} from '@logicpuzzle-app/solver-kit';

// 1. Define your field state
class MyPuzzleField implements FieldState<MyPuzzleField> {
  height: number;
  width: number;

  clone(): MyPuzzleField { /* ... */ }
  getStateDump(): string { /* ... */ }
  isSolved(): boolean { /* ... */ }
  solveAndCheck(): boolean { /* ... */ }
  toString(): string { /* ... */ }
}

// 2. Create your solver
class MyPuzzleSolver extends BaseSolver<MyPuzzleField> {
  protected getBranchCandidates(state: MyPuzzleField): BranchCandidate<MyPuzzleField>[] {
    // Return possible choices for backtracking
    return [/* ... */];
  }
}
```

## Core Types

### Cell States
```typescript
enum CellState {
  UNKNOWN = 'unknown',
  WHITE = 'white',
  BLACK = 'black',
}

enum EdgeState {
  UNKNOWN = 'unknown',
  EMPTY = 'empty',
  LINE = 'line',
}
```

### Directions
```typescript
enum Direction {
  UP = 'up',
  RIGHT = 'right',
  DOWN = 'down',
  LEFT = 'left',
}
```

### Solve Results
```typescript
enum SolveStatus {
  SOLVED = 'solved',
  UNSOLVABLE = 'unsolvable',
  MULTIPLE = 'multiple',
  TIMEOUT = 'timeout',
  ERROR = 'error',
}

interface SolveResult<TState> {
  status: SolveStatus;
  state?: TState;
  difficulty?: Difficulty;
  propagationCount: number;
  branchCount: number;
}
```

## Constraint Primitives

```typescript
import {
  // Connectivity
  isWhiteConnected,
  hasBlackPool,
  countRegions,
  getConnectedRegion,

  // Loops
  countEdgesAtVertex,
  countEdgesAroundCell,
  isValidLoop,

  // Visibility
  getVisibleCells,
  countVisibleCells,

  // Uniqueness
  allUnique,
  getRow,
  getColumn,

  // Shapes
  normalizeShape,
  shapesEqual,
} from '@logicpuzzle-app/solver-kit';
```

## Data Structures

### Grid
```typescript
const grid = new Grid<CellState>(10, 10, CellState.UNKNOWN);
grid.set(0, 0, CellState.BLACK);
grid.get(0, 0); // CellState.BLACK

for (const [pos, value] of grid.entries()) {
  // Iterate all cells
}
```

### EdgeGrid
```typescript
const edges = new EdgeGrid<EdgeState>(10, 10, EdgeState.UNKNOWN);
edges.setHorizontal(0, 0, EdgeState.LINE);
edges.getTop(1, 0); // EdgeState.LINE
```

### UnionFind
```typescript
const uf = new UnionFind();
uf.makeSet({ row: 0, col: 0 });
uf.makeSet({ row: 0, col: 1 });
uf.union({ row: 0, col: 0 }, { row: 0, col: 1 });
uf.connected({ row: 0, col: 0 }, { row: 0, col: 1 }); // true
```

## Supported Puzzles

Currently implemented (180+ puzzle types).

### Validated (Working)

The following solvers have been tested and confirmed working:

- **Yajilin** - Draw loop avoiding arrows
- **Masyu** - Draw loop through pearls
- **Nurikabe** - Paint cells to form islands
- **Slither Link** - Form loop around numbers
- **Heyawake** - Shade cells in rooms

### Other Puzzles (Unvalidated)

The following solvers are implemented but not yet fully tested:

#### Classic Puzzles
- **Sudoku** - Fill grid with numbers 1-9
- **Nonogram** (Picross) - Reveal picture from clues
- **Kakuro** - Sum-based crossword
- **Akari** (Light Up) - Place lights to illuminate cells
- **Hitori** - Eliminate duplicates
- **Hashikake** (Bridges) - Connect islands with bridges

#### Shading Puzzles
- **Nurimaze**, **Kurodoko**, **Kurotto**
- **Tapa**, **Aqre**, **Mochikoro**, **Nuribou**
- **Cave**, **Stostone**, **Chocona**, **LITS**

#### Loop Puzzles
- **Country Road**, **Geradeweg**
- **Simpleloop**, **Midloop**
- **Balance Loop**, **Mejilink**, **Nagenawa**

#### Region/Number Puzzles
- **Fillomino**, **Ripple Effect**, **Nanro**
- **Star Battle**, **Pentomino**, **Shikaku**
- **Skyscrapers**, **Easy as ABC**, **Kropki**

#### And many more...

See `src/solvers/` for the complete list of supported puzzle types.

## License

MIT

## Acknowledgments

Architecture inspired by [SDVX Puzzle Solver](https://github.com/3892myamya/sdvx).
