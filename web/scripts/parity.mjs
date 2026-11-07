/*
 * wasm とネイティブ CLI の出力一致検証。
 *
 * 数独: puzsq 較正時の results.tsv(ネイティブ npgen solve の DP/未確定マス数)と
 *       wasm の solve_url を全問突き合わせる。
 * ヤジリン / スリザーリンク / ぬりかべ / 美術館: corpus.tsv からサンプルを取り、
 *       ネイティブ CLI の DP/STATUS(あるものは SOLUTIONS/RATING)と比較する。
 *
 * Usage: node scripts/parity.mjs <sudoku-raw.json> <results.tsv> [sample-count]
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "../web/pkg");
const wasm = await import(join(pkgDir, "solver_wasm.js"));
await wasm.default(readFileSync(join(pkgDir, "solver_wasm_bg.wasm")));

const [rawPath, resultsPath, yjSampleArg] = process.argv.slice(2);

// ---------------- sudoku ----------------
// 較正時の成果物(sudoku-raw.json / results.tsv)は追跡していないので、
// 引数がなければ数独は飛ばして kits 4 種だけ突き合わせる。
const expected = new Map();
let raw = {};
if (rawPath && resultsPath) {
  raw = JSON.parse(readFileSync(rawPath, "utf8"));
  for (const line of readFileSync(resultsPath, "utf8").trim().split("\n").slice(1)) {
    const [id, , , dp, unsolved] = line.split("\t");
    expected.set(id, { dp: Number(dp), unsolved: Number(unsolved) });
  }
} else {
  console.log("sudoku parity: skipped (no <sudoku-raw.json> <results.tsv> args)");
}

let ok = 0;
let bad = 0;
for (const [id, exp] of expected) {
  const url = raw[id]?.url ?? "";
  let got;
  try {
    got = JSON.parse(wasm.solve_url(url));
  } catch (e) {
    console.log(`sudoku ${id}: wasm error: ${e.message}`);
    bad++;
    continue;
  }
  // results.tsv は 0.1 単位に丸め済み
  if (Math.abs(got.dp - exp.dp) <= 0.051 && got.unsolved === exp.unsolved) {
    ok++;
  } else {
    bad++;
    console.log(
      `sudoku ${id}: dp wasm=${got.dp.toFixed(1)} native=${exp.dp} unsolved wasm=${got.unsolved} native=${exp.unsolved}`
    );
  }
}
console.log(`sudoku parity: ${ok} ok / ${bad} mismatch (of ${expected.size})`);

// ---------------- yajilin ----------------
const yjSample = Number(yjSampleArg ?? 40);
const corpusPath = resolve(
  here,
  "../../kits/yajilin-kit/typescript/testdata/corpus.tsv"
);
const yjBin = resolve(here, "../../kits/yajilin-kit/rust/target/release/yajilin");
const rows = readFileSync(corpusPath, "utf8").trim().split("\n");
const step = Math.max(1, Math.floor(rows.length / yjSample));
let yok = 0;
let ybad = 0;
for (let i = 0; i < rows.length; i += step) {
  const [id, , query] = rows[i].split("\t");
  const url = `https://puzz.link/p?${query}`;
  const got = JSON.parse(wasm.solve_url(url));
  const native = spawnSync(yjBin, ["solve", url], { encoding: "utf8" }).stdout ?? "";
  const nativeDp = Number(native.match(/^DP (\d+)/m)?.[1]);
  const nativeStatus = native.match(/^STATUS (\w+)/m)?.[1];
  const nativeRating = native.match(/^RATING ([\d.]+)/m)?.[1];
  const gotRating =
    got.rating_hundredths != null
      ? `${Math.floor(got.rating_hundredths / 100)}.${String(got.rating_hundredths % 100).padStart(2, "0")}`
      : null;
  if (got.dp === nativeDp && got.status === nativeStatus &&
      (nativeRating === "-" ? got.rating_hundredths == null : gotRating === nativeRating)) {
    yok++;
  } else {
    ybad++;
    console.log(
      `yajilin ${id}: wasm dp=${got.dp} status=${got.status} rating=${gotRating} / native dp=${nativeDp} status=${nativeStatus} rating=${nativeRating}`
    );
  }
}
console.log(`yajilin parity: ${yok} ok / ${ybad} mismatch`);

// ---------------- slitherlink ----------------
const slCorpus = resolve(
  here,
  "../../kits/slitherlink-kit/testdata/puzsq-corpus.tsv"
);
const slBin = resolve(here, "../../kits/slitherlink-kit/rust/target/release/slither");
const slRows = readFileSync(slCorpus, "utf8")
  .trim()
  .split("\n")
  .filter((l) => !l.startsWith("#"));
const slStep = Math.max(1, Math.floor(slRows.length / yjSample));
let sok = 0;
let sbad = 0;
for (let i = 0; i < slRows.length; i += slStep) {
  const cols = slRows[i].split("\t");
  const query = cols.find((c) => c.startsWith("slither/"));
  const id = cols[0];
  const url = `https://puzz.link/p?${query}`;
  const got = JSON.parse(wasm.solve_url(url));
  const native = spawnSync(slBin, ["solve", url], { encoding: "utf8" }).stdout ?? "";
  const nativeDp = native.match(/^DP (\S+)/m)?.[1];
  const nativeDpn = native.match(/^DPN (\S+)/m)?.[1];
  const nativeBand = native.match(/^BAND (\S+)/m)?.[1];
  const nativeStatus = native.match(/^STATUS (\w+)/m)?.[1];
  const dpnMatch =
    nativeDpn === "-" || Math.abs(got.dpn - Number(nativeDpn)) < 1e-3;
  const dpMatch = nativeDp === "-" ? got.solutions === "2+" : got.dp === Number(nativeDp);
  const bandMatch = nativeBand === "-" ? got.solutions === "2+" : got.band === nativeBand;
  if (dpMatch && dpnMatch && bandMatch && got.status === nativeStatus) {
    sok++;
  } else {
    sbad++;
    console.log(
      `slither ${id}: wasm dp=${got.dp} dpn=${got.dpn?.toFixed(3)} band=${got.band} status=${got.status} sols=${got.solutions} / native dp=${nativeDp} dpn=${nativeDpn} band=${nativeBand} status=${nativeStatus}`
    );
  }
}
console.log(`slither parity: ${sok} ok / ${sbad} mismatch`);

// ---------------- nurikabe / akari ----------------
// どちらも corpus.tsv が「id \t 申告 \t クエリ」で、CLI が
// STATUS / SOLUTIONS / DP(一意でなければ "-")/ RATING を出す。
function ratingText(hundredths) {
  return hundredths != null
    ? `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`
    : null;
}

function corpusParity(name, corpusRel, binRel) {
  const corpus = resolve(here, corpusRel);
  const bin = resolve(here, binRel);
  const rows = readFileSync(corpus, "utf8").trim().split("\n");
  const step = Math.max(1, Math.floor(rows.length / yjSample));
  let ok = 0;
  let bad = 0;
  for (let i = 0; i < rows.length; i += step) {
    const [id, , query] = rows[i].split("\t");
    const url = `https://puzz.link/p?${query}`;
    const got = JSON.parse(wasm.solve_url(url));
    const native = spawnSync(bin, ["solve", url], { encoding: "utf8" }).stdout ?? "";
    const nativeDp = native.match(/^DP (\S+)/m)?.[1];
    const nativeStatus = native.match(/^STATUS (\w+)/m)?.[1];
    const nativeSolutions = native.match(/^SOLUTIONS (\S+)/m)?.[1];
    const nativeRating = native.match(/^RATING (\S+)/m)?.[1];
    const dpMatch = nativeDp === "-" || got.dp === Number(nativeDp);
    const ratingMatch =
      nativeRating === "-"
        ? got.rating_hundredths == null
        : ratingText(got.rating_hundredths) === nativeRating;
    if (dpMatch && ratingMatch && got.status === nativeStatus && got.solutions === nativeSolutions) {
      ok++;
    } else {
      bad++;
      console.log(
        `${name} ${id}: wasm dp=${got.dp} status=${got.status} sols=${got.solutions} rating=${ratingText(got.rating_hundredths)} / native dp=${nativeDp} status=${nativeStatus} sols=${nativeSolutions} rating=${nativeRating}`
      );
    }
  }
  console.log(`${name} parity: ${ok} ok / ${bad} mismatch`);
  return bad;
}

const nbad = corpusParity(
  "nurikabe",
  "../../kits/nurikabe-kit/testdata/corpus.tsv",
  "../../kits/nurikabe-kit/rust/target/release/nurikabe"
);
const abad = corpusParity(
  "akari",
  "../../kits/akari-kit/testdata/corpus.tsv",
  "../../kits/akari-kit/rust/target/release/akari"
);
const mbad = corpusParity(
  "masyu",
  "../../kits/masyu-kit/testdata/corpus.tsv",
  "../../kits/masyu-kit/rust/target/release/masyu"
);
process.exit(bad + ybad + sbad + nbad + abad + mbad === 0 ? 0 : 1);
