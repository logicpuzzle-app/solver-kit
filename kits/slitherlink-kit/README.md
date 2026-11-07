# Slitherlink Kit — a solver and generator for Slitherlink

A Slitherlink solver and puzzle generator written in Rust, standard library only. The same seed always
produces the same puzzle. Design notes and rationale live in [DESIGN_JA.md](DESIGN_JA.md) (Japanese).

日本語: [README_JA.md](README_JA.md)

## What it is based on

The **technique solver** is a port of the techniques in `SlitherSolver.java` from `PuzzleTools/sdvx`
(by myamya). Its `numberSolve` / `nextSolve` / `oddSolve` / `connectWhiteSolve` / `finalSolve` were split
into individual deductions. Those techniques lean toward checking a finished board and carry none of the
patterns a human uses, so standard patterns (the 0 rule, adjacent and diagonal 3–3, corner clues, and so on)
and an inside/outside technique were added on top. Each ported file names its Java counterpart in a header
comment.

The **constraint engine** and the **generator** are new. The scaffolding around generation — a deterministic
RNG, a shared CLI, `verify.sh` — follows [the NPGenerator 2007 rewrite](../Puzzle/npgenerator) and
[yajilin-kit](../yajilin-kit/README.md).

## Why there are two solvers

| | Technique solver | Constraint engine |
|---|---|---|
| Code | `solver.rs`, `techniques/` | `engine.rs`, `search.rs` |
| Models | how a person solves | what the rules permit |
| Used for | rating difficulty, deciding clue removal | proving uniqueness |
| Complete | no (it stops when it runs out of ideas) | yes (a decision procedure) |

Difficulty is a claim about human reasoning, so the technique solver measures it. Anything that has to be
**true** — "this puzzle has exactly one solution" — is settled by the constraint engine.

## Build and run

```
cd rust
cargo build --release
./target/release/slither <command>
```

## CLI

```
slither solve <problem>                 # solution, difficulty, rendered board
slither count <problem> [--limit N]     # count solutions (proves uniqueness)
slither generate-loop [options]         # generate by drawing the loop first
slither generate-pattern [options]      # generate from a clue pattern
slither bench [--count N] [--seed N]    # time generation, solving and counting

<problem> is a file path, a puzz.link url, or a bare "slither/W/H/body" code.

  --seed N            rng seed (default 0)
  --size WxH          board size (default 10x10)
  --attempts N        retry budget, 0 = unlimited (default 100)
  --dp-min N/--dp-max N  reject puzzles outside this difficulty range
  --max-nodes N       search node cap, 0 = unlimited (default 200000)
  --symmetry S        none|rot2|rot4|mirror-h|mirror-v
                      (loop default none; pattern default rot2)
  --pattern FILE      explicit clue pattern (pattern mode)
  --exact-reduce      judge clue removal with the full search (see below)
  --no-reduce         keep every clue
  --refine N          hill-climb N rounds for a harder puzzle (default 0)
  --no-trial          solve without the lookahead
  --format F          url|code|text|grid (default grid)
  --out FILE          write to a file instead of stdout
```

## How generation works

**The loop comes first.** Cells are coloured inside or outside, and the border of the inside region is the
loop. The inside set grows from empty, taking a random adjacent cell as long as three invariants hold:

- the inside stays connected
- the outside (including everything off the board) stays connected — otherwise you get two loops
- no lattice point ends up with exactly two diagonally opposite inside cells around it — that point would
  collect four lines and the border would become a figure eight

Keeping all three means the border is exactly one closed loop. A **local search that lengthens the border**
then runs. Growth alone yields a compact blob with a short border, which produces puzzles where whole rows
carry no line at all. The target is 40–55% of all edges; real puzzles measure 39–50%.

Every cell is then labelled with the number of loop edges around it, and clues are removed in shuffled order,
keeping a removal when the puzzle stays unique and undoing it otherwise. With `--symmetry`, each rotational
or mirror orbit is removed as one group. `rot4` requires a square board.

### Two modes for clue removal

| Mode | How removal is judged | Speed | What you get |
|---|---|---|---|
| default | can the technique solver finish without lookahead? | fast | puzzles a human can solve with techniques |
| `--exact-reduce` | is the puzzle unique per the constraint engine? | slow | anything unique, however hard |

The default mode still guarantees uniqueness. Every deduction the technique solver makes is sound — it uses
only necessary conditions, and its lookahead is the sound step "assuming one side leads to a contradiction,
so the other holds". If techniques alone pin down every edge, that solution has been proven unique.

Measured on 10x10, seed 4:

| Mode | Time | Clues | DP |
|---|---:|---:|---:|
| default | 0.75 s | 40 | 944 |
| `--exact-reduce` | 23.6 s | 39 | 3684 |

One clue's difference moves the difficulty a long way.

## Difficulty

The score (DP) sums a weight per applied technique and charges for lookahead.

```
DP = Σ weight(technique) × count + 40 × deductions needing lookahead + 25 × deepest successful lookahead²
```

| Band | DP | Human rating it maps to |
|---|---|---|
| intro | < 490 | the easiest end of ★1 |
| easy | < 1306 | ★1 |
| medium | < 3376 | ★2 |
| hard | < 5014 | ★3 |
| expert | < 12657 | ★4 |
| fiendish | ≥ 12657 | ★5 |

Weights and thresholds were fitted against 1,585 human-rated puzzles from Puzzle Square
(Spearman rank correlation **0.719** under 5-fold cross-validation, 0.004 below the training figure).
The run is recorded in [testdata/CALIBRATION_JA.md](testdata/CALIBRATION_JA.md) (Japanese).

```
slither calibrate ../testdata/puzsq-corpus.tsv --rounds 20 --trial-limit 100
```

The command solves the corpus in parallel, reports the Spearman rank correlation between DP and the human
ratings before and after fitting, and prints suggested weights and band thresholds. It never rewrites
`reasons.rs` — adopting a weight is a human decision.

Two findings from that run are worth knowing. Puzzles the technique solver cannot finish must be kept in
the correlation (they are the hard ones — only 23% of the top-rated puzzles get solved), and what the fit
rewards is lookahead depth, not how often the standard patterns fire.

## Techniques

Ported from sdvx: `cell_exact` / `cell_forced` / `vertex_close` / `vertex_extend` / `vertex_dead` /
`parity_line` / `connect_line` / `no_small_loop`

Standard patterns (new): `zero_cell` / `three_pair` / `three_diagonal` / `three_zero_diagonal` /
`three_zero_adjacent` / `corner_clue` / `three_incoming` / `one_blocked_corner` / `two_blocked_corner` /
`clue_corner_pair`

Inside/outside: `inside_outside` tracks whether cells lie inside or outside the loop with a parity
union-find, and fixes an edge whenever the relation across it is already known. What it genuinely adds is
the lattice-point rule: around a point with neighbouring cells A, B, C, D, only "A = D and B = C and A ≠ B"
is forbidden (that is the case that makes the degree four), so knowing two of the three relations forces
the third.

## Verification

- **Agreement with the pzprjs reference.** For the 5x5 puzzle in `pzprjs/test/script/slither.js`, both the
  decoded board and the solution (12 horizontal and 18 vertical edges) match this implementation exactly
- **Regression on real puzzles.** The five puzzles in
  [testdata/unique-problems.txt](testdata/unique-problems.txt) (5x5 through 12x10) are checked for
  uniqueness and for agreement between the two solvers. That file also records the data found elsewhere in
  PuzzleTools that turned out **not to be valid puzzles** — no solution, several solutions, or a body that
  overruns the cell count — with the reason each was excluded
- **Soundness of every technique.** Random small boards are fully enumerated, each technique is applied on
  its own, and every edge it fixes is checked against all solutions of that board. This runs over 300 boards
  for all 19 techniques, both from an empty state and from partial states built by revealing 30–60% of a
  real solution. No violation has been found
- **Correctness of generated puzzles.** The generated border is verified as a single loop by
  `solution.rs`, which is written independently of the generator
- **Determinism.** `rust/verify.sh` checks that a seed reproduces its puzzle exactly

## Benchmark (Apple M4 Pro, 10x10, seed 1, count 5)

| | |
|---|---|
| Generation | 11.1 s for 5 puzzles |
| Solving (technique solver) | 169 ms for 5 |
| Proving uniqueness (constraint engine) | 721 ms for 5, 25,403 nodes |
| Mean DP | 1057 |
