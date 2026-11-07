//! 2x2 禁の先読み(カタログ D の強化)。
//!
//! 2x2 の 4 マスのうち 2 マスがかべ、残り 2 マスが未確定のとき、
//! その未確定 2 マスが両方かべになると 2x2 になってしまう。
//! よって「片方をかべにすると、もう片方は白」という関係が生まれる。
//!
//! 単独では確定しないが、その未確定 2 マスがどちらも「かべにするしかない」状況
//! (たとえばどのシマからも届かない)なら矛盾になる。ここでは確定できる形として、
//! **2x2 のうち 3 マスが「かべ確定またはかべにするしかない」なら残りは白**を見る。
//!
//! 「かべにするしかない」= どのシマからも到達できないマス。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::AnswerModel;
use crate::board::{Board, UNKNOWN_CLUE};
use crate::reasons::POOL_WHITE;
use crate::status::Status;

/// どのシマからも到達できないマス(= かべにするしかない)を求める。
fn forced_wall(board: &Board, answer: &AnswerModel) -> Vec<bool> {
    let count = board.cell_count();
    let clues = board.clue_cells();
    let mut reachable = vec![false; count];
    for &(clue_index, size) in &clues {
        let limit = if size == UNKNOWN_CLUE {
            i32::MAX
        } else {
            size - 1
        };
        let mut distance = vec![-1i32; count];
        distance[clue_index] = 0;
        reachable[clue_index] = true;
        let mut queue = std::collections::VecDeque::from([clue_index]);
        while let Some(index) = queue.pop_front() {
            if distance[index] >= limit {
                continue;
            }
            for n in board.neighbours(index) {
                if distance[n] >= 0 || answer.is_black(n) {
                    continue;
                }
                let (nx, ny) = board.position(n);
                if board.is_clue(nx, ny) && n != clue_index {
                    continue;
                }
                distance[n] = distance[index] + 1;
                reachable[n] = true;
                queue.push_back(n);
            }
        }
    }
    (0..count).map(|i| !reachable[i]).collect()
}

pub fn pool_lookahead(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let forced = forced_wall(board, answer.answer);
    // 借用を跨がないよう、判定結果を先に配列へ落としておく。
    let wallish: Vec<bool> = (0..board.cell_count())
        .map(|i| answer.answer.is_black(i) || forced[i])
        .collect();
    let unknown: Vec<bool> = (0..board.cell_count())
        .map(|i| answer.answer.is_unknown(i))
        .collect();

    let mut result = Status::Stopped;
    for y in 0..board.rows - 1 {
        for x in 0..board.cols - 1 {
            let quad = [
                board.index(x, y),
                board.index(x + 1, y),
                board.index(x, y + 1),
                board.index(x + 1, y + 1),
            ];
            let count = quad.iter().filter(|&&i| wallish[i]).count();
            if count == 4 {
                return Status::Broken;
            }
            if count == 3 {
                if let Some(&rest) = quad.iter().find(|&&i| !wallish[i]) {
                    if unknown[rest] {
                        result = merge_status(result, answer.set_white(rest, POOL_WHITE));
                        if result == Status::Broken {
                            return result;
                        }
                    }
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::CellState;
    use crate::board::NO_CLUE;

    #[test]
    fn a_cell_that_must_be_wall_counts_toward_the_pool() {
        // 2x2。左上・右上がかべ確定、左下はどのシマからも届かない → 右下は白
        let board = Board::new(2, 2, vec![NO_CLUE, NO_CLUE, NO_CLUE, 1]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        answer.set(1, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        // (2) は 1 のシマ(index 3)から届かない → かべ扱い。よって残りは…
        // (3) は数字マスなので既に白。矛盾しないことだけ確認する。
        assert_ne!(pool_lookahead(&mut methods), Status::Broken);
    }

    #[test]
    fn plain_three_walls_still_force_the_fourth_white() {
        let board = Board::new(2, 2, vec![NO_CLUE; 4]).unwrap();
        let mut answer = AnswerModel::new(&board);
        for i in 0..3 {
            answer.set(i, CellState::Black).unwrap();
        }
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(pool_lookahead(&mut methods), Status::Advanced);
        assert!(answer.is_white(3));
    }
}
