#!/usr/bin/env python3
"""コーパスでの解決率・手筋の発火・難易度を測る。

usage: python3 measure.py [件数] [--timeout 秒] [--jobs N]

シェル版と違い 1 問ごとにタイムアウトを掛ける。大盤面 + 仮置きは
いくらでも時間を食うので、上限なしで回すと全体が終わらない。
"""

import subprocess
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
BIN = HERE / "rust/target/release/masyu"
CORPUS = HERE / "testdata/corpus.tsv"


def solve_one(row, timeout):
    pid, declared, code = row
    try:
        out = subprocess.run(
            [str(BIN), "solve", code], capture_output=True, text=True, timeout=timeout
        ).stdout
    except subprocess.TimeoutExpired:
        return {"id": pid, "declared": int(declared), "status": "TIMEOUT"}
    result = {"id": pid, "declared": int(declared), "status": "ERROR", "fires": {}}
    cells = 0
    for line in out.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "STATUS":
            result["status"] = parts[1]
        elif parts[0] == "DP":
            result["dp"] = int(parts[1])
        elif parts[0] == "UNKNOWN":
            result["unknown"] = int(parts[1])
        elif parts[0] == "EDGES":
            cells = int(parts[1])  # ましゅでは確定率の分母は辺の総数
        elif parts[0] == "TRIAL":
            result["trials"], result["nested"] = int(parts[1]), int(parts[2])
        elif parts[0] == "LEVEL":
            result["level"] = int(parts[1])
        elif parts[0] == "SOLUTIONS":
            result["solutions"] = parts[1]
        elif line.startswith("  ") and len(parts) >= 2 and parts[-1].isdigit():
            result["fires"][" ".join(parts[:-1])] = int(parts[-1])
    # 完解に届かなくても、どこまで確定したかは手筋の効き目に直結する。
    # 完解率は階段関数なので、手筋を 1 つ足した効果がここに先に出る。
    if cells and result.get("unknown") is not None:
        result["cells"] = cells
        result["filled"] = (cells - result["unknown"]) / cells
    return result


def main():
    args = sys.argv[1:]
    limit = int(args[0]) if args and args[0].isdigit() else 0
    timeout = 30
    jobs = 8
    if "--timeout" in args:
        timeout = int(args[args.index("--timeout") + 1])
    if "--jobs" in args:
        jobs = int(args[args.index("--jobs") + 1])

    rows = [line.split("\t") for line in CORPUS.read_text().strip().split("\n")]
    if limit:
        rows = rows[:limit]

    with ThreadPoolExecutor(max_workers=jobs) as pool:
        results = list(pool.map(lambda r: solve_one(r, timeout), rows))

    multi = [r for r in results if r.get("solutions") not in (None, "1")]
    if multi:
        print(
            f"一意解でない問題 {len(multi)} 件(難しさが定義できないので難易度は「-」):\n  "
            + "  ".join(f"#{r['id']}({r.get('solutions')})" for r in multi[:12])
        )
    total = len(results)
    status = Counter(r["status"] for r in results)
    fills = [r["filled"] for r in results if "filled" in r]
    print(
        f"全体: {total} 問中 完解 {status['COMPLETED']} "
        f"({status['COMPLETED'] / total:.1%}) / 手詰まり {status['STOPPED']} / "
        f"矛盾 {status['BROKEN']} / 時間切れ {status['TIMEOUT']}"
    )
    print(f"確定率の平均: {sum(fills) / len(fills):.1%}  (完解を階段で数えない指標)")
    for d in range(1, 6):
        g = [r for r in results if r["declared"] == d]
        if not g:
            continue
        done = sum(1 for r in g if r["status"] == "COMPLETED")
        to = sum(1 for r in g if r["status"] == "TIMEOUT")
        fills = [r["filled"] for r in g if "filled" in r]
        stuck = [r["filled"] for r in g if "filled" in r and r["status"] == "STOPPED"]
        print(
            f"  申告★{d}: {len(g):4d} 問中 完解 {done:4d} ({done / len(g):3.0%})"
            f"  確定率 {sum(fills) / len(fills):4.0%}"
            + (f"  (手詰まりだけなら {sum(stuck) / len(stuck):3.0%})" if stuck else "")
            + (f"  時間切れ {to}" if to else "")
        )

    fires = Counter()
    for r in results:
        for k, v in r.get("fires", {}).items():
            fires[k] += v
    print("\n手筋の発火回数:")
    for reason, count in fires.most_common():
        print(f"  {reason:<28} {count:7,}")

    solved = [r for r in results if r["status"] == "COMPLETED" and "dp" in r]
    if solved:
        trials = sum(1 for r in solved if r.get("trials", 0) > 0)
        print(
            f"\n完解した問題のうち仮置きを使ったもの: {trials}/{len(solved)} "
            f"({trials / len(solved):.0%})"
        )
        print("申告別の DP 中央値:")
        for d in range(1, 6):
            g = sorted(r["dp"] for r in solved if r["declared"] == d)
            if g:
                print(f"  ★{d}: n={len(g):4d}  中央 {g[len(g) // 2]:7,}  最大 {g[-1]:7,}")

    levels = {}
    for r in results:
        if "level" in r:
            levels.setdefault(r["level"], []).append(r["declared"])
    if levels:
        print("\n要った読みの段階")
        labels = {1: "1 丸の基本と次数", 2: "2 白の曲がりと小ループ禁",
                  3: "3 連結性とカット偶奇", 4: "4 丸まわりの場合分け",
                  5: "5 浅い仮置き", 6: "6 入れ子の仮置き",
                  7: "7 解けない"}
        print(f"{'段階':<20}{'問題数':>7}   " + "".join(f"{'★' + str(d):>7}" for d in range(1, 6)))
        for level in sorted(levels):
            g = levels[level]
            cells = "".join(f"{sum(1 for d in g if d == k) / len(g):>7.0%}" for k in range(1, 6))
            print(f"{labels.get(level, level):<20}{len(g):>7}   {cells}")

    broken = [r for r in results if r["status"] == "BROKEN"]
    if broken:
        print(f"\n⚠ 矛盾を出した問題 {len(broken)} 件(手筋のバグの疑い):")
        for r in broken[:10]:
            print(f"  #{r['id']}")


if __name__ == "__main__":
    main()
