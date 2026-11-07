/// 手筋 1 回の適用結果。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    /// 何かが新しく確定した。
    Advanced,
    /// 何も確定しなかった(手詰まり)。
    Stopped,
    /// 盤面が矛盾している。
    Broken,
}
