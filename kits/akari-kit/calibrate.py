#!/usr/bin/env python3
"""puzsq の人手評価コーパスで難易度を較正する(美術館)。

usage: python3 calibrate.py [件数]

やること:
1. コーパスの各問題を `nurikabe solve` にかけ、DP と状態を集める
2. 人手評価との Spearman 順位相関を出す
3. ★1〜5 のバンド閾値を「一致数を最大化する単調な境界」(区間 DP)で当てはめる
4. 5-fold 交差検証で過学習していないか確かめる

ヤジリンで学んだこと(techniques ドキュメント / yajilin-kit の較正記録より):
- 手筋切れの問題を捨てると、難易度の高い側のサンプルがほとんど残らない。
  「手筋では歯が立たなかった」は難しさの最も強い信号なので、必ず含める
- バンドの上端アンカーを低く取ると上位が頭打ちになり、順序情報が潰れる
- 上端は★の分類境界ではないので、一致率には影響しない
"""

import math
import random
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
BIN = HERE / "rust/target/release/akari"
CORPUS = HERE / "testdata/corpus.tsv"
UNFINISHED_BASE = 6_000_000  # 段階 7 の開始点


def score(code: str, timeout: int = 60):
    """1 問解いて (状態, DP, 未確定マス数) を返す。時間切れは None。"""
    try:
        out = subprocess.run(
            [str(BIN), "solve", code], capture_output=True, text=True, timeout=timeout
        ).stdout
    except subprocess.TimeoutExpired:
        return None
    status = dp = unknown = None
    solutions = None
    for line in out.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "STATUS":
            status = parts[1]
        elif parts[0] == "SOLUTIONS":
            solutions = parts[1]
        elif parts[0] == "DP":
            # 一意解でない問題は難しさが定義できないので DP が "-" になる
            dp = None if parts[1] == "-" else int(parts[1])
        elif parts[0] == "UNKNOWN":
            unknown = int(parts[1])
    # 一意でないと分かった問題だけ外す。数えきれなかった(`?`)のは
    # 複数あるという証拠ではないので、難しさの信号として残す。
    if status is None or dp is None or solutions in ("2+", "0"):
        return None
    return status, dp, unknown


def spearman(xs, ys):
    def ranks(vs):
        order = sorted(range(len(vs)), key=lambda i: vs[i])
        r = [0.0] * len(vs)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and vs[order[j + 1]] == vs[order[i]]:
                j += 1
            avg = (i + j) / 2 + 1
            for k in range(i, j + 1):
                r[order[k]] = avg
            i = j + 1
        return r

    rx, ry = ranks(xs), ranks(ys)
    n = len(xs)
    mx, my = sum(rx) / n, sum(ry) / n
    num = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    den = math.sqrt(sum((a - mx) ** 2 for a in rx) * sum((b - my) ** 2 for b in ry))
    return num / den if den else float("nan")


def fit_cuts(pairs, classes=5):
    """一致数を最大化する単調な境界を区間 DP で求める。pairs は (値, ラベル)。

    同じ値の問題は必ず同じバンドに入るので、DP は「個々の問題」ではなく
    「同値のかたまり」の上で回す。個々の問題の上で回すと、境界をタイの内側に置いて
    実際には不可能な分け方を数えてしまい、訓練一致率を大きく過大評価する
    (残りマス数のように 0 が数百問ある特徴だと 67% と 42% ほどずれた)。
    """
    values = sorted({v for v, _ in pairs})
    at = {v: i for i, v in enumerate(values)}
    n = len(values)
    # count[t][i] = 値が values[0..i) の中でラベル t の数
    count = [[0] * (n + 1) for _ in range(classes + 1)]
    for v, s in pairs:
        if 1 <= s <= classes:
            count[s][at[v] + 1] += 1
    for t in range(1, classes + 1):
        for i in range(n):
            count[t][i + 1] += count[t][i]
    NEG = float("-inf")
    dp = [[NEG] * (n + 1) for _ in range(classes + 1)]
    dp[0][0] = 0
    back = [[0] * (n + 1) for _ in range(classes + 1)]
    for b in range(1, classes + 1):
        best, arg = NEG, 0
        for i in range(n + 1):
            v = dp[b - 1][i] - count[b][i]
            if v > best:
                best, arg = v, i
            dp[b][i] = best + count[b][i]
            back[b][i] = arg
    cuts = []
    i = n
    for b in range(classes, 1, -1):
        j = back[b][i]
        cuts.append(values[j] if j < n else values[-1] + 1)
        i = j
    cuts.reverse()
    return cuts, dp[classes][n]


def band(value, cuts):
    return 1 + sum(1 for c in cuts if value >= c)


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    rows = []
    lines = CORPUS.read_text().strip().split("\n")
    if limit:
        lines = lines[:limit]
    def run(line):
        _, declared, code = line.split("\t")
        result = score(code)
        return None if result is None else (int(declared), result[1], result[0], result[2])

    with ThreadPoolExecutor(max_workers=8) as pool:
        rows = [r for r in pool.map(run, lines) if r is not None]

    skipped = len(lines) - len(rows)
    print(f"採点 {len(rows)} 問  (一意解でない/時間切れで除外 {skipped} 問)")
    completed = sum(1 for r in rows if r[2] == "COMPLETED")
    print(f"完解 {completed} ({completed / len(rows):.1%}) / 手筋切れ {len(rows) - completed}")

    declared = [r[0] for r in rows]
    dps = [r[1] for r in rows]
    print(f"\nSpearman(人手評価, DP) = {spearman(dps, declared):.4f}")
    only_done = [(d, p) for d, p, s, _ in rows if s == "COMPLETED"]
    if len(only_done) > 30:
        print(
            f"  完解した問題のみ (n={len(only_done)}) = "
            f"{spearman([p for _, p in only_done], [d for d, _ in only_done]):.4f}"
        )

    print("\n評価別の DP 分布")
    for d in range(1, 6):
        g = sorted(p for dd, p, _, _ in rows if dd == d)
        if not g:
            continue
        q = lambda f: g[min(len(g) - 1, int(len(g) * f))]
        stopped = sum(1 for dd, _, s, _ in rows if dd == d and s != "COMPLETED")
        print(
            f"  ★{d}: n={len(g):4d}  p25 {q(.25):7,}  中央 {q(.5):7,}  p75 {q(.75):7,}"
            f"  手筋切れ {100 * stopped // len(g):3d}%"
        )

    cuts, agree = fit_cuts([(p, d) for d, p, _, _ in rows])
    print(f"\nバンド閾値: {cuts}")
    print(f"完全一致 {agree}/{len(rows)} = {agree / len(rows):.1%}")
    adj = sum(1 for d, p, _, _ in rows if abs(band(p, cuts) - d) <= 1)
    print(f"±1 以内 {adj / len(rows):.1%}")

    shuffled = rows[:]
    random.Random(1).shuffle(shuffled)
    accs = []
    for f in range(5):
        test = shuffled[f::5]
        train = [r for i, r in enumerate(shuffled) if i % 5 != f]
        c, _ = fit_cuts([(p, d) for d, p, _, _ in train])
        accs.append(sum(1 for d, p, _, _ in test if band(p, c) == d) / len(test))
    print(f"5-fold CV 一致率 {sum(accs) / 5:.1%}")


if __name__ == "__main__":
    main()
