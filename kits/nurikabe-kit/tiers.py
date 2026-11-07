#!/usr/bin/env python3
"""「最低どの段階の読みが要るか」で難易度を測り、人手評価と比べる。

usage: python3 tiers.py [--refresh]

## 何を試しているか

いまの難易度スコアは「どれだけ手間がかかったか」(発火数・仮置き回数)の合計。
これに対し、人間は「**どこまでの読みが要る問題か**」で難しさを言う
——「基本手筋だけ」「到達可能性まで要る」「仮置きしないと無理」のように。

そこで手筋を段階に分け、その問題を解くのに最低どの段階まで必要かを測る:

| 段階 | 内容 |
|---|---|
| 1 | 数字のまわりの定石(目で見てすぐ分かるもの) |
| 2 | 数え上げ(どの数字が届くか、区画に何マス入るか) |
| 3 | 連結性(切ったらどうなるかを 1 マスずつ確かめる) |
| 4 | 列挙(シマの形を全部並べて共通部分を取る) |
| 5 | 浅い仮置き |
| 6 | 入れ子の仮置き |
| 7 | それでも解けない |

この 7 段階だけで人手評価をどこまで当てられるかを、いまのスコアと比べる。
"""

import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from calibrate import band, fit_cuts, spearman
import fit_weights as F

HERE = Path(__file__).parent
BIN = HERE / "rust/target/release/nurikabe"
CORPUS = HERE / "testdata/corpus.tsv"
CACHE = HERE / "testdata/tiers.tsv"

LABELS = {
    1: "1 数字のまわり",
    2: "2 数え上げ",
    3: "3 連結性",
    4: "4 形の列挙",
    5: "5 浅い仮置き",
    6: "6 入れ子の仮置き",
    7: "7 解けない",
}


def solved(code, extra, timeout):
    try:
        out = subprocess.run(
            [str(BIN), "solve", code, *extra], capture_output=True, text=True, timeout=timeout
        ).stdout
    except subprocess.TimeoutExpired:
        return False
    return any(line == "STATUS COMPLETED" for line in out.splitlines())


def level(code):
    """解けた最小の段階。安い方から順に試して、解けたところで打ち切る。"""
    for tier in (1, 2, 3, 4):
        if solved(code, ["--no-trial", "--tier", str(tier)], 30):
            return tier
    if solved(code, ["--shallow"], 60):
        return 5
    if solved(code, [], 120):
        return 6
    return 7


def collect():
    rows = [line.split("\t") for line in CORPUS.read_text().strip().split("\n")]

    def one(row):
        pid, declared, code = row
        return f"{pid}\t{declared}\t{level(code)}"

    with ThreadPoolExecutor(max_workers=8) as pool:
        CACHE.write_text("\n".join(pool.map(one, rows)) + "\n")


def main():
    if "--refresh" in sys.argv or not CACHE.exists():
        print("段階を測っています…")
        collect()
    rows = [line.split("\t") for line in CACHE.read_text().strip().split("\n")]
    data = [(pid, int(d), int(t)) for pid, d, t in rows]

    print(f"{len(data)} 問\n")
    print("段階ごとの申告の分布")
    print(f"{'段階':<18}{'問題数':>7}   " + "".join(f"{'★' + str(d):>7}" for d in range(1, 6)))
    for tier in range(1, 8):
        g = [d for _, d, t in data if t == tier]
        if not g:
            continue
        cells = "".join(f"{sum(1 for d in g if d == k) / len(g):>7.0%}" for k in range(1, 6))
        print(f"{LABELS[tier]:<18}{len(g):>7}   {cells}")

    print("\n申告ごとの段階の中央値")
    for d in range(1, 6):
        g = sorted(t for _, dd, t in data if dd == d)
        if g:
            print(f"  ★{d}: n={len(g):4d}  中央 {g[len(g) // 2]}  平均 {sum(g) / len(g):.2f}")

    tiers = [t for _, _, t in data]
    declared = [d for _, d, _ in data]
    print(f"\nSpearman(人手評価, 段階) = {spearman(tiers, declared):.4f}")

    cuts, agree = fit_cuts(list(zip(tiers, declared)))
    print(f"段階だけで分類: 境界 {cuts}  完全一致 {agree / len(data):.1%}")
    adj = sum(1 for t, d in zip(tiers, declared) if abs(band(t, cuts) - d) <= 1)
    print(f"  ±1 以内 {adj / len(data):.1%}")

    # いまのスコアと比べる / 組み合わせる
    feats = {r[0]: r for r in F.load()}
    extra = dict(F.EXTRA)
    both = [(pid, d, t) for pid, d, t in data if pid in feats]
    dp = [F.score(feats[pid], extra) for pid, _, _ in both]
    dd = [d for _, d, _ in both]
    tt = [t for _, _, t in both]
    print(f"\n比較 (n={len(both)})")
    print(f"  いまのスコア  Spearman {spearman(dp, dd):.4f}  "
          f"完全一致 {fit_cuts(list(zip(dp, dd)))[1] / len(both):.1%}")
    print(f"  段階だけ      Spearman {spearman(tt, dd):.4f}  "
          f"完全一致 {fit_cuts(list(zip(tt, dd)))[1] / len(both):.1%}")

    # 段階を主、スコアを従にして並べる(同じ段階の中はスコアで順序をつける)
    top = max(dp) + 1
    mixed = [t * top + p for t, p in zip(tt, dp)]
    print(f"  段階×スコア   Spearman {spearman(mixed, dd):.4f}  "
          f"完全一致 {fit_cuts(list(zip(mixed, dd)))[1] / len(both):.1%}")

    import random

    for name, values in (("いまのスコア", dp), ("段階だけ", tt), ("段階×スコア", mixed)):
        pairs = list(zip(values, dd))
        accs = []
        for seed in (1, 2, 3, 4, 5):
            shuffled = pairs[:]
            random.Random(seed).shuffle(shuffled)
            fold = []
            for f in range(5):
                test = shuffled[f::5]
                train = [r for i, r in enumerate(shuffled) if i % 5 != f]
                c, _ = fit_cuts(train)
                fold.append(sum(1 for v, d in test if band(v, c) == d) / len(test))
            accs.append(sum(fold) / 5)
        print(f"  CV 一致率 {name:<12} {sum(accs) / len(accs):.2%}")


if __name__ == "__main__":
    main()
