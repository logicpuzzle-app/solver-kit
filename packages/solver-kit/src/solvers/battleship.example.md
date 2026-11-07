# Battleship Solver - Usage Examples

## Basic Usage

```typescript
import { BattleshipSolver, ShipShape } from '@langue-de-chat-llc/solver-kit/solvers';

// Create a 5x5 Battleship puzzle
const rowHints = [1, 2, 2, 1, 0]; // Ship cells in each row
const colHints = [2, 1, 2, 0, 1]; // Ship cells in each column

// Shape hints (optional)
// '.' = unknown, '~' = water, '●' = circle ship
// '^' = end up, 'v' = end down, '<' = end left, '>' = end right
// '#' = middle part
const shapes = [
  '.....',
  '..~..',
  '.●...',
  '.....',
  '~~~~~',
];

// Ships to place (optional, for validation)
const shipLengths = [3, 2, 1]; // One 3-cell ship, one 2-cell ship, one 1-cell ship

// Create solver
const solver = BattleshipSolver.fromData(5, 5, rowHints, colHints, shapes, shipLengths);

// Solve the puzzle
const result = solver.solve();

if (result.status === 'solved' && result.state) {
  console.log(result.state.toString());
  console.log(`Difficulty: ${result.difficulty}`);
}
```

## Shape Hints Characters

You can use different characters for shape hints:

| Shape | Characters | Description |
|-------|-----------|-------------|
| Unknown | `.` or ` ` | Cell state unknown |
| Water | `~` or `w` or `W` | Not part of any ship |
| Circle | `●` or `o` or `O` | Single-cell ship |
| End Up | `▲` or `^` or `U` | Ship end pointing up |
| End Down | `▼` or `v` or `D` | Ship end pointing down |
| End Left | `◀` or `<` or `L` | Ship end pointing left |
| End Right | `▶` or `>` or `R` | Ship end pointing right |
| Middle | `■` or `#` or `M` | Middle part of ship |

## Output Format

The solver's `toString()` method displays:
- `~` for water cells
- `●` for circle ships
- `▲▼◀▶` for ship ends
- `■` for ship middle or unknown ship parts
- `·` for unknown cells

Example output:
```
  21201
2 ~■■~●
1 ~~~~~
1 ●~~~~
2 ~■■~~
0 ~~~~~
```

## Puzzle Rules

1. **Ship Placement**: Ships occupy consecutive cells horizontally or vertically
2. **No Touching**: Ships cannot touch each other, even diagonally
3. **Row/Column Hints**: Numbers indicate how many cells in that row/column contain ships
4. **Shape Hints**: Some cells may show what type of ship part they contain

## Advanced Usage

### Accessing Field State

```typescript
const field = solver.getField();

// Get cell state at position
const cellState = field.getCell(2, 3);

// Get shape hint at position
const shape = field.getShape(2, 3);

// Get row/column hints
const rowHint = field.getRowHint(0);
const colHint = field.getColHint(0);
```

### Solver Configuration

```typescript
const result = solver.solve({
  maxDepth: 5,        // Maximum recursion depth for branching
  maxBranches: 10000, // Maximum number of branch attempts
  timeout: 30000      // Timeout in milliseconds
});
```

### Result Status

```typescript
import { SolveStatus } from '@langue-de-chat-llc/solver-kit';

switch (result.status) {
  case SolveStatus.SOLVED:
    console.log('Found unique solution');
    break;
  case SolveStatus.UNSOLVABLE:
    console.log('No solution exists');
    break;
  case SolveStatus.MULTIPLE:
    console.log('Multiple solutions exist');
    break;
  case SolveStatus.TIMEOUT:
    console.log('Solver timed out or exceeded limits');
    break;
}
```

## Example Puzzles

### Easy Puzzle (5x5)

```typescript
const solver = BattleshipSolver.fromData(
  5, 5,
  [1, 1, 2, 1, 1], // row hints
  [2, 0, 2, 1, 1], // column hints
  [
    '.....',
    '..~..',
    '.....',
    '..~..',
    '.....',
  ],
  [2, 1, 1, 1, 1]  // ships: one 2-cell, four 1-cell
);
```

### Medium Puzzle with Shape Hints (8x8)

```typescript
const solver = BattleshipSolver.fromData(
  8, 8,
  [3, 1, 0, 2, 4, 1, 2, 1], // row hints
  [2, 2, 2, 1, 2, 2, 1, 2], // column hints
  [
    '........',
    '........',
    '~~~~~~~~',
    '...●....',
    '.^......',
    '.#......',
    '.v......',
    '........',
  ],
  [4, 3, 3, 2, 2, 1, 1, 1, 1] // ship fleet
);
```

## Implementation Details

The solver uses:
- **Constraint Propagation**: Enforces ship adjacency rules, row/column hints, and shape constraints
- **Backtracking Search**: Tries different cell assignments when propagation alone isn't enough
- **Heuristic Branching**: Prioritizes cells near existing ships and in rows/columns with hints

### Constraints Enforced

1. **Ship Adjacency**: No two ships can touch, even diagonally
2. **Row/Column Counts**: Must match the given hints exactly
3. **Shape Consistency**: Cells with shape hints must form valid ship parts
4. **Ship Continuity**: Multi-cell ships must be straight lines without gaps
5. **End Constraints**: Ship ends can only have one adjacent ship cell in the correct direction
6. **Circle Constraints**: Circle ships must be isolated (no adjacent ship cells)
