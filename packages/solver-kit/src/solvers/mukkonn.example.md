# Mukkonn Solver Example

## Overview

Mukkonn is a puzzle where you divide a grid into regions by placing walls between cells.

## Rules

1. Divide the grid into regions by placing walls between cells
2. Each cell must have exactly 2 walls on its 4 edges (including grid boundary)
3. Compass clues show how many cells are visible in each direction (up/right/down/left)
   - A number indicates exactly that many cells visible in that direction
   - No number (-1) means that direction is unknown
4. All regions must be connected (no isolated regions)
5. Each row and column must have an even number of vertical/horizontal passages

## Example Usage

### TypeScript

```typescript
import { MukokonnSolver } from '@langue-de-chat-llc/solver-kit';

// Create from puzz.link URL format
// Example: https://puzz.link/p?mukkonn/5/5/1111g2121
const solver = MukokonnSolver.fromString(5, 5, '1111g2121');

// Solve the puzzle
const result = solver.solve();

if (result.status === 'solved') {
  console.log('Solution found!');
  console.log(result.state?.toString());
  console.log('Difficulty:', result.difficulty);
} else {
  console.log('Status:', result.status);
}
```

### Manual Field Creation

```typescript
import { MukokonnField, MukokonnSolver, MukokonnCompass } from '@langue-de-chat-llc/solver-kit';

// Create a 3x3 field
const field = new MukokonnField(3, 3);

// Add compass clues
// up: 1, right: 0, down: 1, left: 0
const compass1: MukokonnCompass = {
  up: 1,
  right: 0,
  down: 1,
  left: 0
};
field.setCompass(1, 1, compass1);

// Another compass with some directions unconstrained
const compass2: MukokonnCompass = {
  up: -1,    // No constraint
  right: 2,
  down: -1,  // No constraint
  left: 1
};
field.setCompass(0, 0, compass2);

// Create solver and solve
const solver = new MukokonnSolver(field);
const result = solver.solve();

console.log(result.state?.toString());
```

## URL Format

The puzz.link URL format for Mukkonn is:
```
mukkonn/width/height/param
```

Where `param` encodes compass clues:
- Each compass is 4 characters: up/down/left/right
- `.` means no constraint (-1)
- `0-9, a-f` are hex digits (0-15)
- `-XX` for values 16-255 (2 hex digits)
- `+XXX` for values 256-999 (3 hex digits)
- `g-z` represent gaps (1-20 empty cells without compasses)

Example: `1111g2121` means:
- Cell 0: compass with (up=1, down=1, left=1, right=1)
- Skip 1 cell (gap 'g')
- Cell 2: compass with (up=2, down=1, left=2, right=1)

## Compass Values

The MukokonnCompass interface has 4 properties:
- `up`: Cells visible upward (-1 = no constraint)
- `right`: Cells visible rightward (-1 = no constraint)
- `down`: Cells visible downward (-1 = no constraint)
- `left`: Cells visible leftward (-1 = no constraint)

## Sample Puzzle

Here's a simple 3x3 puzzle:

```
┌─────┐
│× ? ×│
│? ? ?│
│× ? ×│
└─────┘
```

Where `×` indicates cells with compass clues. The solver will determine where to place walls (│ or ─) and where to leave open passages.

## Advanced Usage

```typescript
// Configure solver options
const result = solver.solve({
  maxDepth: 3,        // Maximum recursion depth
  maxBranches: 10000, // Maximum branch attempts
  timeout: 30000      // Timeout in milliseconds
});

// Access solving statistics
console.log('Propagation steps:', result.propagationCount);
console.log('Branch attempts:', result.branchCount);
console.log('Difficulty:', result.difficulty);
```
