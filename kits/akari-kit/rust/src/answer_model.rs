//! 解答の状態。
//!
//! 白マスは「照明」「照明を置かない」「未確定」の 3 値。
//! **照らされているかは持たない** — 照明の配置から導ける派生量で、
//! 状態として持つと照明 1 つを置くたびに何マスも書き換わり、
//! どの手筋が何を決めたかの記録が壊れる。

use crate::board::Board;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CellState {
    Unknown,
    /// 照明を置く。
    Lamp,
    /// 照明を置かない(照らされているかは別問題)。
    Empty,
}

#[derive(Clone, Debug)]
pub struct AnswerModel {
    states: Vec<CellState>,
}

impl AnswerModel {
    /// かべは最初から `Empty`(照明は置けない)。
    pub fn new(board: &Board) -> Self {
        let states = (0..board.cell_count())
            .map(|index| {
                if board.is_wall(index) {
                    CellState::Empty
                } else {
                    CellState::Unknown
                }
            })
            .collect();
        Self { states }
    }

    pub fn state(&self, index: usize) -> CellState {
        self.states[index]
    }

    pub fn is_lamp(&self, index: usize) -> bool {
        self.states[index] == CellState::Lamp
    }

    pub fn is_empty(&self, index: usize) -> bool {
        self.states[index] == CellState::Empty
    }

    pub fn is_unknown(&self, index: usize) -> bool {
        self.states[index] == CellState::Unknown
    }

    /// 置けたら `Ok(true)`、既に同じなら `Ok(false)`、食い違えば `Err`。
    pub fn set(&mut self, index: usize, state: CellState) -> Result<bool, String> {
        match self.states[index] {
            CellState::Unknown => {
                self.states[index] = state;
                Ok(true)
            }
            current if current == state => Ok(false),
            current => Err(format!(
                "マス {index} は既に {current:?} なので {state:?} にできません"
            )),
        }
    }

    pub fn unknown_count(&self) -> usize {
        self.states
            .iter()
            .filter(|&&s| s == CellState::Unknown)
            .count()
    }

    pub fn is_complete(&self) -> bool {
        self.unknown_count() == 0
    }

    pub fn lamps(&self) -> Vec<usize> {
        (0..self.states.len())
            .filter(|&index| self.is_lamp(index))
            .collect()
    }

    /// 仮置き用の複製。状態しか持っていないので、そのまま複製すればよい。
    pub fn clone_for_trial(&self) -> Self {
        self.clone()
    }

    /// いま置かれている照明に照らされているマス。
    ///
    /// 派生量なので毎回数え直す。盤面が高々数百マスなので、
    /// 差分更新の複雑さを持ち込むより数え直す方が安い。
    pub fn lit(&self, board: &Board) -> Vec<bool> {
        let mut out = vec![false; board.cell_count()];
        for index in self.lamps() {
            for &seen in board.sight(index) {
                out[seen] = true;
            }
        }
        out
    }
}
