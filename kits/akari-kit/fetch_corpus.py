#!/usr/bin/env python3
"""puzsq から美術館(kind 18)の問題を集めて corpus.tsv にする。

usage: python3 fetch_corpus.py [--max-cells 900]

出力は `id<TAB>申告難易度<TAB>puzz.link コード`。

API は 1 回で全件返す。返るのは
`{"<id>": {"kind":18, "difficulty":3, "variation":0, "url":"https://puzz.link/p?akari/..."}}`
という id をキーにした辞書。`variation != 0` は Regional / RGB などの変種なので落とす。

**極端に大きい盤面が混じっている**(137x112 など)。較正には使えるが 1 問で何分も
かかるので、既定では 900 マス(30x30 相当)までに絞る。
"""

import json
import sys
import urllib.request
from pathlib import Path

KIND = 18
API = f"https://puzsq.logicpuzzle.app/api/problem/kind/{KIND}"
OUT = Path(__file__).parent / "testdata/corpus.tsv"


def main():
    args = sys.argv[1:]
    max_cells = int(args[args.index("--max-cells") + 1]) if "--max-cells" in args else 900

    with urllib.request.urlopen(API, timeout=60) as res:
        data = json.loads(res.read())
    print(f"{len(data)} 件")

    rows = []
    skipped_variant = skipped_big = 0
    for pid, row in data.items():
        if row.get("variation"):
            skipped_variant += 1
            continue
        difficulty = row.get("difficulty")
        url = row.get("url") or ""
        if not difficulty or "akari/" not in url:
            skipped_variant += 1
            continue
        code = url.split("?", 1)[-1]
        parts = code.split("/")
        try:
            cells = int(parts[1]) * int(parts[2])
        except (IndexError, ValueError):
            continue
        if cells > max_cells:
            skipped_big += 1
            continue
        rows.append((int(pid), int(difficulty), code))

    rows.sort()
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text("\n".join(f"{a}\t{b}\t{c}" for a, b, c in rows) + "\n")
    print(f"変種を除外 {skipped_variant} / 大きすぎる盤面を除外 {skipped_big}")
    print(f"{len(rows)} 問を {OUT} に書き出しました")

    counts = {}
    for _, difficulty, _ in rows:
        counts[difficulty] = counts.get(difficulty, 0) + 1
    print("申告の分布: " + "  ".join(f"★{k}:{counts.get(k, 0)}" for k in sorted(counts)))


if __name__ == "__main__":
    main()
