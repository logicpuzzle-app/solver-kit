# Solver-Kit Plugin Architecture Proposal

## Goals
- Make constraints, views, heuristics, and generators pluggable.
- Allow solvers to be assembled from reusable primitives instead of monolithic files.
- Align with future DSL so plugins can be addressed by type IDs and parameters.

## Plugin Types
- **Constraint Plugins**: register a factory by `type id`, e.g. `constraintRegistry.register('loop-connectivity', LoopConstraintFactory)`.
- **View Plugins**: derived views such as `component`, `visibilityRay`, `room`, `perimeter` are extensible; views are cached and invalidated by dependency keys.
- **Heuristic Plugins**: branching choice strategies (min-domain, max-degree, custom scoring), and optional symmetry breaking hints.
- **Generator Plugins**: template for “place clues → solve → uniqueness check” with pluggable clue enumerators and scoring.

## Core Components to Extract
- **CandidateSet**: bitset-based candidate store with add/remove APIs; used by FieldState.
- **Connectivity/Bridge**: incremental union-find plus bridge/cut detection for loops and region connectivity.
- **Visibility/Ray**: reusable ray iterator with configurable blockers/targets for line-of-sight constraints.
- **Shape Enumeration**: polyomino generation/normalization and intersection pruning utilities.
- **Pattern Templates**: library of local patterns (2x2-ban, Tapa run-length, Masyu turn rules) via `PatternMatchConstraint`.
- **Arithmetic Engine**: expression tree supporting sum/prod/div/mod/ratio for KenKen/Calcudoku-like cages.

## Constraint Plugin Seeds
- `VisibilityConstraint` (blockers/targets parametrized)
- `PatternMatchConstraint` (neighborhood templates, run-length)
- `ComponentConstraint` (connectivity/size/count limits)
- `ArithmeticCageConstraint` (sum/prod/div/mod/ratio)
- Existing: `AllDifferent`, `Sum/Count`, `LoopConnectivity`, `DegreeConstraint`, `Covering`, `ShapeMatch`, `NonOverlap`, `Reachability`, `Coloring/Parity`.

## Typical Patterns (mapping to plugins)
- **Shading** (nurikabe/heyawake/yinyang): Region + Component + PatternMatch(2x2) + Visibility.
- **Loop** (slither/snake/simpleloop/yajilin): LoopConnectivity + Degree + LineOfSightCount + BridgeDetection.
- **Sudoku/Arithmetic**: AllDifferent + Sum/Count + Inequality/Order + ArithmeticCage.
- **Covering/Shapes**: Covering + NonOverlap + ShapeMatch + Matching (tents↔trees).
- **Fleet/Enumeration**: Count + NonOverlap + ShapeSet.
- **Special cases**: Brownies (move + visibility-number), Kurochute (shading + visibility + count), Wittgen (perimeter visibility), Snake/Myopia (path + contact-ban).

## Plugin Registration Flow (TS)
```ts
constraintRegistry.register('visibility', (params) => new VisibilityConstraint(params));
viewRegistry.register('component', (params) => buildComponentView(params, grid, store));
heuristicRegistry.register('min-domain', () => new MinDomainHeuristic());
generatorRegistry.register('generic', () => new GenericGeneratorTemplate());
```

## Execution Integration
- `FieldState` uses `ConstraintRunner` with dependency graph (views → constraints).
- `BaseSolver` remains propagate→branch; branching candidates can be provided by heuristics plugin.
- Telemetry records fired constraints/heuristics for difficulty estimation.

## Implementation Status

### Completed
1. ✅ Core registries (constraints/views/heuristics) - `src/core/registry.ts`
2. ✅ Four constraint plugins implemented - `src/constraints/plugins/`
3. ✅ Example plugin-based solver - `src/examples/nurikabe-plugin.ts`
4. ✅ Golden tests - `src/__tests__/golden/`
5. ✅ Plugin APIs documented (below)

---

## Plugin API Reference

### Core Registry (`src/core/registry.ts`)

#### PluginRegistry<TParams, TPlugin>
Generic plugin registry for managing factories.

```ts
const registry = new PluginRegistry<MyParams, MyPlugin>();
registry.register('my-plugin', (params) => new MyPlugin(params));
const plugin = registry.create('my-plugin', { option: true });
```

**Methods:**
- `register(id: string, factory: (params: TParams) => TPlugin): void`
- `create(id: string, params: TParams): TPlugin`
- `has(id: string): boolean`
- `list(): string[]`
- `unregister(id: string): boolean`
- `clear(): void`

#### Constraint<TState>
Interface for constraint plugins.

```ts
interface Constraint<TState> {
  readonly type: string;
  readonly name: string;
  propagate(state: TState): PropagationResult;
  isSatisfied(state: TState): boolean;
}
```

#### View<TState, TResult>
Interface for cached view computations.

```ts
interface View<TState, TResult> {
  readonly type: string;
  compute(state: TState): TResult;
  getDependencyKeys(state: TState): string[];
}
```

#### Heuristic<TState>
Interface for branching heuristics.

```ts
interface Heuristic<TState> {
  readonly type: string;
  readonly name: string;
  orderBranches(state: TState, candidates: BranchCandidate[]): ScoredCandidate[];
}
```

### ConstraintRunner (`src/core/constraint-runner.ts`)

Executes constraints until fixpoint or contradiction.

```ts
const runner = new ConstraintRunner<MyState>({ maxRounds: 100 });
runner.addConstraint(myConstraint);
runner.addView(myView);

const { result, stats } = runner.run(state);
const satisfied = runner.checkAll(state);
const unsatisfied = runner.getUnsatisfied(state);
```

---

## Constraint Plugins

### VisibilityConstraint (`src/constraints/plugins/visibility.ts`)

Line-of-sight constraints for puzzles like Akari, Skyscrapers.

```ts
import { VisibilityConstraint, getVisiblePositions, countVisible } from './visibility.js';

// Get all visible positions from a cell
const visible = getVisiblePositions(grid, pos, DIRECTIONS, isBlocker);

// Count visible targets
const { count, possible } = countVisible(grid, pos, DIRECTIONS, isBlocker, isTarget);

// Create constraint
const constraint = new VisibilityConstraint({
  position: { row: 0, col: 0 },
  directions: DIRECTIONS,
  isBlocker: (r, c) => grid.get(r, c) === CellState.BLACK,
  isTarget: (r, c) => grid.get(r, c) === CellState.LIGHT,
  expectedCount: 3,
});
```

### PatternMatchConstraint (`src/constraints/plugins/pattern-match.ts`)

Local pattern constraints for 2x2 pools, run-lengths, etc.

```ts
import {
  has2x2Pool,
  would2x2Pool,
  getRunLengths,
  create2x2ForbiddenPattern,
  PatternMatchConstraint
} from './pattern-match.js';

// Check for 2x2 black pool
const poolPos = has2x2Pool(grid, v => v === CellState.BLACK);

// Check if placing a value would create a pool
const wouldCreate = would2x2Pool(grid, pos, CellState.BLACK, v => v === CellState.BLACK);

// Get run lengths around a cell (for Tapa-like puzzles)
const runs = getRunLengths(grid, center, v => v === CellState.BLACK);

// Create pattern constraint
const constraint = new PatternMatchConstraint({
  patterns: [create2x2ForbiddenPattern(v => v === CellState.BLACK)],
  grid: myGrid,
});
```

### ComponentConstraint (`src/constraints/plugins/component.ts`)

Connectivity constraints for region puzzles.

```ts
import {
  findComponents,
  isConnected,
  getComponentAt,
  isArticulationPoint,
  ComponentConstraint,
} from './component.js';

// Find all connected components
const components = findComponents(grid, (v, p) => v === CellState.WHITE, false);

// Check if all matching cells are connected
const connected = isConnected(grid, v => v === CellState.WHITE, false);

// Get component containing a position
const component = getComponentAt(grid, pos, v => v === CellState.WHITE, false);

// Check if removing a cell disconnects the region
const isArticulation = isArticulationPoint(grid, pos, v => v === CellState.WHITE, false);

// Create constraint
const constraint = new ComponentConstraint({
  matches: (r, c) => grid.get(r, c) === CellState.BLACK,
  requireConnected: true,
  diagonal: false,
});
```

### ArithmeticCageConstraint (`src/constraints/plugins/arithmetic-cage.ts`)

Arithmetic constraints for KenKen, Kakuro, Killer Sudoku.

```ts
import {
  calculateOperation,
  isCageSatisfied,
  canCageBeSatisfied,
  getCageCombinatations,
  getKakuroCombinations,
  ArithmeticCageConstraint,
} from './arithmetic-cage.js';

// Calculate operation result
const result = calculateOperation([3, 4, 5], 'sum'); // 12

// Check if cage is satisfied
const satisfied = isCageSatisfied([1, 2, 3], {
  positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }],
  operation: 'sum',
  target: 6,
  unique: true,
});

// Get Kakuro combinations
const combos = getKakuroCombinations(15, 3); // Sum 15 with 3 cells

// Create constraint
const constraint = new ArithmeticCageConstraint({
  cages: [{
    positions: [{ row: 0, col: 0 }, { row: 0, col: 1 }],
    operation: 'sum',
    target: 10,
    unique: true,
  }],
  getValue: (r, c) => grid.get(r, c),
});
```

---

## Example: Building a Solver with Plugins

See `src/examples/nurikabe-plugin.ts` for a complete example of building a solver using constraint plugins.

```ts
import { ConstraintRunner } from '../core/constraint-runner.js';
import { isConnected, getComponentAt } from '../constraints/plugins/component.js';
import { has2x2Pool } from '../constraints/plugins/pattern-match.js';

// Define custom constraints using plugin utilities
class No2x2PoolConstraint implements Constraint<MyState> {
  propagate(state: MyState): PropagationResult {
    if (has2x2Pool(state.cells, v => v === CellState.BLACK)) {
      return PropagationResult.CONTRADICTION;
    }
    return PropagationResult.NO_CHANGE;
  }
  // ...
}

// Create runner with constraints
const runner = new ConstraintRunner<MyState>();
runner.addConstraints([
  new No2x2PoolConstraint(),
  new BlackConnectedConstraint(),
]);

// Run solver
const { result } = runner.run(state);
```

---

## Next Steps
- [ ] Add more constraint plugins (LoopConnectivity, AllDifferent, etc.)
- [ ] Refactor more solvers to use plugins
- [ ] Integrate with DSL schema for declarative puzzle definitions
- [ ] Add performance benchmarks comparing plugin vs legacy solvers
