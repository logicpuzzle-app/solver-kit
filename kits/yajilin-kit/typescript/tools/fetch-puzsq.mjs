/*
 * Pulls the Yajilin corpus from puzzle-square's public API and writes it as a flat TSV.
 *
 * puzsq exposes an unauthenticated, cached read API per puzzle kind. Yajilin is kind 3
 * (kind 65 is Regional Yajilin, a different puzzle). The response is keyed by problem id
 * and carries the author-declared difficulty on a 1-5 scale alongside the puzz.link url,
 * which is exactly what a difficulty calibration needs.
 *
 * Usage: node tools/fetch-puzsq.mjs [kindId] [outfile]
 */

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ENDPOINT = "https://loadproblemdatabykindforapi-rltrc6bpka-an.a.run.app";
const YAJILIN_KIND = 3;

const here = dirname(fileURLToPath(import.meta.url));
const kindId = Number.parseInt(process.argv[2] ?? String(YAJILIN_KIND), 10);
const target = process.argv[3] ?? resolve(here, "../testdata/puzsq-yajilin.tsv");

const response = await fetch(`${ENDPOINT}?id=${kindId}`);
if (!response.ok) {
  console.error(`fetch failed: HTTP ${response.status}`);
  process.exit(1);
}
const payload = await response.json();

const lines = [];
let skipped = 0;
for (const [id, problem] of Object.entries(payload)) {
  // Variants play by different rules and would only muddy the calibration.
  if (problem.variation !== 0) {
    skipped++;
    continue;
  }
  const url = typeof problem.url === "string" ? problem.url : "";
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : url;
  if (!query.startsWith("yajilin/")) {
    skipped++;
    continue;
  }
  lines.push(
    [id, problem.difficulty, (problem.registered ?? "").slice(0, 10), problem.user, query].join(
      "\t"
    )
  );
}

lines.sort((a, b) => Number(a.split("\t")[0]) - Number(b.split("\t")[0]));
writeFileSync(target, `${lines.join("\n")}\n`);
console.log(`${lines.length} problems -> ${target} (skipped ${skipped})`);
