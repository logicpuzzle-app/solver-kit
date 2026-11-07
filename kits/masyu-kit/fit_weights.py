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

方針は美術館・ぬりかべと同じ: **多パラメータの降下はしない。1 つずつ走査して
CV で採否を決める**(降下は fold ごとに係数が暴れて CV が下がる、が過去 2 種の実測)。
走査結果はこの docstring ではなく README_JA.md に記録する。
"""

import random
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from calibrate import band, fit_cuts, spearman

HERE = Path(__file__).parent
BIN = HERE / "rust/target/release/masyu"
CORPUS = HERE / "testdata/corpus.tsv"
CACHE = HERE / "testdata/features.tsv"

LEVEL_SCALE = 1_000_000

# reasons.rs の weight()。較正しても改善しなかったので暫定値のまま。
CURRENT = {
    "丸の基本": 1,
    "マスの次数": 0,
    "小ループ禁": 2,
    "白丸の隣の曲がり": 2,
    "連結性": 4,
    "カット偶奇": 8,
    "領域の出入り": 8,
    "丸まわりの場合分け": 8,
}
REASONS = list(CURRENT)

# difficulty.rs の係数。走査するのはこちら。
EXTRA = {
    "TRIAL_DEDUCTION_COST": 40,
    "PURE_UNKNOWN_WEIGHT": 12,
    "NESTED_TRIAL_COST": 4,
    "SHALLOW_UNKNOWN_WEIGHT": 40,
    "STOPPED_UNKNOWN_WEIGHT": 90,
}
GRID = {
    "TRIAL_DEDUCTION_COST": [0, 5, 10, 20, 40, 60, 100, 160, 240],
    "PURE_UNKNOWN_WEIGHT": [0, 2, 4, 6, 8, 10, 12, 15, 20, 25, 30, 40],
    "NESTED_TRIAL_COST": [0, 1, 2, 4, 8, 16, 40, 80, 160],
    "SHALLOW_UNKNOWN_WEIGHT": [0, 10, 20, 40, 60, 90, 120, 180, 250, 350],
    "STOPPED_UNKNOWN_WEIGHT": [0, 15, 30, 45, 60, 90, 120, 180, 240, 320],
}
SEEDS = (1, 2, 3, 4, 5, 6, 7)


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
        deductions = pure = nested = shallow = 0
        level = 1
        for line in out.splitlines():
            parts = line.split()
            if not parts:
                continue
            if parts[0] == "STATUS":
                status = parts[1]
            elif parts[0] == "SOLUTIONS" and parts[1] in ("2+", "0"):
                return None  # 一意解でない問題は較正に使えない
            elif parts[0] == "UNKNOWN":
                unknown = int(parts[1])
            elif parts[0] == "LEVEL":
                level = int(parts[1])
            elif parts[0] == "TRIAL":
                deductions, nested, pure, shallow = (int(x) for x in parts[1:5])
            elif line.startswith("  ") and len(parts) == 2 and parts[1].isdigit():
                counts[parts[0]] = int(parts[1])
        if status is None or unknown is None:
            return None
        return (
            pid, int(declared), status, unknown, deductions, pure, nested, shallow,
            level, counts,
        )

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        return [r for r in pool.map(one, rows) if r is not None]


HEAD = [
    "id", "declared", "status", "unknown", "deductions", "pure", "nested",
    "shallow", "level",
]


def save(features):
    lines = ["\t".join(HEAD + REASONS)]
    for pid, declared, status, unknown, ded, pure, nested, shallow, level, counts in features:
        lines.append(
            "\t".join(
                [pid, str(declared), status, str(unknown), str(ded), str(pure),
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
             int(f[8]), counts)
        )
    return out


def score(row, extra, weights=CURRENT):
    _, _, status, unknown, deductions, pure, nested, shallow, level, counts = row
    work = sum(weights[r] * c for r, c in counts.items() if r in weights)
    work += extra["TRIAL_DEDUCTION_COST"] * deductions
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
