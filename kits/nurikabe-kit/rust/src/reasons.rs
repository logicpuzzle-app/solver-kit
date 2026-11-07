//! 手筋の名前と、難易度スコアでの重み。
//!
//! 名前は `&'static str` 定数にしておき、Recorder のキーと weight の引き数を兼ねる。

// A. 数字まわり
pub const CLUE_NEIGHBOUR_BLACK: &str = "1のシマの周り";
pub const DIAGONAL_CLUES: &str = "斜め数字の間";
pub const GAP_BETWEEN_CLUES: &str = "1マス飛ばしの数字";
pub const ISLAND_COMPLETE: &str = "完成したシマを囲う";
pub const ISLAND_MUST_GROW: &str = "シマの伸びる先が一意";

// B. 到達可能性
pub const UNREACHABLE_BLACK: &str = "どの数字も届かないマス";
pub const SHAPE_ALWAYS_WHITE: &str = "シマの形の共通部分";
/// 数字を含まない白のまとまりが、どの数字につながるにしても必ず通るマス。
pub const WHITE_LINK: &str = "白のまとまりの行き先";
pub const SHAPE_NEVER_BLACK: &str = "どの形にも入らないマス";
pub const SURROUNDED_BLACK: &str = "四方をかべに囲まれたマス";

// C. かべの連結
pub const WALL_EXTEND: &str = "かべの延長";
/// かべにすると本体と合流できないマス。
pub const WALL_STRANDED: &str = "かべが孤立するマス";
/// 白にすると、離れたかべを結ぶ費用が残りのかべの本数を超えるマス。
pub const WALL_BUDGET: &str = "かべを結ぶ本数が足りない";

// D. マス数の勘定
/// 白が数字の和に達したので、残りはかべ。
pub const BUDGET_BLACK: &str = "白の総数が尽きた";
/// かべが総数に達したので、残りは白。
pub const BUDGET_WHITE: &str = "かべの総数が尽きた";
/// 区画の白がもう入らない(区画の数字の和に達した)。
pub const REGION_ALL_BLACK: &str = "区画の白が尽きた";
/// 区画の未確定がちょうど数字の和ぶん残っている。
pub const REGION_ALL_WHITE: &str = "区画がちょうど数字ぶん";
/// 区画に入るかべの数より奥にあるマス。かべにすると本体に届かない。
pub const REGION_DEPTH_WHITE: &str = "区画の奥は白";

// E. 2x2 禁止
pub const POOL_WHITE: &str = "2x2禁による白";

// 仮置き
pub const TRIAL_CONTRADICTION: &str = "仮置きによる矛盾";
pub const TRIAL_ANY_CASE: &str = "いずれの色にしても確定";

/// 難易度スコアでの重み。手筋を足したらここにも足す。
/// `_ => 1` があるので足し忘れても無償にはならない。
pub fn weight(reason: &str) -> i32 {
    match reason {
        CLUE_NEIGHBOUR_BLACK | ISLAND_COMPLETE | SURROUNDED_BLACK => 1,
        DIAGONAL_CLUES | GAP_BETWEEN_CLUES | POOL_WHITE => 2,
        BUDGET_BLACK | BUDGET_WHITE => 3,
        REGION_ALL_BLACK | REGION_ALL_WHITE => 5,
        REGION_DEPTH_WHITE => 7,
        WALL_EXTEND | WALL_STRANDED | ISLAND_MUST_GROW => 4,
        WALL_BUDGET => 7,
        UNREACHABLE_BLACK => 6,
        SHAPE_ALWAYS_WHITE | SHAPE_NEVER_BLACK => 8,
        WHITE_LINK => 9,
        // 仮置きは専用の係数で課金するので、ここでは 0。
        TRIAL_CONTRADICTION | TRIAL_ANY_CASE => 0,
        _ => 1,
    }
}
