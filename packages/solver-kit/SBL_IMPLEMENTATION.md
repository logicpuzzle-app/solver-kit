# SBL (Square Black Loop) Solver Implementation

## Overview

This document describes the TypeScript implementation of the SBL puzzle solver, based on the Java reference implementation at:
`/Users/HHosono/Files/0_Group/LogicPuzzleApp/PuzzleTools/sdvx/src/main/java/myamya/other/solver/sbl/SblSolver.java`

## Location

**File:** `/Users/HHosono/Files/0_Group/LogicPuzzleApp/packages/solver-kit/src/solvers/sbl.ts`

## Puzzle Rules

SBL (Square Black Loop) is a logic puzzle with the following rules:

1. **Black Squares**: Place square black cells on the grid
2. **Single Loop**: Draw a single closed loop through all white (non-black) cells
3. **Square Constraint**: Black cells must form square shapes (4 walls around them)
4. **Loop Constraint**: White cells have exactly 2 edges (loop enters and exits)
5. **Hints**: Row/column hints indicate the number of black cells in that row/column

## Implementation Structure

### Classes

#### `SblField` (implements `FieldState<SblField>`)

The field state class that represents the puzzle grid and implements constraint propagation.

**Properties:**
- `masu: Grid<CellState>` - Cell states (BLACK, WHITE, UNKNOWN)
- `yokoWall: Grid<Wall>` - Horizontal walls between columns
- `tateWall: Grid<Wall>` - Vertical walls between rows
- `leftHints: (number | null)[]` - Row hints (number of black cells)
- `upHints: (number | null)[]` - Column hints (number of black cells)

**Key Methods:**
- `clone()` - Deep clone for branching
- `getStateDump()` - State string for progress detection
- `isSolved()` - Check if all walls are determined
- `solveAndCheck()` - Apply constraint propagation
- `toString()` - Visual representation

**Constraint Propagation Methods:**
1. `hintsSolve()` - Process row/column black cell count hints
2. `nextSolve()` - Enforce wall count rules (white=2, black=4)
3. `sikakuSolve()` - Verify black cells can form valid squares
4. `connectSolve()` - Verify white cells form connected region

#### `SblSolver` (extends `BaseSolver<SblField>`)

The solver class that implements the search algorithm.

**Key Methods:**
- `fromString(height, width, puzzle)` - Parse from pzv.jp URL format
- `fromFieldStr(fieldStr)` - Parse from penpa-edit format
- `getBranchCandidates(state)` - Get wall candidates for branching

### Wall States

```typescript
enum Wall {
  SPACE = '?',      // Unknown/undetermined
  EXISTS = '#',     // Wall exists (blocks passage)
  NOT_EXISTS = '.'  // No wall (loop passes through)
}
```

### Cell States

Uses standard `CellState` enum from core:
- `UNKNOWN` - Not yet determined
- `WHITE` - Non-black cell (part of loop)
- `BLACK` - Black cell (surrounded by walls)

## Algorithm Overview

### Constraint Propagation Loop

1. **Hint Processing** (`hintsSolve`)
   - Count black/white/unknown cells in each row/column
   - If count matches hint, mark remaining as white
   - If count + unknowns = hint, mark unknowns as black

2. **Wall Count Rules** (`nextSolve`)
   - Unknown cells: deduce from wall count (2→white, 4→black)
   - Black cells: close all surrounding walls
   - White cells: enforce exactly 2 walls (2 passages for loop)

3. **Square Validation** (`sikakuSolve`)
   - Verify black cells can extend to form squares
   - Check horizontal and vertical extents match

4. **Connectivity Check** (`connectSolve`)
   - BFS from first white cell
   - Ensure all white cells are reachable (single loop)

### Branching Strategy

When propagation stalls, the solver:
1. Picks an undetermined wall (yokoWall or tateWall)
2. Tries both EXISTS and NOT_EXISTS
3. Recursively solves each branch
4. Returns unique solution or detects contradictions

## Usage Examples

### Basic Usage

```typescript
import { SblField, SblSolver } from './solvers/sbl.js';
import { CellState } from './core/types.js';

// Create field
const field = new SblField(5, 5);

// Set hints
field.setLeftHint(0, 2);  // Row 0 has 2 black cells
field.setUpHint(0, 1);    // Column 0 has 1 black cell

// Set known black cells
field.setCell(0, 0, CellState.BLACK);

// Solve
const solver = new SblSolver(field);
const result = solver.solve({ maxDepth: 3, maxBranches: 10000 });

console.log('Status:', result.status);
console.log('Difficulty:', result.difficulty);
if (result.state) {
  console.log(result.state.toString());
}
```

### Parse from String Format

```typescript
const puzzle = [
  ' 2121',  // Column hints
  '2....',  // Row 0: 2 black cells
  '1....',  // Row 1: 1 black cell
  '2....',  // Row 2: 2 black cells
  '1....',  // Row 3: 1 black cell
];

const solver = SblSolver.fromString(4, 4, puzzle);
const result = solver.solve();
```

## Differences from Java Implementation

### Similarities
- Same core constraint propagation logic
- Same branching strategy
- Same field state structure

### Differences
1. **Type System**: TypeScript with strict typing vs Java
2. **Grid Class**: Uses generic `Grid<T>` from core library
3. **Enums**: TypeScript string enums vs Java enums
4. **Error Handling**: Returns `SolveResult` with status vs exceptions
5. **String Format**: Simplified pzv.jp parser (full penpa-edit parsing WIP)

## Testing

The implementation includes:
- Unit test structure following existing solver patterns
- Demo file showing various puzzle configurations
- Validation that it correctly detects:
  - Contradictions (unsolvable puzzles)
  - Multiple solutions
  - Unique solutions

## Export

The solver is exported in `/Users/HHosono/Files/0_Group/LogicPuzzleApp/packages/solver-kit/src/solvers/index.ts`:

```typescript
export * from './sbl.js';
```

## Build Status

✅ TypeScript compilation successful
✅ All imports use `.js` extensions
✅ Follows BaseSolver pattern
✅ Implements FieldState interface
✅ Uses Grid<T> from core
✅ Exports added to index.ts

## Future Enhancements

1. **Full penpa-edit Parser**: Complete implementation of `fromFieldStr()`
2. **Optimized Branching**: Smart candidate selection based on constraint density
3. **Advanced Propagation**: Additional deduction techniques from the Java implementation
4. **Performance Metrics**: Benchmark against Java implementation
5. **Visualization**: SVG/Canvas rendering of solutions
