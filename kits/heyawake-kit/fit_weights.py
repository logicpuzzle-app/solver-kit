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

## へやわけでの前提(2026-08-07 較正開始時)

係数はすべて 1 の暫定値から始める。ぬりかべ・美術館で得た教訓をそのまま持ち込む:

- **手筋の発火数は難易度をほとんど説明しない**(発火数は盤面の広さで決まる)。
  多パラメータの座標降下は過学習するので、1 つずつ走査して CV で採否を決める
- 効くのは「手筋だけで進めなくなった時点の未確定マス数」の方
- サイズ補正は入れない(広い盤面は実際に難しいので、補正すると信号を消す)

へやわけ固有の論点は**段階 7(解けない)が 1,342 問と多い**こと。
ここに申告★3 が 36% 混ざっているので、STOPPED_UNKNOWN_WEIGHT の走査が
★3 と★4-5 の分離にどう効くかが焦点になる。
"""

import random
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from calibrate import band, fit_cuts, spearman

HERE = Path(__file__).parent
BIN = HERE / "rust/target/release/heyawake"
CORPUS = HERE / "testdata/corpus.tsv"

def check_binary_is_fresh():
    """ソースより古いバイナリで測るのを防ぐ。

    room_capacity を却下した回に、`cargo test` だけしてビルドを忘れ、
    削除したはずの手筋が入ったバイナリで較正を一度まるごと走らせた。
    測定結果は「いつのコードのものか」が言えなければ意味がない。
    """
    if not BIN.exists():
        sys.exit(f"バイナリがありません: {BIN}\n  cargo build --release --manifest-path rust/Cargo.toml")
    built = BIN.stat().st_mtime
    newer = [
        p for p in (HERE / "rust/src").rglob("*.rs") if p.stat().st_mtime > built
    ]
    if newer:
        names = ", ".join(p.name for p in sorted(newer)[:5])
        sys.exit(
            f"バイナリがソースより古いです({len(newer)} ファイル: {names})\n"
            f"  cargo build --release --manifest-path rust/Cargo.toml"
        )
    return built


def check_binary_did_not_change(built_before):
    """走っている最中に別のビルドで差し替えられていないかを見る。

    較正の途中で係数を変えてビルドし直し、前半と後半で別のバイナリの結果を
    混ぜたことがある。開始時のチェックだけでは防げない。
    """
    if BIN.stat().st_mtime != built_before:
        sys.exit(
            "\n⚠ 実行中にバイナリが差し替わりました。結果は前半と後半で"
            "別のコードのものが混ざっているので破棄してください。"
        )

CACHE = HERE / "testdata/features.tsv"

LEVEL_SCALE = 1_000_000

# reasons.rs の weight()。較正しても改善しなかったので暫定値のまま。
CURRENT = {
    "部屋の黒が数字ぶん": 1,
    "部屋の残りが必要黒数ぶん": 1,
    "黒マスの隣": 1,
    "部屋のどの置き方でも黒": 1,
    "部屋のどの置き方でも白": 1,
    "白の三部屋連続を止める黒": 1,
    "白を分断する位置": 1,
}
REASONS = list(CURRENT)

# difficulty.rs の係数。走査するのはこちら。
EXTRA = {
    "TRIAL_DEDUCTION_COST": 10,
    "PURE_UNKNOWN_WEIGHT": 20,
    "NESTED_TRIAL_COST": 0,
    "SHALLOW_UNKNOWN_WEIGHT": 60,
    "STOPPED_UNKNOWN_WEIGHT": 60,
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
    _built = check_binary_is_fresh()
    main()
    check_binary_did_not_change(_built)
