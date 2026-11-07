#!/bin/sh
# Checks the reference implementation against its own recorded outputs, so an accidental
# behaviour change shows up here rather than in the ports.
set -eu

cd "$(dirname "$0")"
runner="node --import tsx src/cli.ts"
expected=testdata/expected

npx tsc --noEmit
npx vitest run

fail=0
# `label` rather than `name`: the caller's loop variable is also called name.
compare() {
    label=$1
    shift
    actual=$(mktemp)
    "$@" > "$actual" 2>&1 || true
    if cmp -s "$actual" "$expected/$label.out"; then
        echo "ok   $label"
    else
        echo "FAIL $label"
        fail=1
    fi
    rm -f "$actual"
}

for input in testdata/problem-*.txt; do
    name=$(basename "$input" .txt)
    compare "solve-$name" $runner solve "$input"
    compare "count-$name" $runner count "$input"
done

for seed in 1 2 3; do
    compare "generate-loop-$seed" $runner generate-loop --size 10x10 --seed "$seed"
    compare "generate-pattern-$seed" $runner generate-pattern --size 10x10 --seed "$seed" --symmetry rot2
done

compare generate-loop-6x6-seed7 $runner generate-loop --size 6x6 --seed 7
compare generate-pattern-file $runner generate-pattern --size 10x10 --seed 5 --pattern testdata/pattern-rot2.txt
compare generate-loop-refine $runner generate-loop --size 10x10 --seed 4 --refine 10
compare generate-loop-12x12 $runner generate-loop --size 12x12 --seed 3
compare generate-loop-vary $runner generate-loop --size 10x10 --seed 6 --vary-clue-count

node --import tsx tools/check-rng.mjs 20000

if [ "$fail" -eq 0 ]; then
    echo "all outputs match"
else
    echo "mismatches found"
fi
exit "$fail"
