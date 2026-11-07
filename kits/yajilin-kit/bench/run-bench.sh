#!/bin/sh
# Cross-language benchmark. Runs whichever implementations are built and prints one line
# per language so the three ports can be compared directly.
#
# Usage: bench/run-bench.sh [count] [seed]
set -eu

cd "$(dirname "$0")/.."
count=${1:-10}
seed=${2:-0}

# $1 name, $2 directory to run from, rest the command
run() {
    name=$1
    workdir=$2
    shift 2
    start=$(date +%s)
    if ! output=$(cd "$workdir" && "$@" bench --count "$count" --seed "$seed" 2>&1); then
        echo "$name: FAILED"
        echo "$output" | sed 's/^/    /'
        return
    fi
    end=$(date +%s)
    echo "$name (wall $((end - start))s)"
    echo "$output" | sed 's/^/    /'
}

echo "yajilin-kit bench: count=$count seed=$seed"
echo

# tsx has to resolve from typescript/, so that command runs from there.
if [ -d typescript/node_modules ]; then
    run typescript typescript node --import tsx src/cli.ts
else
    echo "typescript: skipped (run npm install in typescript/)"
fi

if [ -x rust/target/release/yajilin ]; then
    run rust . rust/target/release/yajilin
else
    echo "rust: skipped (run cargo build --release in rust/)"
fi

if [ -f python/yajilin.py ]; then
    run python . python3 python/yajilin.py
else
    echo "python: skipped"
fi

# PyPy runs the same sources unmodified. It loses on short runs, where the JIT has not
# warmed up, and wins by roughly 2.3x once the run is long enough to amortise that.
if [ -f python/yajilin.py ] && command -v pypy3 > /dev/null 2>&1; then
    run pypy . pypy3 python/yajilin.py
else
    echo "pypy: skipped (pypy3 not on PATH)"
fi
