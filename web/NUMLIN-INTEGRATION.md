# Numberlink integration — 2026-11-05

The initial integration below was implemented locally in `solver-kit/web`. The portfolio update
at the end records the subsequent authorized changes to both `numlin_web/` and this directory.
No commit, push, deployment, or engine rebuild was performed. `rowscan_dfs/` and
`cspuz_core/` were not modified.

## Implementation

- Added `web/numlin.js`: URL detection, puzzle decoding, Scheduler Promise adapter,
  `min(hardwareConcurrency || 4, 8)` workers, answer cap 2, and the other upstream defaults.
  Progress reports contain `status`, `done`, `total`, `threads`, and `wall_ms`.
  Results contain every field specified in the integration spec.
- Copied the five SAT files to `web/numlin/` unchanged, with the full upstream license
  (including backend notices) and a README identifying the prebuilt fork and refresh procedure.
  No DFS files were copied.
- Routed Numberlink separately in `web/main.js`; added progress, answer SVG styling, clue-only
  boards, verdicts and details. No stars or difficulty bar are shown for Numberlink.
  Incomplete runs are never reported as unique or unsatisfiable.
- Abort calls the upstream `Scheduler.stop()` → `finish('stopped')` path, which terminates
  every worker. Timers and abort listeners are cleared. Startup failure uses `finish('error')`.
  New requests and page departure cancel active work; stale results cannot replace a newer run.
- Updated metadata, lead, placeholder, the two size-labelled samples, the dated changelog,
  engine attribution and the main README.
- `server.js` required no change: the installed Express static MIME mapping and actual HTTP
  responses already serve `.wasm` as `application/wasm` and `.js` as
  `application/javascript; charset=UTF-8`, with `Cache-Control: no-cache`.
  Real same-origin module workers loaded successfully without COOP/COEP or SharedArrayBuffer.
  The existing `web/worker.js` and `web/pkg/` engines are unchanged.

The count follows the fork's existing canonical shortcut normalization, strong cube rules and
wedge SAT rules. It does not enumerate every geometrically different unnormalized path.
Difficulty rating is unsupported, as stated in the UI and README.

## Verification

Environment: Node `v24.22.1`, headless `Chrome/156.0.8078.80`, 8 Numberlink workers.
A fresh browser profile under this directory was used and removed afterward; existing browsers
and profiles were not controlled.

Commands run:

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache=./.npm-cache --fetch-retries=0 --fetch-timeout=20000
npm start
node --check server.js
node --check web/main.js
node --check web/numlin.js
node --check web/numlin/scheduler.js
node --check web/numlin/worker.js
node --check web/numlin/answer.js
node --check web/numlin/cspuz_solver_backend.js
node --check scripts/numlin-check.mjs
BASE='http://[::1]:8080/' SCREENSHOT=1 node scripts/numlin-check.mjs
BASE='http://[::1]:8080/' SKIP_LARGE=1 SCREENSHOT=1 node scripts/numlin-check.mjs
git diff --check
```

All JavaScript syntax checks and `git diff --check` passed. No build was needed.
The first dependency-install attempt was blocked by sandbox network access; the subsequent
permitted install succeeded. The sandbox also required permission to bind the local server.
An existing unrelated IPv4 listener on port 8080 returned 404; the app started by `npm start`
was tested on IPv6 port 8080 instead. The existing listener was left untouched. The server started for this verification was stopped afterward.

Browser results:

| Case | Result |
| --- | --- |
| Spec 15×15 sample | Unique, 1 answer, 113 initial cubes, 17 rendered paths; 0.886 s first run / 0.907 s final run |
| Spec 20×20 sample | Unique, 1 answer, 595 initial cubes, 18 rendered paths; 71.026 s |
| `p?numlin/2/2/1221` | 0 answers; no-solution verdict and clue-only SVG |
| `p?numlin/5/5/3i23l21o1g` | 2 answers; multiple-solutions verdict and first-answer SVG |
| Invalid clue encoding | Error verdict and error message; no rating |
| Progress | Cube done/total, 8 workers and elapsed seconds updated while running |
| Cancel during loading and after startup | Incomplete verdict; all created Numberlink workers terminated |
| Switch Numberlink → yajilin → Numberlink | Correct current result; no stale board or error |
| Existing first yajilin example | Completed, 1 solution, ★1(1.33), v5, SVG rendered |
| API contract / embedded `p?numlin/` path | Result fields, count cap and answer verified |
| Already-aborted signal | Stopped result without creating workers |
| Worker constructor fails after two successful creations | Error result; both workers terminated |
| Page departure | Active Numberlink workers terminated |
| 375px viewport | Page and board fit without horizontal overflow |
| Browser exceptions | None in the final test run |

The original multiple-solution test used `p?numlin/3/3/1m1`, which this engine correctly
normalizes to one answer. That test expectation was corrected to the 5×5 fixture above.
The first example run verified both large samples before stopping at that incorrect expectation;
the final run passed all assertions, skipping only the already verified 20×20 full search.

[15×15 screenshot](NUMLIN-INTEGRATION.png) was inspected visually: the coloured paths,
clues, outer grid and no-rating verdict render correctly at the existing board scale.

## Copied artifact integrity

These hashes describe the initial integration, before the portfolio update below.

Compared all five copied files byte-for-byte with `numlin_web/www/`: all identical.
The license is also byte-identical to `cspuz_core/LICENSE`. The source wasm passed
`WebAssembly.validate` (3,259,318 bytes).

| File | SHA-256 |
| --- | --- |
| `scheduler.js` | `bc01fff20e4502c4b231fdf78ec98ca42f904506a2531ae803500453db4f9f9f` |
| `worker.js` | `889ff027356e0416a855cfe62bd71c5caf583c5b2d43f868c9ca9b6c3dd62eea` |
| `answer.js` | `22852cd1732c6d31447b9dbccf20d80b8c0a90aca45cd78c8731efee9149e4dc` |
| `cspuz_solver_backend.js` | `73e8e93c0788371d867fb670308efa3d697c923a6888c38de5fe2d2e33b80848` |
| `cspuz_solver_backend.wasm` | `153629d48c178c11aeb1ff3b80ec3b570e6b0fb65074efb0ec43f3099e5e38eb` |

## Git status

Initial `git status --short` was empty. Final status from this directory:

```text
 M README.md
 M web/index.html
 M web/main.js
 M web/style.css
?? NUMLIN-INTEGRATION.md
?? NUMLIN-INTEGRATION.png
?? scripts/numlin-check.mjs
?? web/numlin.js
?? web/numlin/
```

Nothing was committed, pushed or deployed.

## Portfolio update

The copied scheduler and worker now match `numlin_web/www/`. The portfolio races an empty-cube
`numlin_solve_cube` call against generation plus cube solving, using identical strong cube / wedge
SAT / full-cover settings and canonical answer cap 2. An empty `edges: []` and `next: 0` are
accepted by the existing Rust ABI, and its response already includes the answer diagram.

`solveNumlin` uses the shared default worker count and forwards `winner`, `plain_ms`, and `cube_ms`; the details show 「先着」 as
「単体 SAT」 or 「cube 分割」. Worker counts include the additional worker in layout C.
Errors on either side allow the other side to continue. Abort, replacement requests and page
exit terminate both sides. Layout constants and optional deferred start live in the upstream
scheduler; normal runs cancel the loser. Measurement can retain cubes after a plain verdict.

Validation used `nice -n 15` and fresh headless Chrome/156.0.8078.80. The root harness
uses Node v24.22.1; the solver-web directory uses Node v26.13.0:

- `node --test numlin_web/tests/*.test.mjs`: 29/29 passed, including actual wasm through
  worker_threads for both winners and option/count parity.
- `node numlin_web/tools/browser-check.mjs`: all 10 browser checks passed, including B/C and
  Japanese/English winner text.
- `node scripts/numlin-check.mjs`: final full run passed, including 15×15 (1.011 s),
  20×20 (73.218 s), expanded B/C adapter/UI cases, cancellation and existing engines.
  The final `SKIP_LARGE=1` repeat also passed. Both plain and cube winners rendered; C showed 9 workers.
- All changed JavaScript files passed syntax checks; copied scheduler/worker are byte-identical.

Full validation outputs are in `numlin_web/measurements/portfolio/` at the workspace root.
The final 20×20 browser regression run took 73.218 s; this is a functional check,
not a low-load layout comparison. Comparative measurements and the default decision follow.

Adopted default: size rule. The copied scheduler now chooses C with immediate plain SAT for
`width * height <= 400`, and A for larger boards. `solveNumlin` inherits this default without
forcing a layout. Explicit `portfolio` and `layout` options remain available in the scheduler.
The following measurements describe the earlier global-default decision.
Size-rule validation: 31/31 upstream unit tests passed; `SKIP_LARGE=1 nice -n 15 node
scripts/numlin-check.mjs` passed, including the default 15×15 race with 9 workers, B/C
overrides, API checks and cancellation. The copied scheduler is byte-identical to upstream.

Chosen layout: **A — 8 cube workers, no plain worker by default**. The closest portfolio,
C with deferred start, took 797.220 s on g34 versus A's 756.840 s (+5.34%), exceeding the
2% limit (771.977 s). Immediate B/C and deferred B also failed. The default therefore stays A;
B/C remain available through `Scheduler` options. Optional portfolios default to
`plain_start: 'after_generation'`; `plain_start: 'immediate'` starts the immediate race.

The implementation races `numlin_solve_cube` with `{edges: [], next: 0, est: 0}` against
cube generation/solving, with identical rule options and answer cap. Read-only inspection of
`numlin_web.rs` verified that the empty edges are accepted and return the first model's diagram.
Results carry the winning diagram, `winner`, `plain_ms` and `cube_ms`. Stop cancels both sides;
a worker failure on one side leaves the other running. Both front-ends show the winner.

Environment: Apple M4 Pro, 14 logical CPUs, N=8, root Node v24.22.1, solver-web Node v26.13.0,
headless Chrome/156.0.8078.80. All solver/test commands used `nice -n 15`. No commits or wasm
rebuilds were made. Edits stayed in `numlin_web/` and `PuzzleTools/solver-kit/web/`.

The full immediate matrix has two runs per smaller board and one g34 run per layout.
After both immediate portfolios failed, g34 was remeasured once for each deferred layout,
with cubes allowed to finish after a plain verdict. Neither deferred layout passed the hard-case
gate, so further deferred small-board latency repeats were unnecessary. All 23 runs completed,
all started below one-minute load 6, all returned canonical count 1, and none had a side error.
`uptime` was recorded before every run. Host load rose during some runs; these are observations
under changing host load, not a general speed guarantee. The decision conservatively retains A.

Times below are measured from `Scheduler.start()` and include worker loading and generation.
A dash means that side was cancelled before its verdict. The supplied 25×25 URL was passed
only on the command line and redacted from saved artifacts.

| Start | Layout | Board | Run | Wall (s) | Winner | Plain (s) | Cubes (s) |
| --- | --- | --- | --- | ---: | --- | ---: | ---: |
| immediate | A | g34_nl5 | 1 | 756.840 | cubes | — | 756.840 |
| immediate | B | g34_nl5 | 1 | 896.573 | cubes | — | 896.573 |
| immediate | C | g34_nl5 | 1 | 893.534 | cubes | — | 893.534 |
| immediate | A | ex3 | 1 | 3.884 | cubes | — | 3.884 |
| immediate | A | ex3 | 2 | 4.890 | cubes | — | 4.890 |
| immediate | B | ex3 | 1 | 0.740 | plain | 0.740 | — |
| immediate | B | ex3 | 2 | 0.551 | plain | 0.551 | — |
| immediate | C | ex3 | 1 | 0.526 | plain | 0.526 | — |
| immediate | C | ex3 | 2 | 0.526 | plain | 0.526 | — |
| immediate | A | p2592 | 1 | 78.927 | cubes | — | 78.927 |
| immediate | A | p2592 | 2 | 77.075 | cubes | — | 77.075 |
| immediate | B | p2592 | 1 | 60.222 | plain | 60.222 | — |
| immediate | B | p2592 | 2 | 60.495 | plain | 60.495 | — |
| immediate | C | p2592 | 1 | 59.757 | plain | 59.757 | — |
| immediate | C | p2592 | 2 | 59.161 | plain | 59.161 | — |
| immediate | A | p7933 | 1 | 65.879 | cubes | — | 65.879 |
| immediate | A | p7933 | 2 | 71.482 | cubes | — | 71.482 |
| immediate | B | p7933 | 1 | 75.284 | cubes | — | 75.284 |
| immediate | B | p7933 | 2 | 74.144 | cubes | — | 74.144 |
| immediate | C | p7933 | 1 | 69.063 | cubes | — | 69.063 |
| immediate | C | p7933 | 2 | 69.224 | cubes | — | 69.224 |
| after_generation | B | g34_nl5 | 1 | 876.368 | cubes | — | 876.368 |
| after_generation | C | g34_nl5 | 1 | 797.220 | cubes | — | 797.220 |

| Start | Layout | Cube time (s) | Change vs A | Start / end 1-min load |
| --- | --- | ---: | ---: | --- |
| immediate | A | 756.840 | +0.00% | 5.70 / 108.17 |
| immediate | B | 896.573 | +18.46% | 5.72 / 63.20 |
| immediate | C | 893.534 | +18.06% | 5.93 / 145.20 |
| after_generation | B | 876.368 | +15.79% | 5.96 / 82.77 |
| after_generation | C | 797.220 | +5.34% | 5.83 / 203.85 |

| Layout | Mean p2592 / p7933 wall (s) | Immediate hard-case budget |
| --- | ---: | --- |
| A | 73.341 | reference |
| B | 67.536 | fails |
| C | 64.301 | fails |

Final copied scheduler SHA-256: `4ec92db50154f1fcdf828722ee526252af6e391444293625508e1887d3a20bab`.
Final copied worker SHA-256: `8bae635ffb9539778e966120170b79141a25d7d9c61bfcc31e237f2a45aea3b8`.
The wasm hash remains `153629d48c178c11aeb1ff3b80ec3b570e6b0fb65074efb0ec43f3099e5e38eb`.
All five SAT artifacts remain byte-identical to `numlin_web/www/`; the copied README is preserved.

Final logs and per-run uptime records are in `numlin_web/measurements/portfolio/` at the
workspace root. `solver-web-full-check.txt` records the final complete integration run,
and `solver-web-check.txt` records the expanded repeat checks.
