pub const CELL_EXACT: &str = "数字充足";
pub const VERTEX_CLOSE: &str = "頂点の次数2";
pub const ZERO_CELL: &str = "0の周囲";
pub const VERTEX_DEAD: &str = "頂点を使わない";
pub const CELL_FORCED: &str = "数字による線確定";
pub const VERTEX_EXTEND: &str = "線端の延長";
pub const CORNER_CLUE: &str = "角の数字";
pub const THREE_ZERO_ADJACENT: &str = "隣接する3と0";
pub const THREE_PAIR: &str = "隣接する3";
pub const THREE_ZERO_DIAGONAL: &str = "斜めの3と0";
pub const THREE_DIAGONAL: &str = "斜めの3";
pub const THREE_INCOMING: &str = "3への外線";
pub const ONE_BLOCKED_CORNER: &str = "塞がれた角の1";
pub const TWO_BLOCKED_CORNER: &str = "塞がれた角の2";
pub const NO_SMALL_LOOP: &str = "小ループ禁止";
pub const CONNECT_LINE: &str = "線成分の接続";
pub const PARITY_LINE: &str = "横断線の偶奇";
pub const INSIDE_OUTSIDE: &str = "内外手筋";
pub const LOCAL_PATTERN: &str = "3x3局所パターン";
pub const TRIAL_CONTRADICTION: &str = "仮置きによる矛盾";
pub const TRIAL_ANY_CASE: &str = "どちらの仮定でも確定";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReasonSpec {
    pub constant: &'static str,
    pub reason: &'static str,
}

/// 較正結果を reasons.rs の match 腕へ戻しやすいよう、理由を定義順で列挙する。
/// 仮置きは手筋重みではなく専用係数で課金するため、ここには含めない。
pub const DIFFICULTY_REASONS: [ReasonSpec; 19] = [
    ReasonSpec {
        constant: "CELL_EXACT",
        reason: CELL_EXACT,
    },
    ReasonSpec {
        constant: "VERTEX_CLOSE",
        reason: VERTEX_CLOSE,
    },
    ReasonSpec {
        constant: "ZERO_CELL",
        reason: ZERO_CELL,
    },
    ReasonSpec {
        constant: "VERTEX_DEAD",
        reason: VERTEX_DEAD,
    },
    ReasonSpec {
        constant: "CELL_FORCED",
        reason: CELL_FORCED,
    },
    ReasonSpec {
        constant: "VERTEX_EXTEND",
        reason: VERTEX_EXTEND,
    },
    ReasonSpec {
        constant: "CORNER_CLUE",
        reason: CORNER_CLUE,
    },
    ReasonSpec {
        constant: "THREE_ZERO_ADJACENT",
        reason: THREE_ZERO_ADJACENT,
    },
    ReasonSpec {
        constant: "THREE_PAIR",
        reason: THREE_PAIR,
    },
    ReasonSpec {
        constant: "THREE_ZERO_DIAGONAL",
        reason: THREE_ZERO_DIAGONAL,
    },
    ReasonSpec {
        constant: "THREE_DIAGONAL",
        reason: THREE_DIAGONAL,
    },
    ReasonSpec {
        constant: "THREE_INCOMING",
        reason: THREE_INCOMING,
    },
    ReasonSpec {
        constant: "ONE_BLOCKED_CORNER",
        reason: ONE_BLOCKED_CORNER,
    },
    ReasonSpec {
        constant: "TWO_BLOCKED_CORNER",
        reason: TWO_BLOCKED_CORNER,
    },
    ReasonSpec {
        constant: "INSIDE_OUTSIDE",
        reason: INSIDE_OUTSIDE,
    },
    ReasonSpec {
        constant: "NO_SMALL_LOOP",
        reason: NO_SMALL_LOOP,
    },
    ReasonSpec {
        constant: "CONNECT_LINE",
        reason: CONNECT_LINE,
    },
    ReasonSpec {
        constant: "PARITY_LINE",
        reason: PARITY_LINE,
    },
    ReasonSpec {
        constant: "LOCAL_PATTERN",
        reason: LOCAL_PATTERN,
    },
];

/// 重みはパズルスクエアの人手評価つき 1,585 問で較正した値である
/// （`slither calibrate --trial-limit 100 --folds 5 --min-weight 1`、
/// 5-fold 交差検証での Spearman 順位相関 0.719、訓練との差 0.004）。
/// 経緯と数値は testdata/CALIBRATION_JA.md を参照。
///
/// 較正が重みを与えたのは「どれだけ先読みを強いられるか」であって、定石の発火回数ではない。
/// 下限を 1 に固定して較正しているので 0 の腕はないが、1 のままの手筋は
/// 「推論としては必要だが、発火回数が人手評価を説明しない」という意味である。
pub fn weight(reason: &str) -> i32 {
    match reason {
        CELL_EXACT | ZERO_CELL | VERTEX_DEAD | VERTEX_EXTEND
        | THREE_ZERO_ADJACENT | THREE_DIAGONAL | THREE_INCOMING
        | TWO_BLOCKED_CORNER | NO_SMALL_LOOP => 1,
        // 局所パターン表を有効にしたうえで較正しても 1 のままだった。
        // 発火回数は多い（実問題で1問あたり数十回）が、難易度を説明しない。
        LOCAL_PATTERN => 1,
        THREE_ZERO_DIAGONAL => 4,
        ONE_BLOCKED_CORNER => 15,
        THREE_PAIR => 18,
        VERTEX_CLOSE => 20,
        // 実問題ではまず発火しないため、較正でも初期値から動かなかった。
        // 経緯は testdata/CALIBRATION_JA.md の「どの手筋が実際に効いているか」を参照。
        CONNECT_LINE => 12,
        PARITY_LINE => 16,
        // 内外手筋はコーパスの全問で発火し、寄与も最大だった。
        INSIDE_OUTSIDE => 15,
        CELL_FORCED => 52,
        CORNER_CLUE => 72,
        TRIAL_CONTRADICTION | TRIAL_ANY_CASE => 0,
        // 新しい理由を追加した際に無償にならないよう、最小重みを安全側の既定値にする。
        _ => 1,
    }
}
