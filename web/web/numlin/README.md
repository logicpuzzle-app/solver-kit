# Numberlink engine bundles

## SAT cube-and-conquer

cspuz_core fork (MIT). See `LICENSE-cspuz_core.txt`, including the upstream
backend notices.

These five files are prebuilt/copied from `numlin_web/www/`:
`scheduler.js`, `worker.js`, `answer.js`, `cspuz_solver_backend.js`, and
`cspuz_solver_backend.wasm`. The SAT artifacts are built from the cspuz_core fork
via `numlin_web/build.sh --sat-only` (`nice -n 15`, four Cargo jobs).
`answer.js` provides the links-format answer renderer shared by both engines.

## Row-scan DFS

rowscan_dfs by wand125 (MIT), built from the public repository
https://github.com/wand125/rowscan_dfs. See `LICENSE-rowscan_dfs.txt`, copied from
`rowscan_dfs/LICENSE`.

Refresh via `numlin_web/build.sh --dfs-only` (`nice -n 15`, four Cargo jobs), then
copy `dfs_solver.js`, `dfs_solver.wasm`, `dfs_worker.js`, and `dfs_scheduler.js`
byte-for-byte from `numlin_web/www/` and verify each with `cmp`.
The wasm solver comes from rowscan_dfs; its worker and scheduler come from
`numlin_web/www/`. DFS counts all solutions; the UI displays at most “2 以上”.

Copy refreshed files together; do not edit them here. Integration code belongs in
`../numlin.js` and `../main.js`.
