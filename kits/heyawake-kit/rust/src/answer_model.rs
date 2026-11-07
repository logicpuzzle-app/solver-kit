//! 手筋ソルバー専用の、黒・白・未確定の 3 値状態。

use crate::board::Board;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellState {
    Unknown,
    Black,
    White,
}

#[derive(Clone, Debug)]
pub struct AnswerModel {
    cells: Vec<CellState>,
}

impl AnswerModel {
    pub fn new(board: &Board) -> Self {
        Self {
            cells: vec![CellState::Unknown; board.cell_count()],
        }
    }

    pub fn cells(&self) -> &[CellState] {
        &self.cells
    }

    pub fn state(&self, index: usize) -> CellState {
        self.cells[index]
    }

    pub fn get(&self, index: usize) -> CellState {
        self.state(index)
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

    pub fn set(&mut self, index: usize, state: CellState) -> Result<bool, String> {
        debug_assert_ne!(state, CellState::Unknown, "未確定へ戻すことはできません");
        match self.cells[index] {
            CellState::Unknown => {
                self.cells[index] = state;
                Ok(true)
            }
            current if current == state => Ok(false),
            current => Err(format!(
                "マス {index} は既に {current:?} なので {state:?} にできません"
            )),
        }
    }

    pub fn unknown_count(&self) -> usize {
        self.cells
            .iter()
            .filter(|&&state| state == CellState::Unknown)
            .count()
    }

    pub fn is_complete(&self) -> bool {
        self.unknown_count() == 0
    }

    pub fn clone_for_trial(&self) -> Self {
        self.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cells_start_unknown_and_cannot_change_colour() {
        let board = Board::new(1, 1, vec![], vec![], vec![None]).unwrap();
        let mut answer = AnswerModel::new(&board);
        assert!(answer.is_unknown(0));
        assert_eq!(answer.set(0, CellState::Black), Ok(true));
        assert_eq!(answer.set(0, CellState::Black), Ok(false));
        assert!(answer.set(0, CellState::White).is_err());
    }
}
