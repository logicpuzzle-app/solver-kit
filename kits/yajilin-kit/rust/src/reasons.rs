pub const WHITE_AROUND_BLACK: &str = "黒の周りの白";
pub const BLACK_FROM_TWO_CHOICE: &str = "2択の黒が確定";
pub const ZERO_WHITE: &str = "0の白";
pub const BLACK_ALREADY_PLACED_WHITE: &str = "黒マスもうあるの白";
pub const SUBTRACTED_ZERO_WHITE: &str = "ヒント引き算による0の白";
pub const SUBTRACTED_BLACK_ALREADY_PLACED_WHITE: &str = "ヒント引き算&黒マスもうあるの白";
pub const EVERY_SECOND_BLACK: &str = "1つ飛ばしの黒";
pub const TWO_N_IN_N_WHITE_NEAR: &str = "2n in nの白(手前)";
pub const TWO_N_IN_N_WHITE_FAR: &str = "2n in nの白(奥)";
pub const EXTEND_LINE_END: &str = "線端のばし";
pub const SMALL_LOOP_BAN: &str = "小ループ禁";
pub const SMALL_LOOP_BAN_EXTENSION: &str = "小ループ禁による線延長";
pub const LINE_FIXED: &str = "線確定";
pub const SIMPLE_LOOP_TECHNIQUE: &str = "シンプルループ手筋";
pub const UNREACHABLE_BLACK: &str = "通れずの黒";
pub const SMALL_LOOP_BAN_BLACK: &str = "小ループ禁止の黒";
pub const EXIT_TECHNIQUE: &str = "出口の手筋";
pub const SMALL_LOOP_BAN_WHITE: &str = "小ループ禁止の白";
pub const BRANCH_BAN_WHITE: &str = "分岐禁の白";
pub const ROW_COUNT_BLACK: &str = "行の本数定理による黒確定";
pub const ROW_COUNT_WHITE: &str = "行の本数定理による白確定";
pub const ROW_COUNT_LINE: &str = "行の本数定理による線確定";
pub const ROW_COUNT_TWO_WHITE: &str = "行の本数定理による2マス白確定";
pub const ROW_GLOBAL_SMALL_LOOP_TWO_WHITE: &str = "行の大域小ループ禁による2マス白確定";
pub const COL_COUNT_BLACK: &str = "列の本数定理による黒確定";
pub const COL_COUNT_WHITE: &str = "列の本数定理による白確定";
pub const COL_COUNT_LINE: &str = "列の本数定理による線確定";
pub const COL_COUNT_TWO_WHITE: &str = "列の本数定理による2マス白確定";
pub const COL_GLOBAL_SMALL_LOOP_TWO_WHITE: &str = "列の大域小ループ禁による2マス白確定";
pub const INVISIBLE_WALL_BY_COUNT: &str = "本数定理による見えない壁";
pub const INVISIBLE_WALL_BY_GLOBAL_SMALL_LOOP: &str = "大域小ループ禁による見えない壁";
pub const CUT_PARITY_LINE: &str = "カット偶奇による線確定";
pub const TRIAL_CONTRADICTION: &str = "仮置きによる矛盾";
pub const TRIAL_ANY_CASE: &str = "いずれの色にしても確定";
pub const TRIAL_LINE_CONTRADICTION: &str = "線先読みによる矛盾";

pub fn weight(reason: &str) -> i32 {
    match reason {
        WHITE_AROUND_BLACK | ZERO_WHITE | EXTEND_LINE_END | LINE_FIXED => 1,
        BLACK_FROM_TWO_CHOICE | BLACK_ALREADY_PLACED_WHITE | EVERY_SECOND_BLACK
        | UNREACHABLE_BLACK => 2,
        SUBTRACTED_ZERO_WHITE | SUBTRACTED_BLACK_ALREADY_PLACED_WHITE
        | SMALL_LOOP_BAN | SMALL_LOOP_BAN_EXTENSION => 3,
        SMALL_LOOP_BAN_BLACK | EXIT_TECHNIQUE => 4,
        SIMPLE_LOOP_TECHNIQUE | SMALL_LOOP_BAN_WHITE => 5,
        TWO_N_IN_N_WHITE_NEAR | BRANCH_BAN_WHITE => 6,
        TWO_N_IN_N_WHITE_FAR => 8,
        ROW_COUNT_BLACK | ROW_COUNT_WHITE | ROW_COUNT_LINE | COL_COUNT_BLACK
        | COL_COUNT_WHITE | COL_COUNT_LINE | CUT_PARITY_LINE => 10,
        ROW_COUNT_TWO_WHITE | COL_COUNT_TWO_WHITE => 14,
        ROW_GLOBAL_SMALL_LOOP_TWO_WHITE | COL_GLOBAL_SMALL_LOOP_TWO_WHITE => 16,
        INVISIBLE_WALL_BY_COUNT => 20,
        INVISIBLE_WALL_BY_GLOBAL_SMALL_LOOP => 24,
        TRIAL_CONTRADICTION | TRIAL_ANY_CASE | TRIAL_LINE_CONTRADICTION => 0,
        _ => 1,
    }
}

