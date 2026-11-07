/*
 * Extracts the published Yajilin problems bundled with gridkit into a flat TSV so the
 * ports can be regression-tested against real puzzles.
 *
 * Usage: node tools/extract-corpus.mjs [path/to/gridkit/frontend/src/data/data.ts]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source =
  process.argv[2] ??
  resolve(here, "../../../gridkit/frontend/src/data/data.ts");
const target = resolve(here, "../testdata/corpus.tsv");

const text = readFileSync(source, "utf8");
const entries = [];
const pattern =
  /index:\s*"([^"]*)",\s*difficulty:\s*"([^"]*)",\s*code:\s*"([^"]*)"/g;
let match;
while ((match = pattern.exec(text)) !== null) {
  const [, index, difficulty, code] = match;
  if (!code.startsWith("yajilin/")) continue;
  entries.push(`${index}\t${difficulty}\t${code}`);
}

writeFileSync(target, `${entries.join("\n")}\n`);
console.log(`${entries.length} problems -> ${target}`);
