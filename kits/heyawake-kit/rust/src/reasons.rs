//! 手筋の名前と、難易度スコアでの重み。
//!
//! 名前は `&'static str` 定数にしておき、Recorder のキーと weight の引き数を兼ねる。

// 段階 1: 部屋の数字と黒隣接禁
/// 部屋の黒が数字ぶん置けたので、残りは白。
pub const CLUE_FULL: &str = "部屋の黒が数字ぶん";
/// 未確定が残り必要な黒数と同じなので、全部黒。
pub const CLUE_SATURATED: &str = "部屋の残りが必要黒数ぶん";
/// 黒マスのタテヨコ隣は白。
pub const BLACK_ADJACENT: &str = "黒マスの隣";

// 段階 2: 部屋の黒配置の全列挙
/// 部屋の置き方すべてで黒だったマス。飛び石定理・重隅定理をこの形で包含する。
pub const ROOM_ALL_BLACK: &str = "部屋のどの置き方でも黒";
/// 部屋の置き方すべてで白だったマス。腹の白・足下の白をこの形で包含する。
pub const ROOM_ALL_WHITE: &str = "部屋のどの置き方でも白";

// 段階 3: 3 連続禁
/// 白の直線が部屋境界を 2 本またぐ窓に黒が 1 マスしか置けない。内向き・外向きの両形。
pub const THREE_IN_LINE: &str = "白の三部屋連続を止める黒";

// 段階 4: 分断禁
/// そこを黒にすると白が将来もつながらない。寸断・二重アース・ループを含む。
pub const CUT_WHITE: &str = "白を分断する位置";

// 仮置き
pub const TRIAL_CONTRADICTION: &str = "仮置きによる矛盾";
pub const TRIAL_ANY_CASE: &str = "いずれの色にしても確定";

/// 係数は未較正。puzsq コーパスでの較正までは相対値としてのみ扱う。
pub fn weight(_reason: &str) -> i32 {
    1
}
