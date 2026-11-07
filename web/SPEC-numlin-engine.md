# Numberlink: engine and worker-count selection in solver-web (web/)

Goal: on the solver page, when the pasted URL is a Numberlink puzzle (`p?numlin/`), let the user
choose (1) the engine, SAT cube-and-conquer (current) or Row-scan DFS (new, `rowscan_dfs`), and
(2) the number of workers. Everything else on the site stays unchanged.

Source of the DFS engine: the workspace app `../../../numlin_web/www/` (read-only; it already
runs both engines; study `app.js` (engine radio, DFS_OPTIONS, result rendering), `dfs_scheduler.js`,
`dfs_worker.js`). Do NOT modify anything outside `PuzzleTools/solver-kit/web/`. Do NOT touch the five
SAT files in `web/numlin/` (`scheduler.js`, `worker.js`, `answer.js`, `cspuz_solver_backend.js`,
`cspuz_solver_backend.wasm`): they are being refreshed separately. No commits. `nice -n 15` for any
heavy command. Do not add any puzz.link URL beyond the two samples already in `index.html`.

## 1. Files

- Copy byte-identically from `numlin_web/www/` into `web/numlin/`: `dfs_solver.js`,
  `dfs_solver.wasm`, `dfs_worker.js`, `dfs_scheduler.js`. Verify with `cmp`.
- Add `web/numlin/LICENSE-rowscan_dfs.txt` = `../../../rowscan_dfs/LICENSE` (MIT, wand125), and
  mention it in `web/numlin/README.md` (which engine files come from which project, how to refresh:
  DFS files come from `numlin_web/build.sh --dfs-only`, built from the public repo
  https://github.com/wand125/rowscan_dfs).

## 2. UI (`index.html`, `style.css`, `main.js`)

- Add an options row directly under the form, `id="numlin-options"`, hidden unless the URL input
  currently contains a Numberlink URL (update on `input` events and when a sample link fills the
  field). Contents:
  - エンジン: radio group `engine` with two choices: `sat` 「SAT cube-and-conquer」(default) and
    `dfs` 「Row-scan DFS」. One-line hint under it: SAT は難問の 25×25 向け、DFS は小〜中盤面や
    空白マスのない盤面で速いことが多い (keep it short and factual).
  - ワーカー数: `<select name="threads">` with 1, 2, 4, 8, 16 (filter out values above
    `navigator.hardwareConcurrency || 4` except keep at least 1, 2, 4), default
    `min(hardwareConcurrency || 4, 8)`. For DFS, more than 8 workers is pointless (the direction
    race uses at most 8): clamp to 8 when engine is dfs and say so in the hint.
- Query parameters `?engine=sat|dfs&threads=N` preselect the controls (and the existing `url`
  handling, if any, stays). Remember the last choice in `localStorage` key `numlin-engine` and
  `numlin-threads` (wrap in try/catch).
- Pass `{engine, threads}` to `solveNumlin(text, {engine, threads, onProgress, signal})`.

## 3. Adapter (`numlin.js`)

- `solveNumlin` takes `engine` ('sat' default) and `threads` (default as today).
- SAT path: as today, but `options: {threads, max: 2}`; `threads: worker_count` in result stays.
- DFS path: `DFSScheduler` from `./numlin/dfs_scheduler.js` with
  `options: {threads, direction: 'race', cut: 25, memo_bits: 24, diag_shortcut: false}` (same as
  numlin_web's DFS_OPTIONS; 24 memo bits = 128 MiB per worker), workerFactory → module worker
  `./numlin/dfs_worker.js`, `tick()` every 250 ms if the DFS scheduler has a tick (check; if not,
  no timer), abort → `stop()`. Result (same shape as SAT plus engine fields):
  `{kind:'numlin', ...puzzle, engine:'dfs', answers (= solutions, capped at 2 by the engine: verify
  in dfs_scheduler/app.js; if the DFS counts beyond 2, cap the displayed count to "2 以上"),
  answer, wall_ms, cpu_ms, threads (= number of workers actually created), direction, steps, status,
  error}`. SAT results get `engine:'sat'`.
- Progress for DFS: `{status: phase, engine:'dfs', threads, wall_ms, done: startedDirections or
  finished count, total: number of race directions}` so main.js can show 「解析中… 方向レース
  k/8 · N ワーカー · 12.3 s」. Keep the SAT progress text as today.
- Errors on either engine must resolve to a result with `status:'error'` and `error` text, never a
  thrown exception (as today).

## 4. Rendering (`main.js` `renderNumlin`)

- Details rows depend on the engine:
  - SAT: 盤面サイズ, 解の数(上限 2), 先着, 解析時間, ワーカー数, キューブ数,
    エンジン「cspuz_core fork · SAT cube-and-conquer (MIT)」.
  - DFS: 盤面サイズ, 解の数(上限 2), 解析時間, ワーカー数, 方向 (0–7), ステップ数,
    エンジン「rowscan_dfs · Row-scan DFS (MIT)」.
- Verdict logic unchanged. Answer diagram: both engines return `answer` in the same links format
  (confirm in numlin_web `answer.js` / app.js); reuse `answerSVG`.

## 5. Docs and checks

- README.md (web/): update the Numberlink section (two engines, worker selection, file list,
  licenses). Keep the existing deploy section.
- `scripts/numlin-check.mjs`: add cases: (a) DFS engine on the 15×15 sample completes with
  唯一解 and an answer diagram, details show 「rowscan_dfs」; (b) engine switch via the radio and
  via `?engine=dfs&threads=4` is reflected in the details ワーカー数; (c) options row hidden for a
  sudoku URL, shown for a numlin URL; (d) abort during a DFS run returns to idle. Keep all existing
  cases passing (`SKIP_LARGE=1` run is enough for the 20×20; run the full one once at the end if
  host 1-min load is below 6).
- `npm start` is already running on :8964 (do not restart it; it serves files live). If it is not
  reachable, start it yourself.
- Write `## Results` at the end of this file: files changed, check outputs, any deviation.
- No internal/project-private names in any user-facing text or comments: only "rowscan_dfs",
  "cspuz_core fork", "Row-scan DFS", "SAT cube-and-conquer".

## Results

Implemented engine and worker selection, query preselection, guarded localStorage
persistence, DFS progress/results, engine-specific details, and cancellation.
All writes for this task were under `web/`; no commits were made.

Files changed/added (paths relative to this file's directory):

- `web/index.html`, `web/style.css`, `web/main.js`, `web/numlin.js`.
- `web/numlin/dfs_solver.js`, `web/numlin/dfs_solver.wasm`,
  `web/numlin/dfs_worker.js`, `web/numlin/dfs_scheduler.js`.
- `web/numlin/LICENSE-rowscan_dfs.txt`, `web/numlin/README.md`, `README.md`.
- `scripts/numlin-check.mjs`, this specification's Results section.
- Evidence: `numlin-check.log`, `numlin-check-full.log`, `NUMLIN-DFS.png`.

Checks:

- `cmp` passed for all four DFS files against `numlin_web/www/`, and for
  `LICENSE-rowscan_dfs.txt` against `rowscan_dfs/LICENSE`.
- `node --check` passed for `web/main.js`, `web/numlin.js`, and
  `scripts/numlin-check.mjs`; `git diff --check` passed.
- `SKIP_LARGE=1 nice -n 15 node scripts/numlin-check.mjs`: PASS.
- Host 1-minute load was 5.52 before the full run (below 6).
  `DFS_SCREENSHOT=1 nice -n 15 node scripts/numlin-check.mjs`: PASS,
  Chrome/156.0.8078.80, Node v26.13.0. Full output is in
  `numlin-check-full.log`.
- SAT 15x15: 唯一解, 17 answer paths, 0.096 s. SAT 20x20: 唯一解,
  18 answer paths, 57.887 s. DFS 15x15: 唯一解, 17 answer paths,
  direction 6, 1625 steps, 0.406 s; details show rowscan_dfs.
- PASS: radio and query selection (`engine=dfs&threads=4`), actual worker
  details, saved settings, hardware filtering, DFS clamp, options visibility,
  zero/multiple solutions, API fields, pre-abort, invalid input, partial worker
  startup failure, abort during loading and an active direction race, switching
  puzzle types, mobile overflow checks, and pagehide cleanup. No uncaught browser
  exceptions. DFS screenshot inspected: controls and complete answer diagram render.
- Reused the existing server on :8964 without restarting it. The sandbox's first
  connection probe could not reach it; an unsandboxed probe confirmed HTTP 200.
  The attempted sandbox-only start failed to bind and did not replace the server.
- The five SAT engine files were never written by this task. The backend JS/wasm
  were refreshed separately during the session; the full suite passed against
  the refreshed files. Existing unrelated/uncommitted changes were preserved.

Source findings and deviations/clarifications:

- The copied DFS scheduler has `tick()`; the adapter calls it every 250 ms and
  calls `stop()` on abort. Both engines return the same original-orientation
  `answer.links` format and reuse the existing `answerSVG`.
- DFS does not cap solutions at 2: its scheduler sends no `max`, and the wasm ABI
  defaults `max` to 0 (exhaustive). The raw result retains the solution count;
  the displayed count is capped to “2 以上”, as permitted by the specification.
- The unchanged DFS scheduler retains each direction's wasm state. Selecting 2
  or 4 limits simultaneous direction starts, but a completed eight-direction
  race creates eight workers in total. `threads` and the details show the actual
  created count (8), as required. Tests verify the selected limit through the
  number of workers present at preparation, as well as the details count.
- Edge-case interpretation: when the requested/default count is not one of the
  allowed select values (for example hardwareConcurrency=6), select the greatest
  available value below it (4). This preserves the specified choices and avoids
  a blank selection; the exact numeric default is otherwise used. No other
  implementation deviations.
