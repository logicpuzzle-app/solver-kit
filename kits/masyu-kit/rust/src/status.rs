/// 手筋 1 回の結果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// 何か確定した。
    Advanced,
    /// 何も確定しなかった。
    Stopped,
    /// 矛盾した。
    Broken,
}
