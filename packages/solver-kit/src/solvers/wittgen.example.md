# Wittgen Solver

## Puzzle Rules

Wittgen is a logic puzzle with the following rules:

1. **Place black rectangles**: Place 1×3 (horizontal) or 3×1 (vertical) black rectangles in the grid
2. **Number clues**: Numbers indicate how many of the 4 adjacent cells (up, right, down, left) are black
3. **No overlap**: Black rectangles cannot overlap with each other
4. **Connectivity**: All white (non-black) cells must form a single connected region

## Usage

### Creating a Solver from puzz.link URL

```typescript
import { WittgenSolver } from './solvers/wittgen.js';

// Parse from puzz.link URL: https://puzz.link/p?wittgen/10/10/g1h2i3
// Format: wittgen/width/height/param
const solver = WittgenSolver.fromString(10, 10, 'g1h2i3');

// Solve the puzzle
const result = solver.solve();

console.log('Status:', result.status);
console.log('Difficulty:', result.difficulty);
console.log('Branches:', result.branchCount);
console.log('Propagations:', result.propagationCount);

if (result.state) {
  console.log(result.state.toString());
}
```

### Creating a Custom Puzzle

```typescript
import { WittgenField, WittgenSolver } from './solvers/wittgen.js';

// Create a 7x7 grid
const field = new WittgenField(7, 7);

// Add number clues (row, col, count)
field.setNumber(1, 1, 2); // Cell (1,1) has 2 black neighbors
field.setNumber(3, 3, 1); // Cell (3,3) has 1 black neighbor
field.setNumber(5, 5, 3); // Cell (5,5) has 3 black neighbors

// Initialize rectangle candidates
field.initCand();

// Create solver and solve
const solver = new WittgenSolver(field);
const result = solver.solve({
  maxDepth: 3,        // Maximum recursion depth for branching
  maxBranches: 10000, // Maximum number of branches to try
  timeout: 30000,     // Timeout in milliseconds
});

console.log('Solved:', result.status === 'solved');
```

### Manual Field Manipulation

```typescript
import { WittgenField } from './solvers/wittgen.js';

const field = new WittgenField(5, 5);

// Set number clues
field.setNumber(0, 0, 1);
field.setNumber(2, 2, 2);
field.setNumber(4, 4, 0);

// Initialize candidates
field.initCand();

console.log('Initial candidates:', field.squareCand.length);
console.log('Fixed rectangles:', field.squareFixed.length);

// Apply constraints
const valid = field.solveAndCheck();
console.log('Valid state:', valid);

// Check if solved
console.log('Is solved:', field.isSolved());

// Get current state as grid
const masu = field.getMasu();
console.log('Grid state:', masu.toString());

// Get state dump for progress tracking
console.log('State:', field.getStateDump());
```

## URL Format (puzz.link)

The puzzle parameter in puzz.link URLs uses a compact encoding:

- **Gap encoding**: `g-z` represents 1-20 empty cells
  - `g` = skip 1 cell
  - `h` = skip 2 cells
  - `z` = skip 20 cells

- **Number encoding**: Hexadecimal digits encode both the number clue and skip count
  - `value % 5` = number clue (0-4)
  - `value / 5` = additional cells to skip

- **Special values**:
  - `.` = -1 (special marker, typically unused in standard puzzles)

### Examples

```typescript
// URL: https://puzz.link/p?wittgen/5/5/1g2h3
// Means:
// - Cell (0,0): number 1
// - Skip 1 cell
// - Cell (0,2): number 2
// - Skip 2 cells
// - Cell (1,0): number 3
const solver1 = WittgenSolver.fromString(5, 5, '1g2h3');

// URL: https://puzz.link/p?wittgen/5/5/g1
// Means:
// - Skip 1 cell (g)
// - Cell (0,1): number 1
const solver2 = WittgenSolver.fromString(5, 5, 'g1');
```

## Implementation Details

### Rectangle Candidates

The solver generates all possible 1×3 and 3×1 rectangles that:
- Don't overlap with number clue cells
- Fit within the grid boundaries

### Constraint Propagation

The solver applies three main constraint checks:

1. **Rectangle constraints** (`sikakuSolve`):
   - Fixed rectangles don't overlap with each other
   - Candidate rectangles that overlap with fixed ones are removed

2. **Count constraints** (`countSolve`):
   - For each number clue, verify the count of black neighbors matches
   - Detect if too many or too few black cells exist

3. **Connectivity constraints** (`connectSolve`):
   - All white (non-black) cells must form a single connected region
   - Uses flood-fill to verify connectivity

### Branching Strategy

When constraint propagation can't make further progress, the solver:
1. Picks the first remaining rectangle candidate
2. Tries two branches:
   - Fix the rectangle as black
   - Eliminate the rectangle (cell stays white)
3. Recursively solves each branch

## Example Puzzle

```
Input (5×5):
1 . . . .
. . 2 . .
. . . . .
. . 2 . .
. . . . 1

Solution might look like:
1 ░ ░ . .
. . 2 . .
. . ░ . .
. ░ 2 ░ .
. . . . 1

Where ░ represents black cells forming 1×3 or 3×1 rectangles
```

## Performance Tips

1. **Adjust solver config** for hard puzzles:
   ```typescript
   solver.solve({
     maxDepth: 5,      // Increase for harder puzzles
     maxBranches: 50000, // Increase if solver times out
     timeout: 60000,    // Increase timeout
   });
   ```

2. **Check progress** using state dumps:
   ```typescript
   const before = field.getStateDump();
   field.solveAndCheck();
   const after = field.getStateDump();
   console.log('Progress:', before !== after);
   ```

3. **Clone fields** for speculative solving:
   ```typescript
   const virtual = field.clone();
   virtual.squareFixed.push(someRectangle);
   if (virtual.solveAndCheck()) {
     // This branch is valid
   }
   ```
