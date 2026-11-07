//! 手筋ソルバー専用の解答状態。制約エンジンとは状態も伝播も共有しない。

use crate::board::Board;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellState {
    Unknown,
    /// かべ(黒マス)。
    Black,
    /// シマの一部(白マス)。数字マスは最初から White。
    White,
}

#[derive(Clone, Debug)]
pub struct AnswerModel {
    cells: Vec<CellState>,
}

impl AnswerModel {
    pub fn new(board: &Board) -> Self {
        let mut cells = vec![CellState::Unknown; board.cell_count()];
        // 数字マスは定義上いつでも白。
        for (index, _) in board.clue_cells() {
            cells[index] = CellState::White;
        }
        Self { cells }
    }

    pub fn cells(&self) -> &[CellState] {
        &self.cells
    }

    pub fn get(&self, index: usize) -> CellState {
        self.cells[index]
    }

    pub fn is_black(&self, index: usize) -> bool {
        self.cells[index] == CellState::Black
    }

    pub fn is_white(&self, index: usize) -> bool {
        self.cells[index] == CellState::White
    }

    pub fn is_unknown(&self, index: usize) -> bool {
        self.cells[index] == CellState::Unknown
    }

    pub fn unknown_count(&self) -> usize {
        self.cells
            .iter()
            .filter(|&&c| c == CellState::Unknown)
            .count()
    }

    pub fn is_complete(&self) -> bool {
        self.unknown_count() == 0
    }

    /// 未確定マスに色を置く。
    ///
    /// 戻り値は「新しく確定したか」。既に同じ色なら `Ok(false)`、
    /// 逆の色に確定済みなら `Err`(盤面が矛盾している)。
    pub fn set(&mut self, index: usize, state: CellState) -> Result<bool, String> {
        debug_assert_ne!(state, CellState::Unknown, "未確定へ戻すことはできません");
        match self.cells[index] {
            current if current == state => Ok(false),
            CellState::Unknown => {
                self.cells[index] = state;
                Ok(true)
            }
            _ => Err(format!("マス {index} は既に逆の色で確定しています")),
        }
    }

    pub fn clone_for_trial(&self) -> Self {
        self.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::NO_CLUE;

    fn board() -> Board {
        Board::new(2, 2, vec![NO_CLUE, 1, NO_CLUE, NO_CLUE]).unwrap()
    }

    #[test]
    fn clue_cells_start_white() {
        let model = AnswerModel::new(&board());
        assert!(model.is_white(1));
        assert!(model.is_unknown(0));
    }

    #[test]
    fn setting_the_same_colour_twice_is_not_progress() {
        let mut model = AnswerModel::new(&board());
        assert_eq!(model.set(0, CellState::Black), Ok(true));
        assert_eq!(model.set(0, CellState::Black), Ok(false));
    }

    #[test]
    fn contradicting_an_earlier_decision_is_an_error() {
        let mut model = AnswerModel::new(&board());
        model.set(0, CellState::Black).unwrap();
        assert!(model.set(0, CellState::White).is_err());
    }
}
