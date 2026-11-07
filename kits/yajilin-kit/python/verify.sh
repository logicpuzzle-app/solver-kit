#!/bin/sh
set -u

cd "$(dirname "$0")" || exit 1
# Any Python 3.10+ works; set PYTHON=pypy3 to check the PyPy build produces the same bytes.
PYTHON=${PYTHON:-python3}
expected=../typescript/testdata/expected
tmp=$(mktemp -d "${TMPDIR:-/tmp}/yajilin-verify.XXXXXX") || exit 1
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
failed=0

"$PYTHON" -m unittest discover -s tests -q || failed=1

compare() {
  name=$1
  shift
  "$PYTHON" yajilin.py "$@" >"$tmp/$name"
  if cmp -s "$expected/$name" "$tmp/$name"; then
    echo "ok   $name"
  else
    echo "FAIL $name" >&2
    failed=1
  fi
}

for file in "$expected"/solve-problem-*.out; do
  name=${file##*/}
  problem=${name#solve-}
  problem=${problem%.out}
  compare "$name" solve "../typescript/testdata/$problem.txt"
done

for file in "$expected"/count-problem-*.out; do
  name=${file##*/}
  problem=${name#count-}
  problem=${problem%.out}
  compare "$name" count "../typescript/testdata/$problem.txt"
done

for seed in 1 2 3; do
  compare "generate-loop-$seed.out" generate-loop --size 10x10 --seed "$seed"
  compare "generate-pattern-$seed.out" generate-pattern --size 10x10 --seed "$seed" --symmetry rot2
done

compare generate-loop-6x6-seed7.out generate-loop --size 6x6 --seed 7
compare generate-pattern-file.out generate-pattern --size 10x10 --seed 5 \
  --pattern ../typescript/testdata/pattern-rot2.txt
compare generate-loop-refine.out generate-loop --size 10x10 --seed 4 --refine 10
compare generate-loop-vary.out generate-loop --size 10x10 --seed 6 --vary-clue-count
compare generate-loop-12x12.out generate-loop --size 12x12 --seed 3

if [ "$failed" -eq 0 ]; then
  echo "all outputs match the TypeScript reference ($PYTHON)"
else
  echo "mismatches found" >&2
fi
exit "$failed"
