#!/bin/sh
# Regenerates the expected outputs that every port is compared against.
# Run from the typescript directory after an intentional behaviour change.
set -eu

cd "$(dirname "$0")"
runner="node --import tsx src/cli.ts"
mkdir -p testdata/expected

for input in testdata/problem-*.txt; do
    name=$(basename "$input" .txt)
    $runner solve "$input" > "testdata/expected/solve-$name.out" || true
    $runner count "$input" > "testdata/expected/count-$name.out" || true
done

for seed in 1 2 3; do
    $runner generate-loop --size 10x10 --seed "$seed" \
        > "testdata/expected/generate-loop-$seed.out" || true
    $runner generate-pattern --size 10x10 --seed "$seed" --symmetry rot2 \
        > "testdata/expected/generate-pattern-$seed.out" || true
done

$runner generate-loop --size 6x6 --seed 7 \
    > testdata/expected/generate-loop-6x6-seed7.out || true
$runner generate-pattern --size 10x10 --seed 5 --pattern testdata/pattern-rot2.txt \
    > testdata/expected/generate-pattern-file.out || true
$runner generate-loop --size 10x10 --seed 4 --refine 10 \
    > testdata/expected/generate-loop-refine.out || true
$runner generate-loop --size 12x12 --seed 3 \
    > testdata/expected/generate-loop-12x12.out || true
$runner generate-loop --size 10x10 --seed 6 --vary-clue-count \
    > testdata/expected/generate-loop-vary.out || true

echo "golden outputs written to testdata/expected"
