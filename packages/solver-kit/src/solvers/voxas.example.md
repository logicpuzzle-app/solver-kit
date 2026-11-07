# Voxas Puzzle Solver

## Overview

Voxas is a logic puzzle where you divide a grid into 2-cell and 3-cell rectangles. Wall hints indicate the relationship between adjacent rectangles.

## Rules

1. Divide the grid into rectangles of exactly 2 or 3 cells each
2. Rectangles can be:
   - Type 1: Vertical 2-cell (1×2)
   - Type 2: Horizontal 2-cell (2×1)
   - Type 3: Vertical 3-cell (1×3)
   - Type 4: Horizontal 3-cell (3×1)
3. No two rectangles can overlap
4. Wall hints show constraints between adjacent rectangles:
   - **Black circle (●)**: The two rectangles must be complementary (2-cell + 3-cell)
   - **Gray circle (◐)**: The two rectangles must be different sizes AND not complementary
   - **White circle (○)**: The two rectangles must be the same size

## Usage

### Parse from pzv.jp URL

```typescript
import { VoxasSolver } from './voxas.js';

// Parse from URL
const url = 'https://pzprxs.vercel.app/p?voxas/8/8/ialdgddgdlbgcbgclaobh3dg3dgalag1bg2chdl';
const solver = VoxasSolver.fromURL(url);

// Solve the puzzle
const result = solver.solve();
console.log(result.status); // 'solved' | 'unsolvable' | 'timeout'

if (result.state) {
  console.log(result.state.toString());
}
```

### Parse from string format

```typescript
// Parse directly from parameter string
const solver = VoxasSolver.fromString(8, 8, 'ialdgddgdlbgcbgclaobh3dg3dgalag1bg2chdl');

const result = solver.solve({
  maxDepth: 3,        // Maximum branching depth
  maxBranches: 10000  // Maximum branches to try
});

console.log(`Difficulty: ${result.difficulty}`);
console.log(`Propagations: ${result.propagationCount}`);
console.log(`Branches: ${result.branchCount}`);
```

### Create puzzle manually

```typescript
import { VoxasField } from './voxas.js';

// Create empty field
const field = new VoxasField(4, 4);

// Add wall hints
field.firstYokoWall.set('0,1', 2); // Black circle at horizontal wall (0,1)
field.firstTateWall.set('1,0', 4); // White circle at vertical wall (1,0)

// Initialize rectangle candidates
field.initCand();

// Create solver and solve
const solver = new VoxasSolver(field);
const result = solver.solve();
```

## Example Puzzles

### Simple 4×4

```
https://pzprxs.vercel.app/p?voxas/4/4/g
```

This is a minimal puzzle with no wall hints - the solver must find a valid division into 2-cell and 3-cell rectangles.

### Medium 8×8

```
https://pzprxs.vercel.app/p?voxas/8/8/ialdgddgdlbgcbgclaobh3dg3dgalag1bg2chdl
```

A more complex puzzle with multiple wall hints providing constraints on adjacent rectangles.

## Wall Hint Encoding

The parameter string encodes wall hints using a custom format:

- Characters '0-9a-z' encode wall positions and types
- Higher values (g-z) indicate gaps between walls
- Each character encodes: `interval * 5 + (wallType - 1)`
- Wall types: 1=plain wall, 2=black circle, 3=gray circle, 4=white circle

The encoding covers:
1. Horizontal walls (yoko): `height × (width - 1)` positions
2. Vertical walls (tate): `(height - 1) × width` positions

## Output Format

The solver produces a visual representation showing:
- Rectangle assignments (labeled A-Z)
- Wall hints (●=black, ◐=gray, ○=white)
- Grid borders

Example output:
```
┌───────┐
│A A●B B│
│   ○   │
│C C B B│
│ ● ◐ ○ │
│D C●E E│
└───────┘
```

## API Reference

### VoxasField

- `constructor(height: number, width: number)` - Create new field
- `initCand()` - Initialize rectangle candidates based on wall hints
- `clone()` - Deep copy the field
- `isSolved()` - Check if puzzle is completely solved
- `solveAndCheck()` - Apply constraint propagation
- `toString()` - Get visual representation

### VoxasSolver

- `static fromURL(url: string)` - Parse from pzv.jp URL
- `static fromString(height, width, param)` - Parse from parameter string
- `solve(config?)` - Solve the puzzle
- `getField()` - Get current field state

### VoxasSikaku (Rectangle)

- `type: number` - Rectangle type (1-4)
- `leftUp: Position` - Top-left corner
- `rightDown: Position` - Bottom-right corner
- `posSet: Set<string>` - Cell positions in this rectangle
- `yokoWall: Set<string>` - Horizontal walls created by this rectangle
- `tateWall: Set<string>` - Vertical walls created by this rectangle
- `isDuplicate(other)` - Check if rectangles overlap
