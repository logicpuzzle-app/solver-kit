#!/usr/bin/env python3
"""難易度スコアの係数を puzsq の人手評価に当てはめる。

usage: python3 fit_weights.py [--refresh] [--descend]

difficulty.rs のスコアは

    work = Σ weight(手筋) × 発火数
         + TRIAL_DEDUCTION_COST × 仮置き回数
         + TRIAL_DEPTH_COST × 仮置き深さ²
         + PURE_UNKNOWN_WEIGHT × 手筋だけで進めなくなった時点の未確定マス
    手筋切れなら work += STOPPED_UNKNOWN_WEIGHT × 未確定マス
    DP = (要った読みの段階 - 1) × LEVEL_SCALE + min(work, LEVEL_SCALE - 1)

## 2026-08-04 の較正で分かったこと

**手筋の発火数は難易度をほとんど説明しない。** 10x10 の完解問題で申告★1/★2/★3 の
発火数の中央値を並べると、どの手筋もすべて ±10% 以内で重なる。発火数は難易度ではなく
盤面の広さで決まっている。実際、15 個の重みを座標降下で当てはめると訓練一致率は
55.6% → 58.2% に上がるのに **5-fold CV は 53.0% → 52.2% と下がった**(過学習)。

効いたのは 1 つだけ、**手筋だけで進めなくなった時点の未確定マス数**。
申告★1〜5 で中央値 0 / 6 / 39 / 68 / 94 と分離する。

そこで方針は「多パラメータの降下はしない。1 つずつ走査して CV で採否を決める」。
`--descend` を付けると多パラメータの降下も試せるが、上の理由で採用しないこと。

サイズ補正(ヤジリンで効いた `DP / 面積^k`)も試したが、指数を上げるほど一致率が
下がった。広い盤面は実際に難しい(申告平均 1.88 → 3.12)ので、補正すると本物の信号を
消してしまう。数独と同じ結論。
"""

import random
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from calibrate import band, fit_cuts, spearman

HERE = Path(__file__).parent
BIN = HERE / "rust/target/release/nurikabe"
CORPUS = HERE / "testdata/corpus.tsv"
CACHE = HERE / "testdata/features.tsv"

LEVEL_SCALE = 1_000_000

# reasons.rs の weight()。較正しても改善しなかったので暫定値のまま。
CURRENT = {
    "1のシマの周り": 1,
    "完成したシマを囲う": 1,
    "四方をかべに囲まれたマス": 1,
    "斜め数字の間": 2,
    "1マス飛ばしの数字": 2,
    "2x2禁による白": 2,
    "白の総数が尽きた": 3,
    "かべの総数が尽きた": 3,
    "かべの延長": 4,
    "かべが孤立するマス": 4,
    "シマの伸びる先が一意": 4,
    "どの数字も届かないマス": 6,
    "シマの形の共通部分": 8,
    "どの形にも入らないマス": 8,
    "白のまとまりの行き先": 9,
}
REASONS = list(CURRENT)

# difficulty.rs の係数。走査するのはこちら。
EXTRA = {
    "TRIAL_DEDUCTION_COST": 40,
    "TRIAL_DEPTH_COST": 0,
    "PURE_UNKNOWN_WEIGHT": 12,
    "NESTED_TRIAL_COST": 4,
    "SHALLOW_UNKNOWN_WEIGHT": 40,
    "STOPPED_UNKNOWN_WEIGHT": 90,
}
GRID = {
    "TRIAL_DEDUCTION_COST": [0, 5, 10, 20, 40, 60, 100, 160, 240],
    "TRIAL_DEPTH_COST": [0, 5, 10, 25, 50, 100, 200, 400],
    "PURE_UNKNOWN_WEIGHT": [0, 2, 4, 6, 8, 10, 12, 15, 20, 25, 30, 40],
    "NESTED_TRIAL_COST": [0, 1, 2, 4, 8, 16, 40, 80, 160],
    "SHALLOW_UNKNOWN_WEIGHT": [0, 10, 20, 40, 60, 90, 120, 180, 250, 350],
    "STOPPED_UNKNOWN_WEIGHT": [0, 15, 30, 45, 60, 90, 120, 180, 240, 320],
}
SEEDS = (1, 2, 3, 4, 5)


def collect(timeout=90, jobs=8):
    rows = [line.split("\t") for line in CORPUS.read_text().strip().split("\n")]

    def one(row):
        pid, declared, code = row
        try:
            out = subprocess.run(
                [str(BIN), "solve", code], capture_output=True, text=True, timeout=timeout
            ).stdout
        except subprocess.TimeoutExpired:
            return None
        counts = {}
        status = unknown = None
        deductions = depth = pure = nested = shallow = 0
        level = 1
        for line in out.splitlines():
            parts = line.split()
            if not parts:
                continue
            if parts[0] == "STATUS":
                status = parts[1]
            elif parts[0] == "UNKNOWN":
                unknown = int(parts[1])
            elif parts[0] == "LEVEL":
                level = int(parts[1])
            elif parts[0] == "TRIAL":
                deductions, depth, pure, nested, shallow = (int(x) for x in parts[1:6])
            elif line.startswith("  ") and len(parts) == 2 and parts[1].isdigit():
                counts[parts[0]] = int(parts[1])
        if status is None or unknown is None:
            return None
        return (
            pid, int(declared), status, unknown, deductions, depth, pure, nested, shallow,
            level, counts,
        )

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        return [r for r in pool.map(one, rows) if r is not None]


HEAD = [
    "id", "declared", "status", "unknown", "deductions", "depth", "pure", "nested",
    "shallow", "level",
]


def save(features):
    lines = ["\t".join(HEAD + REASONS)]
    for pid, declared, status, unknown, ded, depth, pure, nested, shallow, level, counts in features:
        lines.append(
            "\t".join(
                [pid, str(declared), status, str(unknown), str(ded), str(depth), str(pure),
                 str(nested), str(shallow), str(level)]
                + [str(counts.get(r, 0)) for r in REASONS]
            )
        )
    CACHE.write_text("\n".join(lines) + "\n")


def load():
    lines = CACHE.read_text().strip().split("\n")
    reasons = lines[0].split("\t")[len(HEAD) :]
    out = []
    for line in lines[1:]:
        f = line.split("\t")
        counts = {r: int(v) for r, v in zip(reasons, f[len(HEAD) :])}
        out.append(
            (f[0], int(f[1]), f[2], int(f[3]), int(f[4]), int(f[5]), int(f[6]), int(f[7]),
             int(f[8]), int(f[9]), counts)
        )
    return out


def score(row, extra, weights=CURRENT):
    _, _, status, unknown, deductions, depth, pure, nested, shallow, level, counts = row
    work = sum(weights[r] * c for r, c in counts.items() if r in weights)
    work += extra["TRIAL_DEDUCTION_COST"] * deductions
    work += extra["TRIAL_DEPTH_COST"] * depth * depth
    work += extra["PURE_UNKNOWN_WEIGHT"] * pure
    work += extra["NESTED_TRIAL_COST"] * nested
    work += extra["SHALLOW_UNKNOWN_WEIGHT"] * shallow
    if status != "COMPLETED":
        work += extra["STOPPED_UNKNOWN_WEIGHT"] * unknown
    # 段階が主、手間が従(difficulty.rs と同じ形)
    return (level - 1) * LEVEL_SCALE + min(work, LEVEL_SCALE - 1)


def train_agreement(rows, extra):
    return fit_cuts([(score(r, extra), r[1]) for r in rows])


def cross_validate(rows, extra, seeds=SEEDS):
    """各 fold でバンド境界だけ引き直す。係数は動かさない。"""
    out = []
    for seed in seeds:
        shuffled = rows[:]
        random.Random(seed).shuffle(shuffled)
        accs = []
        for f in range(5):
            test = shuffled[f::5]
            train = [r for i, r in enumerate(shuffled) if i % 5 != f]
            cuts, _ = train_agreement(train, extra)
            accs.append(sum(1 for r in test if band(score(r, extra), cuts) == r[1]) / len(test))
        out.append(sum(accs) / 5)
    return out


def scan(rows, extra):
    """1 係数ずつ走査して、訓練一致率と CV 一致率を並べて出す。

    採るかどうかは目で決める。CV が平坦な高原になっていたら、その真ん中を採る。
    最大値をそのまま採るとシードの揺らぎを拾う。
    """
    for name, values in GRID.items():
        keep = extra[name]
        print(f"\n{name}  (現在 {keep})")
        print("     値    訓練一致    CV一致(5シード平均)")
        for value in values:
            extra[name] = value
            cuts, agree = train_agreement(rows, extra)
            cvs = cross_validate(rows, extra)
            mark = "  ←現在" if value == keep else ""
            print(
                f"  {value:5d}    {agree / len(rows):6.1%}      {sum(cvs) / len(cvs):6.2%}{mark}"
            )
        extra[name] = keep


def main():
    args = sys.argv[1:]
    if "--refresh" in args or not CACHE.exists():
        print("全問を解いて特徴量を集めています…")
        save(collect())
    rows = load()
    extra = dict(EXTRA)
    cuts, agree = train_agreement(rows, extra)
    cvs = cross_validate(rows, extra)
    sp = spearman([score(r, extra) for r in rows], [r[1] for r in rows])
    print(f"{len(rows)} 問  (完解 {sum(1 for r in rows if r[2] == 'COMPLETED')})")
    print(
        f"現在の係数: 訓練一致 {agree / len(rows):.1%}  "
        f"CV {sum(cvs) / len(cvs):.2%}  Spearman {sp:.4f}  バンド {cuts}"
    )
    scan(rows, extra)


if __name__ == "__main__":
    main()
