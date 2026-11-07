#!/usr/bin/env python3
"""手詰まりになった問題の盤面を、正解と並べて表示する。

usage: python3 stuck.py [--declared 3] [--count 5] [--max-unknown 12]

手筋ソルバーが止まった盤面と、探索で求めた正解を並べ、
「あと何が言えれば進むのか」を目で確認するためのもの。
残り未確定マスが少ない問題ほど、あと一手筋で解ける可能性が高い。
"""

import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
BIN = HERE / "rust/target/release/nurikabe"
CORPUS = HERE / "testdata/corpus.tsv"


def run(code, args=(), timeout=20):
    try:
        return subprocess.run(
            [str(BIN), *args, code], capture_output=True, text=True, timeout=timeout
        ).stdout
    except subprocess.TimeoutExpired:
        return ""


def parse(out):
    info = {"grid": [], "status": None, "unknown": None}
    for line in out.splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == "STATUS":
            info["status"] = parts[1]
        elif parts[0] == "UNKNOWN":
            info["unknown"] = int(parts[1])
        elif parts[0] in ("DP", "PASSES", "TRIAL", "CODE", "URL",
                          "SOLUTIONS", "ABORTED", "BREAKDOWN"):
            continue
        elif line.startswith("  "):
            continue
        else:
            info["grid"].append(parts)
    return info


def main():
    args = sys.argv[1:]
    want = int(args[args.index("--declared") + 1]) if "--declared" in args else 3
    count = int(args[args.index("--count") + 1]) if "--count" in args else 5
    cap = int(args[args.index("--max-unknown") + 1]) if "--max-unknown" in args else 12

    rows = [l.split("\t") for l in CORPUS.read_text().strip().split("\n")]
    rows = [r for r in rows if int(r[1]) == want]

    def check(row):
        pid, _, code = row
        info = parse(run(code, ["solve"]))
        if info["status"] != "STOPPED" or info["unknown"] is None:
            return None
        return (info["unknown"], pid, code, info["grid"])

    with ThreadPoolExecutor(max_workers=8) as pool:
        found = [r for r in pool.map(check, rows[:400]) if r is not None]
    found.sort(key=lambda t: t[0])

    print(f"申告★{want} の手詰まり問題 {len(found)} 件のうち、"
          f"残りが少ない順に {count} 件\n")
    for unknown, pid, code, grid in found[:count]:
        if unknown > cap:
            break
        print(f"=== #{pid}  残り {unknown} マス  {code}")
        solved = parse(run(code, ["answer"]))
        if solved["grid"] and len(solved["grid"]) == len(grid):
            print("  手詰まり盤面            正解")
            for a, b in zip(grid, solved["grid"]):
                print(f"  {' '.join(a)}    {' '.join(b)}")
        else:
            for line in grid:
                print("  " + " ".join(line))
        print()


if __name__ == "__main__":
    main()
