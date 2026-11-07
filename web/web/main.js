import { t, currentLang, setLang, applyStatic } from "./i18n.js";
import { isNumlinUrl, localizeNumlinResult } from "./numlin.js";
import { solve as solveSDK, supportedKind } from "./sdk/v1/index.js";
import { CSPUZ_KINDS } from "./sdk/cspuz-kinds.js";
import { resolveEngine, resolveThreads, snapThreads } from "./sdk/options.js";
import { boardSVG } from "./board.js";

const $ = (id) => document.getElementById(id);

let solveController = null;
let solveSeq = 0;
let lastResult = null;
let lastProgress = null;
let lastError = null;

function renderProgress() {
  const p = lastProgress;
  $("solve-progress").textContent = p ? t(p.engine === "dfs"
    ? p.stage === "continuation" ? "progress_dfs_continuation" : "progress_dfs" : "progress_sat", {
    done: p.done, total: p.total, threads: p.threads, direction: p.direction,
    seconds: (p.wall_ms / 1000).toFixed(1),
    estimate: p.percent == null ? "" : t("progress_estimate", { n: p.percent.toFixed(1) }),
  }) : t("solving");
}

function applyLanguage() {
  applyStatic();
  const button = $("solve");
  if (button.disabled) {
    const spin = document.createElement("span");
    spin.className = "spinner";
    button.replaceChildren(spin, t("solving_button"));
  } else button.textContent = t("solve");
  if (lastResult && !$("output").hidden) render(lastResult);
  if (lastError && !$("error").hidden) {
    $("error").textContent = lastError.i18nKey ? t(lastError.i18nKey) : String(lastError.message ?? lastError);
  }
  renderProgress();
}

const list = $("supported-kinds");
for (const { ja, en } of CSPUZ_KINDS) {
  const item = document.createElement("li");
  item.textContent = `${ja} / ${en}`;
  list.append(item);
}
applyLanguage();
for (const input of document.querySelectorAll('[name="language"]')) {
  input.addEventListener("change", () => {
    if (input.checked && input.value !== currentLang()) {
      setLang(input.value);
      applyLanguage();
    }
  });
}

const form = $("form");
const params = new URLSearchParams(location.search);
let savedEngine, savedThreads;
try {
  savedEngine = localStorage.getItem("numlin-engine");
  savedThreads = localStorage.getItem("numlin-threads");
} catch {}
const requestedEngine = params.get("engine") ?? savedEngine;
form.elements.engine.value = requestedEngine === "dfs" || requestedEngine === "sat" ? requestedEngine : "auto";
const requestedThreads = params.has("threads") ? Number(params.get("threads")) : savedThreads;
let settingsOpen = params.has("engine") || params.has("threads");   // 設定アイコンで開閉。URL で指定があれば開いて見せる
function updateNumlinOptions(requested) {
  if (requested !== undefined) {
    // URL の threads は必ず 1/2/4/8 のどれかに丸める（範囲外や 0 は自動の値）。保存値は "auto" も可。
    if (requested === "auto" || requested === null) form.elements.threads.value = "auto";
    else { const n = Number(requested); form.elements.threads.value = String(snapThreads(Number.isInteger(n) && n > 0 ? n : resolveThreads())); }
  }
  const numlin = isNumlinUrl($("url").value);
  $("numlin-settings").hidden = !numlin;
  $("numlin-settings").setAttribute("aria-expanded", String(settingsOpen));
  $("numlin-options").hidden = !(numlin && settingsOpen);
  const engine = resolveEngine($("url").value, form.elements.engine.value), threads = resolveThreads(form.elements.threads.value);
  form.dataset.autoEngine = engine; form.dataset.autoThreads = String(threads);
  $("numlin-auto").textContent = t("auto_choice", { engine: t(engine), threads });
}
$("numlin-settings").addEventListener("click", () => { settingsOpen = !settingsOpen; updateNumlinOptions(); });
function rememberNumlinOptions() {
  try {
    localStorage.setItem("numlin-engine", form.elements.engine.value);
    localStorage.setItem("numlin-threads", form.elements.threads.value);
  } catch {}
}
if (params.has("url")) $("url").value = params.get("url");
updateNumlinOptions(requestedThreads);
$("url").addEventListener("input", () => updateNumlinOptions());
if (params.has("engine") || params.has("threads")) rememberNumlinOptions();
for (const control of document.querySelectorAll('[name="engine"], [name="threads"]')) {
  control.addEventListener("change", () => {
    updateNumlinOptions();
    rememberNumlinOptions();
  });
}

function cancelSolve() {
  if (!solveController) return false;
  const controller = solveController;
  solveController = null;
  controller.abort();
  return true;
}

$("changelog-open").addEventListener("click", () => $("changelog").showModal());
window.addEventListener("pagehide", cancelSolve);

// 難しい盤面は仮置きを深く潜るので数十秒かかることがある。待てないときは止められる。
$("cancel").addEventListener("click", () => {
  if (!cancelSolve()) return;
  $("solving").hidden = true;
  const button = $("solve");
  button.disabled = false;
  button.textContent = t("solve");
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await solve($("url").value);
});
for (const a of document.querySelectorAll(".example")) {
  a.addEventListener("click", async (e) => {
    e.preventDefault();
    $("url").value = a.dataset.url;
    updateNumlinOptions();
    await solve(a.dataset.url);
  });
}

async function solve(input) {
  const text = input.trim();
  if (!text) return;
  cancelSolve();
  const run = ++solveSeq;
  const button = $("solve");
  button.disabled = true;
  const spin = document.createElement("span");
  spin.className = "spinner";
  button.replaceChildren(spin, t("solving_button"));
  lastResult = null;
  lastProgress = null;
  lastError = null;
  $("error").hidden = true;
  $("output").hidden = true;
  $("solving").hidden = false;
  $("solve-progress").textContent = t("solving");
  try {
    if (isNumlinUrl(text)) rememberNumlinOptions();
    solveController = new AbortController();
    const result = await solveSDK(text, {
      engine: form.elements.engine.value,
      threads: form.elements.threads.value,
      signal: solveController.signal,
      onProgress: p => {
        if (run !== solveSeq) return;
        lastProgress = p;
        renderProgress();
      },
    });
    if (run !== solveSeq) return;
    if (result.raw.kind === "numlin") render(localizeNumlinResult(result.raw));
    else if (result.status === "ok") render(result.raw.engine === "cspuz" ? result : result.raw);
    else if (result.status !== "aborted") {
      throw Object.assign(new Error(result.error), { i18nKey: !supportedKind(text) ? "unsupported_puzzle" : result.errorKey === "solver_failed" ? result.errorKey : undefined });
    }
  } catch (err) {
    if (run === solveSeq && String(err?.message) !== "cancelled") {
      lastError = err;
      $("error").textContent = err.i18nKey ? t(err.i18nKey) : String(err?.message ?? err);
      $("error").hidden = false;
    }
  } finally {
    if (run === solveSeq) {
      solveController = null;
      $("solving").hidden = true;
      button.disabled = false;
      button.textContent = t("solve");
    }
  }
}

function render(r) {
  lastResult = r;
  $("board-heading").hidden = true;
  if (r.raw?.engine === "cspuz") renderCspuz(r);
  else if (r.kind === "sudoku") renderSudoku(r);
  else if (r.kind === "slitherlink") renderSlither(r);
  else if (r.kind === "nurikabe") renderNurikabe(r);
  else if (r.kind === "akari") renderAkari(r);
  else if (r.kind === "masyu") renderMasyu(r);
  else if (r.kind === "numlin") renderNumlin(r);
  else renderYajilin(r);
  $("output").hidden = false;
}

function stars(n) {
  const span = document.createElement("span");
  span.className = "stars";
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement("span");
    s.textContent = "★";
    if (i > n) s.className = "off";
    span.append(s);
  }
  return span;
}

const RATING_MIN = 0.5;
const RATING_MAX = 5.49;

// 0.5〜5.49 のスケールに ★1〜5 の範囲を示し、現在値の位置にマーカーを置くバー
function ratingBar(rating) {
  const wrap = document.createElement("div");
  wrap.className = "rating-bar";
  const active = Math.min(5, Math.max(1, Math.round(rating)));
  for (let k = 1; k <= 5; k++) {
    const seg = document.createElement("div");
    seg.className = `rating-seg${k === active ? " active" : ""}`;
    seg.textContent = String(k);
    wrap.append(seg);
  }
  const clamped = Math.min(RATING_MAX, Math.max(RATING_MIN, rating));
  const marker = document.createElement("div");
  marker.className = "rating-marker";
  marker.style.left = `${((clamped - RATING_MIN) / (RATING_MAX - RATING_MIN)) * 100}%`;
  wrap.append(marker);
  return wrap;
}

function verdict({ starCount, label, sub, tone, rating }) {
  const v = $("verdict");
  v.className = tone ?? "";
  v.replaceChildren();
  if (starCount != null) v.append(stars(starCount));
  const l = document.createElement("span");
  l.className = "label";
  l.textContent = label;
  v.append(l);
  if (rating != null) v.append(ratingBar(rating));
  if (sub) {
    const s = document.createElement("span");
    s.className = "sub";
    s.textContent = sub;
    v.append(s);
  }
}

function details(rows) {
  const dl = $("detail");
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  }
}

// When cspuz completed the board, the "partial solution shown" notes no longer hold.
function filled(r, key) {
  return r.fallback?.engine === "cspuz" ? `${key}_filled` : key;
}

function replaceBoard(r) {
  const svg = boardSVG(r, { labels: { answer: t("answer"), problem: t("problem") } });
  if (svg && r.kind === "numlin" && r.answer) svg.classList.add("numlin-answer");
  $("board").replaceChildren(...(svg ? [svg] : []));
}

function renderCspuz(r) {
  verdict({ label: t({ "1": "unique_solution", "2+": "multiple_solutions", "0": "no_solution", "?": "undetermined" }[r.solutions]),
    tone: r.solutions === "?" ? "warn" : r.solutions === "1" ? "" : "bad" });
  const heading = $("board-heading");
  const key = r.solutions === "2+" && r.answerKind === "common" ? "common_cells"
    : r.solutions === "2+" && r.answerKind === "example" ? "example_solution" : null;
  heading.hidden = !key;
  heading.textContent = key ? t(key) : "";
  replaceBoard(r.raw);
  details([
    [t("puzzle"), r.displayName ? `${r.displayName.ja} / ${r.displayName.en}` : r.kind],
    [t("engine"), "cspuz_core（MIT）"],
    [t("elapsed"), `${(r.elapsedMs / 1000).toFixed(3)} s`],
  ]);
}

function renderNumlin(r) {
  const complete = r.status === "complete";
  verdict({
    label: !complete ? t("stopped_error") : r.answers >= 2 ? t("multiple_solutions") : r.answers === 1 ? t("unique_solution") : t("no_solution"),
    sub: t("numlin_difficulty"),
    tone: !complete ? "warn" : r.answers === 1 ? "" : "bad",
  });
  replaceBoard(r);
  if (r.error) {
    $("error").textContent = t("numlin_failed", { error: r.error_key ? t(r.error_key) : r.error });
    $("error").hidden = false;
  }
  details([
    [t("board_size"), r.width ? `${r.width}×${r.height}` : "—"],
    [t("answers_limit"), complete ? r.engine === "dfs" && r.answers >= 2 ? t("at_least_two") : String(r.answers) : t("search_incomplete", { n: Math.min(r.answers, 2) })],
    ...(r.engine === "dfs" ? [] : [[t("winner"), r.winner === "plain" ? t("plain_sat") : r.winner === "cubes" ? t("cube_split") : "—"]]),
    [t("elapsed"), `${(r.wall_ms / 1000).toFixed(3)} s`],
    [t("workers"), r.threads],
    ...(r.engine === "dfs" ? [
      [t("direction"), r.direction ?? "—"],
      [t("steps"), r.steps ?? "—"],
    ] : [[t("cubes"), r.cubes]]),
    [t("engine"), r.engine === "dfs" ? "rowscan_dfs · Row-scan DFS (MIT)" : "cspuz_core fork · SAT cube-and-conquer (MIT)"],
  ]);
}

// ---------------------------------------------------------------- sudoku
function renderSudoku(r) {
  const n = r.size;
  const unique = r.solutions === "1";
  replaceBoard(r);

  let tone = "";
  let label = `★${r.stars}(${(r.rating_hundredths / 100).toFixed(2)})`;
  const notes = [];
  if (r.solutions === "2+") {
    tone = "bad"; label = t("multiple_short");
  } else if (r.solutions === "0") {
    tone = "bad"; label = t("none_short");
  } else {
    notes.push(`DP ${Math.round(r.dp_eff).toLocaleString()}`);
    if (r.solutions === "?") {
      tone = "warn";
      notes.push(t("uniqueness_stopped"));
    }
    if (r.unsolved > 0) {
      tone = "warn";
      notes.push(t("sudoku_remaining", { n: r.unsolved }));
    }
  }
  const showStars = unique || r.solutions === "?";
  verdict({
    starCount: showStars ? r.stars : null,
    label,
    sub: notes.join(" / "),
    tone,
    rating: showStars ? r.rating_hundredths / 100 : null,
  });
  details([
    [t("board"), t("sudoku_board", { n, w: r.block_width, h: r.block_height })],
    [t("dp_techniques"), Math.round(r.dp).toLocaleString()],
    [t("unresolved"), t("cells", { n: r.unsolved })],
    [t("dp_adjusted"), Math.round(r.dp_eff).toLocaleString()],
    [t("solution_count"), r.solutions],
    [t("difficulty_model"), `v${r.difficulty_version ?? 1}`],
    [t("engine"), t("sudoku_engine")],
  ]);
}

// ---------------------------------------------------------------- slitherlink
function renderSlither(r) {
  replaceBoard(r);

  let tone = "";
  let starCount = null;
  let label;
  const notes = [];
  if (r.solutions === "0") {
    tone = "bad"; label = t("none_short");
  } else if (r.solutions === "2+") {
    tone = "bad"; label = t("multiple_short");
  } else {
    starCount = r.stars;
    label = `★${r.stars}(${(r.rating_hundredths / 100).toFixed(2)})`;
    notes.push(`DPN ${Math.round(r.dpn).toLocaleString()}(${r.band})`);
    if (r.solutions === "?") {
      tone = "warn";
      notes.push(t("uniqueness_stopped"));
    }
    if (r.status === "STOPPED") {
      tone = "warn";
      notes.push(t(filled(r, "partial_solution")));
    }
  }
  verdict({
    starCount,
    label,
    sub: notes.join(" / "),
    tone,
    rating: starCount != null ? r.rating_hundredths / 100 : null,
  });
  details([
    [t("board"), `${r.cols}×${r.rows}`],
    [t("dp_raw"), r.dp.toLocaleString()],
    [t("dpn_normalized"), Math.round(r.dpn).toLocaleString()],
    [t("band"), r.band],
    [t("solver_status"), r.status],
    [t("solution_count"), r.solutions],
    [t("difficulty_model"), `v${r.difficulty_version ?? 1}`],
    [t("engine"), "slitherlink-kit"],
  ]);
}

// ---------------------------------------------------------------- yajilin
function renderYajilin(r) {
  replaceBoard(r);

  let tone = "";
  let starCount = null;
  let label;
  const notes = [];
  if (r.solutions === "0") {
    tone = "bad"; label = t("none_short");
  } else if (r.solutions === "2+") {
    tone = "bad"; label = t("multiple_short");
  } else {
    const rating = r.rating_hundredths != null ? r.rating_hundredths / 100 : null;
    starCount = rating != null ? Math.round(rating) : null;
    label = rating != null ? `★${starCount}(${rating.toFixed(2)})` : t("unrated");
    notes.push(`${levelLabel(r.level)}(${r.band})`);
    if (r.solutions === "?") {
      tone = "warn";
      notes.push(t("uniqueness_stopped"));
    }
    if (r.status === "STOPPED") {
      tone = "warn";
      notes.push(t(filled(r, "partial_solution")));
    }
  }
  verdict({
    starCount,
    label,
    sub: notes.join(" / "),
    tone,
    rating: starCount != null ? r.rating_hundredths / 100 : null,
  });
  details([
    [t("board"), `${r.cols}×${r.rows}`],
    [t("reasoning"), levelLabel(r.level)],
    [t("within_level"), (r.dp % 1_000_000).toLocaleString()],
    [t("band"), r.band],
    [t("solver_status"), r.status],
    [t("solution_count"), r.solutions],
    [t("difficulty_model"), `v${r.difficulty_version ?? 1}`],
    [t("engine"), "yajilin-kit"],
  ]);
}

/**
 * ヤジリンの難易度は「解くのに要った読みの段階」が主軸なので、生スコアではなく
 * その段階を見せる。スコアは同じ段階の中の順序でしかないので、詳細側に回す。
 */
function levelLabel(level) {
  return (
    {
      1: t("basic"),
      2: t("row_column_counts"),
      3: t("cut_parity"),
      4: t("line_count_theory"),
      5: t("assumptions"),
      6: t("techniques_incomplete"),
    }[level] ?? t("unknown")
  );
}


/** ぬりかべ。数字はシマの大きさ、黒はかべ、白い点は確定したシマのマス。 */
function renderNurikabe(r) {
  replaceBoard(r);

  let tone = "";
  let starCount = null;
  let label;
  const notes = [];
  if (r.solutions === "0") {
    tone = "bad"; label = t("none_short");
  } else if (r.solutions === "2+") {
    tone = "bad"; label = t("multiple_short");
  } else {
    const rating = r.rating_hundredths != null ? r.rating_hundredths / 100 : null;
    starCount = rating != null ? Math.round(rating) : null;
    label = rating != null ? `★${starCount}(${rating.toFixed(2)})` : t("unrated");
    notes.push(nurikabeLevelLabel(r.level));
    if (r.solutions === "?") {
      tone = "warn";
      notes.push(t("uniqueness_stopped"));
    }
    if (r.status === "STOPPED") {
      tone = "warn";
      notes.push(t(filled(r, "remaining_cells"), { n: r.unknown }));
    }
  }
  verdict({
    starCount,
    label,
    sub: notes.join(" / "),
    tone,
    rating: starCount != null ? r.rating_hundredths / 100 : null,
  });
  details([
    [t("board"), `${r.cols}×${r.rows}`],
    [t("reasoning"), nurikabeLevelLabel(r.level)],
    [t("within_level"), (r.dp % 1_000_000).toLocaleString()],
    [t("solver_status"), r.status],
    [t("solution_count"), r.solutions],
    [t("difficulty_model"), `v${r.difficulty_version ?? 1}`],
    [t("engine"), "nurikabe-kit"],
  ]);
}

/**
 * 美術館。かべは灰色、数字はその上に、照明は電球色の丸。
 *
 * **照らされているかは薄い塗りで示す。** 状態としては持っていない派生量だが、
 * 「まだ暗いのはどこか」が見えないと、途中まで解けた盤面を読めない。
 */
function renderAkari(r) {
  replaceBoard(r);

  let tone = "";
  let starCount = null;
  let label;
  const notes = [];
  if (r.solutions === "0") {
    tone = "bad"; label = t("none_short");
  } else if (r.solutions === "2+") {
    tone = "bad"; label = t("multiple_short");
  } else {
    const rating = r.rating_hundredths != null ? r.rating_hundredths / 100 : null;
    starCount = rating != null ? Math.round(rating) : null;
    label = rating != null ? `★${starCount}(${rating.toFixed(2)})` : t("unrated");
    notes.push(akariLevelLabel(r.level));
    if (r.solutions === "?") {
      tone = "warn";
      notes.push(t("uniqueness_stopped"));
    }
    if (r.status === "STOPPED") {
      tone = "warn";
      notes.push(t(filled(r, "remaining_cells"), { n: r.unknown }));
    }
  }
  verdict({
    starCount,
    label,
    sub: notes.join(" / "),
    tone,
    rating: starCount != null ? r.rating_hundredths / 100 : null,
  });
  details([
    [t("board"), `${r.cols}×${r.rows}`],
    [t("reasoning"), akariLevelLabel(r.level)],
    [t("within_level"), (r.dp % 1_000_000).toLocaleString()],
    [t("solver_status"), r.status],
    [t("solution_count"), r.solutions],
    [t("difficulty_model"), `v${r.difficulty_version ?? 1}`],
    [t("engine"), "akari-kit"],
  ]);
}

/** ましゅ。白丸は輪郭だけ、黒丸は塗り、ループはヤジリンと同じ青。 */
function renderMasyu(r) {
  replaceBoard(r);

  let tone = "";
  let starCount = null;
  let label;
  const notes = [];
  if (r.solutions === "0") {
    tone = "bad"; label = t("none_short");
  } else if (r.solutions === "2+") {
    tone = "bad"; label = t("multiple_short");
  } else {
    const rating = r.rating_hundredths != null ? r.rating_hundredths / 100 : null;
    starCount = rating != null ? Math.round(rating) : null;
    label = rating != null ? `★${starCount}(${rating.toFixed(2)})` : t("unrated");
    notes.push(masyuLevelLabel(r.level));
    if (r.solutions === "?") {
      tone = "warn";
      notes.push(t("uniqueness_stopped"));
    }
    if (r.status === "STOPPED") {
      tone = "warn";
      notes.push(t(filled(r, "remaining_edges"), { n: r.unknown }));
    }
  }
  verdict({
    starCount,
    label,
    sub: notes.join(" / "),
    tone,
    rating: starCount != null ? r.rating_hundredths / 100 : null,
  });
  details([
    [t("board"), `${r.cols}×${r.rows}`],
    [t("reasoning"), masyuLevelLabel(r.level)],
    [t("within_level"), (r.dp % 1_000_000).toLocaleString()],
    [t("solver_status"), r.status],
    [t("solution_count"), r.solutions],
    [t("difficulty_model"), `v${r.difficulty_version ?? 1}`],
    [t("engine"), "masyu-kit"],
  ]);
}

function masyuLevelLabel(level) {
  return (
    {
      1: t("circle_degree"),
      2: t("white_turns"),
      3: t("connectivity_parity"),
      4: t("circle_cases"),
      5: t("shallow"),
      6: t("nested"),
      7: t("techniques_incomplete"),
    }[level] ?? t("unknown")
  );
}

function akariLevelLabel(level) {
  return (
    {
      1: t("clues_lamps"),
      2: t("rescue"),
      3: t("placement_contradiction"),
      4: t("clue_cases"),
      5: t("lighting_cases"),
      6: t("shallow"),
      7: t("nested"),
      8: t("techniques_incomplete"),
    }[level] ?? t("unknown")
  );
}

/**
 * ぬりかべの難易度も「解くのに要った読みの段階」が主軸。
 * 生スコアは同じ段階の中の順序でしかないので、詳細側に回す。
 */
function nurikabeLevelLabel(level) {
  return (
    {
      1: t("around_clues"),
      2: t("counting"),
      3: t("connectivity"),
      4: t("shape_enumeration"),
      5: t("shallow"),
      6: t("nested"),
      7: t("techniques_incomplete"),
    }[level] ?? t("unknown")
  );
}
