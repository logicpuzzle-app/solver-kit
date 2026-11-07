#!/usr/bin/env python3
"""DP → 推定レーティングの補間アンカーを、0.1 刻みで隙間なく作る。

usage: python3 tools_rating_anchors.py

## なぜ必要か

難易度の主軸を「要った読みの段階」にしたので、DP は段階ごとに 100 万ずつ飛ぶ。
アンカーを ★の分類境界(x.5)だけに置くと、段階の中では推定がほとんど動かない
(段階 2 の問題がどれも ★1.75 になる、など)。同じ段階の中の細かい差が見えず、
0.1 刻みで見ると値の入らない範囲ができてしまう。

## どう作るか

1. 区間 DP で ★の分類境界(1.5 / 2.5 / 3.5 / 4.5)を当てはめる。**ここは動かさない**
   ので、四捨五入すれば分類が再現される性質は保たれる
2. 各バンドの中を、そのバンドに入るコーパスの DP の分位点で 10 等分し、
   0.1 刻みのアンカーを置く

これで各 0.1 の刻みにコーパスのおよそ 1/10 が入り、隙間ができない。
"""

import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from calibrate import band, fit_cuts

BIN = Path(__file__).parent / "rust/target/release/nurikabe"
CORPUS = Path(__file__).parent / "testdata/corpus.tsv"
TOP_RATING = 549  # 5.49。四捨五入して 5 になる上限


def collect():
    rows = [l.split("\t") for l in CORPUS.read_text().strip().split("\n")]

    def one(r):
        try:
            out = subprocess.run(
                [str(BIN), "solve", r[2]], capture_output=True, text=True, timeout=120
            ).stdout
        except subprocess.TimeoutExpired:
            return None
        dp = next((int(l.split()[1]) for l in out.splitlines() if l.startswith("DP ")), None)
        return None if dp is None else (int(r[1]), dp)

    with ThreadPoolExecutor(max_workers=8) as pool:
        return [x for x in pool.map(one, rows) if x]


def anchors(pairs, cuts):
    """(DP, レーティング×100) のアンカー列。単調増加になるよう間引く。"""
    dps = sorted(p for _, p in pairs)
    bounds = [dps[0]] + list(cuts) + [dps[-1] + 1]
    out = [(0, 50)]
    for k in range(5):  # ★1〜★5 のバンド
        lo_rating = 50 if k == 0 else k * 100 + 50
        hi_rating = TOP_RATING if k == 4 else (k + 1) * 100 + 50
        inside = sorted(p for p in dps if bounds[k] <= p < bounds[k + 1])
        if not inside:
            continue
        # バンドの下端は境界そのもの(そこで四捨五入が切り替わる)
        out.append((bounds[k] if k else inside[0], lo_rating))
        for j in range(1, 10):
            q = inside[min(len(inside) - 1, (len(inside) * j) // 10)]
            out.append((q, lo_rating + (hi_rating - lo_rating) * j // 10))
    out.append((dps[-1], TOP_RATING))
    # DP が同じアンカーは後勝ちで潰し、単調増加にする
    merged = {}
    for dp, r in out:
        merged[dp] = r
    seq = []
    last = -1
    for dp in sorted(merged):
        r = max(merged[dp], last)
        if seq and seq[-1][1] == r:
            continue
        seq.append((dp, r))
        last = r
    return seq


def main():
    pairs = collect()
    cuts, agree = fit_cuts([(p, d) for d, p in pairs])
    print(f"n={len(pairs)}  境界 {cuts}  完全一致 {agree / len(pairs):.1%}", file=sys.stderr)
    table = anchors(pairs, cuts)
    print(f"アンカー {len(table)} 点", file=sys.stderr)
    for dp, r in table:
        print(f"    ({dp:_}, {r}),")


if __name__ == "__main__":
    main()
