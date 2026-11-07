#!/bin/sh
# Times the two interpreters on deterministic workloads and reports the best of N runs.
# CPU time rather than wall clock: wall-clock readings on a shared machine varied by more
# than the differences being measured.
#
# Usage: tools/timeit.sh [runs]
set -eu

cd "$(dirname "$0")/.."
runs=${1:-3}
problems=../typescript/testdata

best() {
    label=$1
    interp=$2
    shift 2
    best_ms=999999999
    i=0
    while [ "$i" -lt "$runs" ]; do
        usage=$( { /usr/bin/time -p "$interp" yajilin.py "$@" > /dev/null; } 2>&1 || true )
        ms=$(echo "$usage" | awk '/^(user|sys)/ { total += $2 } END { printf "%d", total * 1000 }')
        [ -n "$ms" ] && [ "$ms" -lt "$best_ms" ] && best_ms=$ms
        i=$((i + 1))
    done
    printf '%-28s %-8s %6d ms cpu\n' "$label" "$interp" "$best_ms"
}

for interp in python3 pypy3; do
    command -v "$interp" > /dev/null 2>&1 || continue
    best "solve (technique solver)" "$interp" solve "$problems/problem-1.txt"
    best "count (constraint engine)" "$interp" count "$problems/problem-900.txt"
    best "generate-loop seed=7 6x6" "$interp" generate-loop --size 6x6 --seed 7
    best "generate-pattern seed=1" "$interp" generate-pattern --size 10x10 --seed 1 --symmetry rot2
    # A long run as well: PyPy spends its first second or so warming the JIT up, so it
    # loses on the short workloads above and only pulls ahead once the run is long enough
    # to amortise that.
    best "bench --count 3 (long run)" "$interp" bench --count 3 --seed 0
done
