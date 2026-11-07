#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$script_dir"

cargo build --release
binary=./target/release/slither

verify_generated() {
    command_name=$1
    seed=$2
    first=$("$binary" "$command_name" --size 6x6 --seed "$seed" --format code)
    second=$("$binary" "$command_name" --size 6x6 --seed "$seed" --format code)

    # 時刻やハッシュ反復順の影響が混ざれば、同じシードでもここで検出できる。
    if [ "$first" != "$second" ]; then
        echo "FAIL nondeterministic: $command_name seed=$seed" >&2
        return 1
    fi

    count_output=$("$binary" count "$first" --limit 2 --max-nodes 200000)
    if ! printf '%s\n' "$count_output" | grep -q '^SOLUTIONS 1$'; then
        echo "FAIL not unique: $command_name seed=$seed" >&2
        return 1
    fi
    if ! printf '%s\n' "$count_output" | grep -q '^ABORTED 0$'; then
        echo "FAIL count aborted: $command_name seed=$seed" >&2
        return 1
    fi

    solve_output=$("$binary" solve "$first")
    if ! printf '%s\n' "$solve_output" | grep -q '^STATUS COMPLETED$'; then
        echo "FAIL not solved: $command_name seed=$seed" >&2
        return 1
    fi
    echo "PASS $command_name seed=$seed"
}

verify_generated generate-loop 1
verify_generated generate-loop 2
verify_generated generate-pattern 3

echo "All generation checks passed."
