# solver-web: Japanese / English toggle for the whole page

Goal: the solver page (`web/web/`) gets a language toggle (日本語 / English) that switches every
user-facing string: header, lead, form placeholder, buttons (解く / 中断 / 解析中…), the sample
links paragraph, the Numberlink options row (エンジン / ワーカー数 / the hint; engine toggle labels
are 並列SAT / 行走査DFS in Japanese and "Parallel SAT" / "Row-scan DFS" in English), progress
text, verdict labels and sub-texts, details row labels and values that are words (e.g. 単体 SAT,
cube 分割, 探索未完了, 難易度判定は未対応…), error messages produced in `main.js` / `numlin.js`,
and the footer (engine table captions/headers). Difficulty band names and other strings that come
from the Rust/wasm JSON (e.g. "基本手筋(intro)") stay as delivered; translate only what the page
itself writes. Title and meta description: keep the Japanese `<title>` in the HTML (SEO) but
update `document.title` on toggle.

Rules: all writes under `web/`; no commits; `nice -n 15`; do not touch `web/web/numlin/*` engine
files. Keep the current markup/behaviour otherwise (toggle buttons for engine and threads were
just added: `.toggle-group`). The existing check script `scripts/numlin-check.mjs` asserts
Japanese strings; keep them passing by making Japanese the language under test (see below).

## Design

- One table `I18N` in a new module `web/web/i18n.js`: `{key: {ja: '…', en: '…'}}`, plus
  `t(key, vars)` with `{n}` substitution, `currentLang()`, `setLang(lang)`, and `applyStatic()`
  which fills every element carrying `data-i18n="key"` (textContent) or `data-i18n-placeholder`,
  `data-i18n-title`, `data-i18n-aria-label` attributes. `main.js` imports `t` and uses it for every
  dynamic string. The numlin_web app (`../../../numlin_web/www/app.js`, read-only) has a similar
  table and a toggle; reuse its wording for the English Numberlink strings where they match.
- Language resolution: `?lang=ja|en` query → `localStorage['solver-lang']` (try/catch) →
  `navigator.language` starts with `ja` ? ja : en. `document.documentElement.lang` follows.
- Toggle control: in the header next to the brand link, a small `.toggle-group`-styled pair
  「日本語」「English」 (radio inputs, same look as the engine toggle). Changing it re-applies static
  strings immediately, re-renders the last result if one is shown (keep the last result object and
  call `render` again), updates the progress line format for a run in flight, and saves the choice.
- The sample paragraph is long: give the whole paragraph two variants (`data-i18n-html` is NOT
  allowed; instead keep the links in the HTML and wrap only the text fragments in
  `<span data-i18n="…">`). Puzzle names: 数独/Sudoku, スリザーリンク/Slitherlink, ヤジリン/Yajilin,
  ぬりかべ/Nurikabe, 美術館/Akari, ましゅ/Masyu, ナンバーリンク/Numberlink.
- English must read naturally (not word-by-word). Keep it concise.

## Checks

- `scripts/numlin-check.mjs`: navigate with `?lang=ja` where the script asserts Japanese text (add
  the parameter in its `navigate()` helper and in the initial page load), and add one case: switch
  to English via the toggle, assert the solve button reads "Solve", the Numberlink engine toggle
  reads "Parallel SAT" / "Row-scan DFS", a finished DFS 15×15 verdict reads "Unique solution" and
  the details contain "Engine"; then switch back to 日本語 and assert the verdict re-renders as
  唯一解 without re-solving (no new worker created). Run `SKIP_LARGE=1 nice -n 15 node
  scripts/numlin-check.mjs` and make it pass. The server on :8964 is running; do not restart it.
- `node --check` on changed JS. No internal/project-private names in user-facing text.
- Write `## Results` at the end of this file (files changed, check output summary, deviations).

## Results

- Files changed: `web/i18n.js` (new, 150 Japanese/English entries and language helpers),
  `web/index.html`, `web/main.js`, `web/numlin.js`, `web/style.css`,
  `scripts/numlin-check.mjs`, and this specification. Paths in this list are relative to `web/`.
- The header toggle translates static text, changelog, footer, result details, accessible labels,
  validation errors, and live progress. Finished results re-render without solving again. Language
  selection follows query → saved preference → browser language, with storage access guarded.
  Rust/wasm-provided text is preserved. Matching English Numberlink wording follows the read-only
  reference app.
- `SKIP_LARGE=1 nice -n 15 node scripts/numlin-check.mjs`: PASS, exit 0
  (Chrome 156.0.8078.80, Node v26.13.0). Existing Japanese SAT/DFS checks pass, including
  cancellation, engine switching, API failures and worker cleanup. Added checks pass for the English
  DFS 15×15 verdict and engine labels, Japanese re-render with no new worker, in-flight switching,
  mobile layouts in both languages, preference precedence/persistence, and browser-language fallback
  with unavailable storage. Output: `numlin-i18n-check.log`.
- `nice -n 15 node --check` passed for all four changed JavaScript files. An additional consistency
  check passed for all 150 translation entries, referenced keys, matching substitution variables,
  and the Japanese HTML title.
- Deviations: none. All writes stayed under `web/`; no engine files under `web/numlin/` were
  changed, no commits were made, and the server on port 8964 was not restarted. The 20×20 completion
  case was skipped as requested by `SKIP_LARGE=1`.
