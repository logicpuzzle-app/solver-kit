//! 手筋名と重み。名前は Recorder のキーと weight() の引数を兼ねる。
//! 重みは較正(fit_weights.py)で決め、ここと手で同期する。

// 段階 1: 基本
pub const PEARL_BASIC: &str = "丸の基本";
pub const DEGREE: &str = "マスの次数";

// 段階 2: 小ループ禁と丸の相互作用
pub const SMALL_LOOP_BAN: &str = "小ループ禁";
pub const WHITE_NEIGHBOURS: &str = "白丸の隣の曲がり";

// 段階 3: 大域
pub const CONNECTIVITY: &str = "連結性";
pub const CUT_PARITY: &str = "カット偶奇";
pub const REGION_PARITY: &str = "領域の出入り";

// 段階 4: 場合分け
pub const PEARL_CASES: &str = "丸まわりの場合分け";

// 仮置き(重みは difficulty.rs の専用係数で課金する)
pub const TRIAL_CONTRADICTION: &str = "仮置きの矛盾";
pub const TRIAL_ANY_CASE: &str = "仮置きの共通確定";

pub fn weight(reason: &str) -> i32 {
    match reason {
        PEARL_BASIC => 1,
        DEGREE => 0,
        SMALL_LOOP_BAN => 2,
        WHITE_NEIGHBOURS => 2,
        CONNECTIVITY => 4,
        CUT_PARITY => 8,
        REGION_PARITY => 8,
        PEARL_CASES => 8,
        TRIAL_CONTRADICTION | TRIAL_ANY_CASE => 0,
        _ => 1,
    }
}
