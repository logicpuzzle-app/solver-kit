# Yajilin Kit — Three-Language Solver and Generator

A Yajilin (ヤジリン) solver and puzzle generator implemented three times over — in
**TypeScript, Rust and Python** — from a single reference design, with the same seed
producing byte-identical output in every language.

日本語版: [README_JA.md](README_JA.md)

## What this is built from

The **solver** is a port of the technique-based solver in
`PuzzleTools/gridkit/frontend/src/puzzle/yajilin`, lifted out of its React host and
reproduced deduction for deduction — including the quirks that change results, which are
documented at each site rather than silently fixed.

The **generator** has no counterpart in gridkit and is new here. Its shape follows the
[NPGenerator 2007 four-language rewrite](../../vendor/npgenerator): one deterministic RNG
shared across the ports, a common CLI, per-language `verify.sh`, and a cross-language
benchmark.

## Two solvers, on purpose

| | technique solver | constraint engine |
|---|---|---|
| source | `solver.ts`, `techniques/` | `engine.ts`, `search.ts` |
| models | how a person solves | what the rules allow |
| used for | difficulty scoring, explaining an answer | generation, uniqueness proofs |
| complete? | no — it can stop short | yes, it is a decision procedure |

The technique solver is what difficulty is measured with, because difficulty is a fact
about human reasoning. It is not, however, a decision procedure: it stops when it runs out
of ideas. Anything that has to be *true* — "this puzzle has exactly one solution" — goes
through the constraint engine instead.

## Layout

| Directory | Implementation | Build / run |
|---|---|---|
| `typescript/` | Reference implementation | `npm install` → `node --import tsx src/cli.ts <cmd>` |
| `rust/` | Rust (edition 2021, std only) | `cargo build --release` → `target/release/yajilin <cmd>` |
| `python/` | Python 3.10+ (stdlib only; runs unmodified on PyPy) | `python3 yajilin.py <cmd>` |
| `bench/` | Cross-language benchmark | `bench/run-bench.sh [count] [seed]` |

## CLI (identical in all three languages)

```
yajilin solve <problem>                 # answer, difficulty, and a rendered grid
yajilin count <problem> [--limit N]     # count solutions (uniqueness proof)
yajilin generate-loop [options]         # generate by drawing the loop first
yajilin generate-pattern [options]      # generate from a clue pattern
yajilin bench [--count N] [--seed N]    # time generation, solving and counting

<problem> is a file path, a puzz.link url, or a bare "yajilin/W/H/body" code.

  --seed N            rng seed (default 0)
  --size WxH          board size (default 10x10)
  --clues N           number of arrow clues
  --clue-ratio R      clues as a fraction of the board (default 0.16)
  --attempts N        retry budget, 0 = unlimited (default 100)
  --dp-min N/--dp-max N  difficulty window; puzzles outside it are regenerated
  --max-nodes N       search node cap, 0 = unlimited (default 200000)
  --symmetry S        none|rot2|rot4|mirror-h|mirror-v (pattern mode, default rot2)
  --pattern FILE      explicit clue pattern (pattern mode)
  --no-weaken         keep the most informative clue directions
  --no-reduce         keep every clue, even the redundant ones (loop mode)
  --refine N          hill-climb N rounds for a harder puzzle (default 0)
  --anneal N          annealing rounds when the greedy repair stalls (default 8 per cell)
  --vary-clue-count   let the annealing add and remove clues: harder, ~40% slower
  --black-bias N      per-mille chance of trying a cell as black first (default 850)
  --no-trial          solve without the lookahead
  --format F          url|code|text|grid (default grid)
  --out FILE          write to a file instead of stdout
```

## The two generation modes

**`generate-loop` — the loop comes first.** A random valid answer is drawn on an empty
board, giving a single loop plus a set of black cells. Black cells are then promoted to
arrow clues, and the answer is redrawn after each batch. Redrawing is the load-bearing
part: once a cell is blocked its neighbours are free to be black, so the fresh answer
carries roughly as many black cells as before *on top of* the clues already placed.
Without it every clue would cost a black cell and the puzzle would drift towards "no black
cells anywhere", which is barely constrained at all.

**`generate-pattern` — the clue positions come first**, from a symmetric pattern or one
supplied with `--pattern`. Those cells are blocked and an answer is drawn around them.

From there both modes do the same thing: aim every arrow, demand a unique solution, and
then take information away — drop clues uniqueness does not need, and swap in directions
that say less — for as long as the puzzle stays unique.

### What the engine knows

Propagation applies only sound, cheap rules, and how far it gets is what generation is
steered by, so the rules have been chosen by measurement rather than by taste:

| Rule | Verdict |
|---|---|
| Black cells blank their edges and push neighbours onto the loop | core |
| Loop cells have degree two | core |
| Arrow bounds along a ray, with the ceil(run/2) packing limit | core |
| Line fragments must stay mutually reachable | core |
| **Grid-line parity** — the loop crosses any grid line an even number of times | **adopted** |
| **Small-loop ban** — refuse an edge that would close a fragment early | **adopted** |
| Rectangle parity — the same argument on every top-left-anchored rectangle | rejected |

Parity earns its place twice over: pattern-mode generation at 12×12 went from 10 of 16 to
13 of 16 over the same seeds, and the whole run got 2.6× faster.

The small-loop ban is worth 1.1× to 2.5× on generation depending on the board — loop mode
at 12×12 went from 123 s to 49 s for the same 8 of 8.

Rectangle parity is just as sound and raises coverage from 38% to 42%, but it made 12×12
generation slower (182 s against 149 s) for the same success rate: it pays for deductions
the generator does not need.

The even-run half of the arrow packing argument needs no code at all: a run only ever
holds undecided cells, so settling one splits the run and the capacities are recomputed,
at which point the odd sub-run forces its cells. Adding an explicit pairing rule was tried
and was dead code.

### What was tried and did not work

Six ideas were measured against the benchmark and none of them beat the configuration
above, which is worth recording so they are not tried again:

| Idea | Result |
|---|---|
| Late acceptance hill climbing in place of threshold accepting | no difference at history 10, 50 or 200 |
| Pairing coverage with a probe for how hard a second solution is to find | looked like a gain on one seed set, 13/13 on an independent one, 40% slower |
| Measuring the objective with a deliberately weakened engine | no difference |
| Weighting the move kinds by how often each recently helped | no measurable change |
| Vetoing clue patterns that propagation already rejects | 13 of 16 down to 10 — the veto steers the draw towards clustered layouts |
| An explicit pairing rule for even arrow runs | dead code; splitting a run already forces it |

The one thing that did move was **the benchmark itself**. It had been running with
`--attempts 20` while the shipped default is 100, which turned unlucky seeds into
"failures" and made every candidate that traded a little success for speed look bad. At the
real default those same seeds all succeed, generation is 32 of 32 across 10×10 and 12×12,
and the deciding measure becomes time — which is how the small-loop ban went from rejected
to adopted.

### Annealing on how much the clues decide

Uniqueness is a yes/no answer, and a search that only knows "not yet unique" has nothing
to climb. So when the greedy repair stalls, generation switches to a local search over
clue layouts whose objective is **how much of the answer plain propagation pins down**
(`analysePropagation`). That number rises steadily as the clues start to bite, which gives
the search a gradient, and uniqueness is retested whenever it improves.

The neighbourhood is geometric, because where an arrow sits decides what it can see:

- nudge a clue one cell up, down, left or right;
- re-aim it;
- relocate it onto one of the answer's black cells;
- aim it at the direction that sees the most still-undecided cells;
- move it next to a still-undecided cell.

With `--vary-clue-count` two further moves are unlocked, adding and removing clues, which
lets the annealing revise the clue count that phase 1 guessed from the board area. It is
off by default because the measurement was a trade rather than a win: roughly 50% more
difficulty for 35–45% more time, with success rates unchanged or a shade worse.

Acceptance is threshold accepting rather than the usual `exp(-delta/T)` Metropolis rule —
it needs no floating-point exponential, so the three ports stay bit-identical — with a
reheat whenever the search has been stuck for a while. Restarting from the best layout
found so far on each reheat was tried and reverted: it measured slower with no gain, since
reheating exists to diversify and snapping back to the best state just re-enters the same
basin.

Pattern mode gets the same fallback, restricted to the aiming moves because its clue
positions belong to the pattern. Before that it simply gave up when steering stalled,
which is why it used to be the weaker of the two modes at every size.

This is what makes the larger sizes work at all: 12×12 went from 1 success in 5 attempts
to 8 in 8, and 10×10 from 17 in 20 to 12 in 12. `tools/bench-generation.mjs` is the fixed
benchmark every candidate is judged against — same seeds, same sizes, same budgets — and
`tools/diagnose-size.mjs` breaks a failure down by phase.

Two things about Yajilin shape this pipeline:

- **Arrows only ever count black cells.** If a black configuration admits two different
  loops, no clue anywhere on the board can tell them apart. Generation checks for this
  directly (`countLoopRoutings`) and discards such answers instead of grinding away at an
  unwinnable board.
- **Clue cells are not removable.** A clue is an obstacle the loop must route around, so
  deleting one changes the answer. What *can* change is where an arrow points — and, in
  loop mode, which cell carries it, since a clue can be demoted back to a black cell and
  promoted elsewhere. Those are the two moves the `--refine` hill-climb uses.

## Difficulty

The score ("DP") sums a weight per applied technique and adds a separate charge for
lookahead: how many deductions needed a trial, and how deep the deepest successful trial
had to propagate.

It is calibrated against the 1,308 published puzzles bundled with gridkit, which carry
human difficulty ratings: **Spearman rank correlation 0.79** between the rating and DP.

| Band | DP | roughly |
|---|---|---|
| intro | < 250 | rating 1–4 |
| easy | < 350 | rating 5–8 |
| medium | < 800 | rating 8–9 |
| hard | < 1600 | rating 10–12 |
| expert | < 3500 | rating 13–15 |
| fiendish | ≥ 3500 | above the corpus |

Reproduce with `node --import tsx tools/calibrate.mjs`.

## Using it as a library

`typescript/src/index.ts` is the public surface; `npm run build` emits `dist/` with type
declarations. The package is part of the `PuzzleTools` pnpm workspace, so puzzle-kit
depends on it with `workspace:*`.

```ts
import { decodeUrl, runAll, difficulty, countSolutions, generateLoop, Rng } from "yajilin-kit";

const board = decodeUrl("yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n");
runAll(board).status;                          // "completed"
countSolutions(board, 2).solutions.length;     // 1 — proved, not assumed
generateLoop(new Rng(1), { cols: 10, rows: 10 });
```

puzzle-kit wires this up in `src/solver/adapters/yajilinKit.ts`, which implements the
existing `SolverAdapter` interface and registers under the id `yajilin-kit`. The
solver-kit backed `yajilin` adapter is left untouched, so nothing that already depends on
it changes behaviour; the new one adds what solver-kit does not provide here — a sound
uniqueness decision, a calibrated difficulty score, and generation. Run
`npx tsx src/solver/adapters/yajilinKit.smoke.ts` from puzzle-kit to exercise the round
trip end to end.

## Verification

- **Against real puzzles.** All 1,308 gridkit problems are decoded and solved. The
  technique solver finishes 1,287 of them; every finished answer passes an independent
  rule check, and no puzzle is ever reported as contradictory. The constraint engine
  proves 1,307 of them unique (one exceeds the node cap), and finds no puzzle with zero or
  multiple solutions.
- **Against the RNG spec.** `tools/check-rng.mjs` compares the fast split-24-bit LCG with
  a straightforward bigint implementation over 100k draws per seed.
- **Across languages.** `testdata/expected/` holds the reference outputs; each port's
  `verify.sh` compares its own output byte for byte with `cmp`. The Python suite also runs
  under PyPy with `PYTHON=pypy3 ./verify.sh`.
- **Every generated puzzle** is re-checked with the independent rule validator and the
  uniqueness search before it is returned.
- **Unit tests** in all three languages (`npm test`, `cargo test`, `python3 -m unittest
  discover -s tests`) cover the pieces a byte comparison cannot localise: the deliberate
  UnionFind NaN semantics, the puzz.link codec, the RNG against an independent
  implementation of the same published algorithm, the rule validator and the propagation
  rules. Each language's `verify.sh` runs them before the golden comparison.

## Performance

10×10 board, Apple Silicon. Generation succeeds on 17 of 20 attempts in either mode; the
rest exhaust their retry budget and are reported as failures rather than as weak puzzles.

| | TypeScript (Node 22) | Rust (release) | CPython 3.12 | PyPy 7.3 |
|---|---|---|---|---|
| generate 5 puzzles | 8.1 s | 3.8 s | 166 s | 69 s |

| solve 5 puzzles | 0.84 s | 0.62 s | 14.4 s | 11.7 s |
| prove uniqueness, 5 puzzles | 13 ms | 9 ms | 714 ms | 144 ms |

All three report the same average difficulty, which is the point: the numbers differ, the
puzzles do not. Per puzzle in TypeScript: solve 59 ms (corpus average), prove uniqueness
8 ms, generate 1.3 s (loop mode median) or 0.6 s (pattern mode median).

### Python and PyPy

The Python sources run unmodified on PyPy, and `PYTHON=pypy3 ./verify.sh` confirms it
produces the same bytes. Whether it is worth using depends entirely on how long the run
is — CPU time, best of three, PyPy 7.3.17 against CPython 3.12:

| Workload | CPython | PyPy | |
|---|---|---|---|
| `solve` one puzzle | 0.22 s | 0.36 s | PyPy 1.6× slower |
| `count` one puzzle | 0.21 s | 0.43 s | PyPy 2.0× slower |
| `generate-loop` 6×6 | 0.46 s | 1.61 s | PyPy 3.5× slower |
| `generate-pattern` 10×10 | 4.6 s | 6.7 s | PyPy 1.5× slower |
| `bench --count 3` | 59.1 s | 24.8 s | **PyPy 2.4× faster** |

The crossover is the JIT warm-up: a one-shot command pays for tracing and never gets it
back, while a batch run amortises it several times over. Use CPython for single puzzles
and PyPy for anything that generates in bulk.

The Python port was also tuned for both runtimes: replacing `IntEnum` members with plain
int constants, inlining `to_id`/`in_board` into the hot predicates, unrolling
`edge_around` over its four directions, and hoisting bound methods and list attributes
into locals. That is worth 1.4× on the technique solver and 1.2× on the full pipeline
under CPython (70.4 s → 59.1 s), and it helps PyPy too. Two micro-optimisations that helped CPython — splitting `list.extend` into
separate `append` calls, and iterating a literal tuple instead of `range(4)` — measurably
hurt PyPy and were reverted; `tools/timeit.sh` is the harness that caught it.

The engine was optimised in three steps, each verified to leave every output byte
unchanged: replacing per-node state copying with a trail-based undo, replacing the bigint
RNG with split 24-bit arithmetic, and replacing full-board propagation passes with work
queues. Together they took a 20-puzzle generation run from 86 s to 17 s — **5.0×**.
Connectivity pruning was added afterwards; it costs some of that back (17 s → 28 s) and
buys a higher success rate (14 → 17 of 20) and boards up to 14×14.

One measurement that did not survive: restarting the answer search after a wasted node
budget. It fixed the blank 15×15 search but made 10×10 generation slower and less
reliable — 25 s/17 successes became 38 s/16 — so it was reverted.

### Where the generator stands

Measured with `tools/bench-generation.mjs`, eight seeds per cell, against the state before
the parity rule and the pattern-mode fallback:

| | before | after |
|---|---|---|
| loop 10×10 | 8/8, 915 ms median | 8/8, 322 ms |
| pattern 10×10 | 8/8, 755 ms | 7/8, 864 ms |
| loop 12×12 | 8/8, 6.8 s | 8/8, 17.8 s |
| pattern 12×12 | **4/8**, 9.9 s | **6/8**, 6.6 s |
| whole run | 28/32, 331 s | 29/32, 216 s |

Eight seeds is noisy, so the decisions were taken on focused sixteen-seed runs of the cell
that moved: pattern 12×12 went from 10/16 to 13/16 with parity, and the same workload from
326 s to 127 s.

## Known limits

- **Loop mode reaches 15×15; pattern mode does not.** Loop mode generates 15×15 boards
  reliably (four of four seeds, all valid and unique) but slowly — three to twenty minutes
  per puzzle against roughly a second at 10×10. Pattern mode stops being practical after
  12×12: its clue positions are fixed by the pattern, so it cannot do what loop mode does
  and keep adding clues until the puzzle is pinned down.
- **Most of what looked like a 15×15 wall was the retry budget.** Three quarters of the
  symmetric patterns drawn at that size have no answer at all, and each one used to consume
  one of the attempts meant for puzzles that merely could not be made unique. Redrawing
  those for free was the single change that opened the size up.
- **Every hole in a loop-mode puzzle starts as a black cell**, so no two clue cells end up
  orthogonally adjacent. Hand-made puzzles have no such restriction. Pattern mode does not
  have this limitation, since the clue positions are chosen first.
- **The technique solver leaves 21 of the 1,308 corpus puzzles unfinished.** Those need
  deductions it does not model; the constraint engine solves them.

## Licence and provenance

The solver is derived from gridkit, part of this same repository. The generator, the
constraint engine and the ports are new work. The RNG reimplements the algorithm
documented for `java.util.Random` from that specification.
