# Third-party notices

## GPL-3.0-or-later

- `vendor/npgenerator` (submodule, https://github.com/logicpuzzle-app/npgenerator):
  Rust rewrite of NPGenerator V2.0.2, Copyright (C) 2007 Time Intermedia Corporation.
  The `solver_wasm` build (`web/wasm`, served as `web/web/pkg/solver_wasm_bg.wasm`) links it
  and is therefore distributed under GPL-3.0-or-later. The full license text is in
  `vendor/npgenerator/java/LICENSE`.

## MIT

- `web/web/numlin/` — cspuz_core / cspuz_rs_puzzles (Copyright (c) 2021- semiexp), its fork
  (wand125/cspuz_core), Glucose and MiniSat: see `web/web/numlin/LICENSE-cspuz_core.txt`.
  rowscan_dfs (Copyright (c) 2026 wand125): see `web/web/numlin/LICENSE-rowscan_dfs.txt`.
- `web/web/cspuz-board.js` — port of cspuz-solver2 `packages/puzzle-board`,
  Copyright (c) 2022 semiexp (license header in the file).
- Techniques and solver structure derived from [sdvx](https://github.com/3892myamya/sdvx)
  by myamya: `packages/solver-kit/` (core and solvers) and parts of `kits/` (e.g.
  `kits/slitherlink-kit`, `kits/nurikabe-kit/rust/src/techniques/reachable.rs`).
  The sdvx license follows.

```
MIT License

Copyright (c) 2019 みゃーみゃ(myamya)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
