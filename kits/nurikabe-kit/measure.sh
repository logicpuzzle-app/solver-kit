#!/bin/sh
# コーパスでの解決率と手筋の発火回数を測る。usage: ./measure.sh [件数]
cd "$(dirname "$0")"
N=${1:-200}
BIN=rust/target/release/nurikabe
cargo build --release --manifest-path rust/Cargo.toml 2>/dev/null
head -"$N" testdata/corpus.tsv | while IFS=$(printf '\t') read -r id diff code; do
  "$BIN" solve "$code" 2>/dev/null | awk -v d="$diff" '
    /^STATUS/ {st=$2}
    /^  / {gsub(/^  /,""); n=$NF; $NF=""; sub(/ $/,""); fire[$0]+=n}
    END {printf "S\t%s\t%s\n", d, st; for (k in fire) printf "F\t%s\t%d\n", k, fire[k]}'
done | awk -F'\t' '
  $1=="S" {total++; st[$3]++; sum[$2]++; if ($3=="COMPLETED") done[$2]++}
  $1=="F" {fire[$2]+=$3}
  END {
    printf "全体: %d 問中 完解 %d (%.1f%%) / 手詰まり %d / 矛盾 %d\n",
      total, st["COMPLETED"], 100*st["COMPLETED"]/total, st["STOPPED"], st["BROKEN"]
    for (d=1; d<=5; d++) if (sum[d] > 0)
      printf "  申告★%d: %3d 問中 完解 %3d (%.0f%%)\n", d, sum[d], done[d], 100*done[d]/sum[d]
    print "手筋の発火回数:"
    for (k in fire) printf "  %-28s %6d\n", k, fire[k]
  }'
