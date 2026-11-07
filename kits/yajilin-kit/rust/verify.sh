#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
expected_dir="$script_dir/../typescript/testdata/expected"
testdata_dir="$script_dir/../typescript/testdata"
actual_dir=$(mktemp -d "${TMPDIR:-/tmp}/yajilin-rust-verify.XXXXXX")
trap 'rm -rf "$actual_dir"' EXIT HUP INT TERM

cd "$script_dir"
cargo build --release
cargo test --release --quiet

compare() {
    expected=$1
    shift
    actual="$actual_dir/$(basename "$expected")"
    if ! "$@" >"$actual"; then
        :
    fi
    cmp "$expected" "$actual"
    echo "PASS $(basename "$expected")"
}

for expected in "$expected_dir"/solve-problem-*.out; do
    base=$(basename "$expected" .out)
    problem=${base#solve-}
    compare "$expected" ./target/release/yajilin solve "$testdata_dir/$problem.txt"
done

for expected in "$expected_dir"/count-problem-*.out; do
    base=$(basename "$expected" .out)
    problem=${base#count-}
    compare "$expected" ./target/release/yajilin count "$testdata_dir/$problem.txt"
done

for seed in 1 2 3; do
    compare \
        "$expected_dir/generate-loop-$seed.out" \
        ./target/release/yajilin generate-loop --size 10x10 --seed "$seed"
done

compare \
    "$expected_dir/generate-loop-6x6-seed7.out" \
    ./target/release/yajilin generate-loop --size 6x6 --seed 7

compare \
    "$expected_dir/generate-loop-refine.out" \
    ./target/release/yajilin generate-loop --size 10x10 --seed 4 --refine 10

compare \
    "$expected_dir/generate-loop-12x12.out" \
    ./target/release/yajilin generate-loop --size 12x12 --seed 3

compare \
    "$expected_dir/generate-loop-vary.out" \
    ./target/release/yajilin generate-loop --size 10x10 --seed 6 --vary-clue-count

for seed in 1 2 3; do
    compare \
        "$expected_dir/generate-pattern-$seed.out" \
        ./target/release/yajilin generate-pattern --size 10x10 --seed "$seed" --symmetry rot2
done

compare \
    "$expected_dir/generate-pattern-file.out" \
    ./target/release/yajilin generate-pattern --size 10x10 --seed 5 --pattern "$testdata_dir/pattern-rot2.txt"

echo "All expected outputs match byte for byte."
