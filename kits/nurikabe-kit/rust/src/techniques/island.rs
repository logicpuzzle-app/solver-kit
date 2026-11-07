//! シマの伸び方に関する手筋(カタログ A の後半)。
//!
//! - 完成したシマ: 大きさが数字に達したシマの周りはかべ
//! - 伸びる先が一意: まだ足りないシマの伸ばせる方向が 1 つならそこは白
//! - 四方をかべ: 未確定マスの四方がかべなら、そのマスもかべ(1 マスのシマになれない)

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::AnswerModel;
use crate::board::{Board, UNKNOWN_CLUE};
use crate::reasons::{ISLAND_COMPLETE, ISLAND_MUST_GROW, SURROUNDED_BLACK};
use crate::status::Status;

/// 白マスの連結成分を 1 つ取り出す。(マスの集合, 隣接する未確定マスの集合)
fn white_group(board: &Board, answer: &AnswerModel, start: usize) -> (Vec<usize>, Vec<usize>) {
    let mut seen = vec![false; board.cell_count()];
    let mut stack = vec![start];
    let mut group = Vec::new();
    let mut frontier = Vec::new();
    seen[start] = true;
    while let Some(index) = stack.pop() {
        group.push(index);
        for next in board.neighbours(index) {
            if seen[next] {
                continue;
            }
            if answer.is_white(next) {
                seen[next] = true;
                stack.push(next);
            } else if answer.is_unknown(next) {
                seen[next] = true;
                frontier.push(next);
            }
        }
    }
    (group, frontier)
}

pub fn island(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut result = Status::Stopped;

    // 数字を含む白の連結成分ごとに、完成/伸長を見る
    for (clue_index, size) in board.clue_cells() {
        if size == UNKNOWN_CLUE {
            continue; // サイズ不明では判断できない
        }
        let (group, frontier) = white_group(board, answer.answer, clue_index);
        if group.len() as i32 > size {
            return Status::Broken; // シマが大きすぎる
        }
        if group.len() as i32 == size {
            // 完成。周りは全部かべ。
            result = merge_status(
                result,
                answer.set_many(frontier, crate::answer_model::CellState::Black, ISLAND_COMPLETE),
            );
        } else if frontier.len() == 1 {
            // まだ足りないのに伸ばせる先が 1 つ → そこは白
            result = merge_status(result, answer.set_white(frontier[0], ISLAND_MUST_GROW));
        } else if frontier.is_empty() {
            return Status::Broken; // 足りないのに伸ばせない
        }
        if result == Status::Broken {
            return result;
        }
    }

    // 四方をかべに囲まれた未確定マスは、単独のシマになるしかないのでかべ
    for index in 0..board.cell_count() {
        if !answer.answer.is_unknown(index) {
            continue;
        }
        if board.neighbours(index).iter().all(|&n| answer.answer.is_black(n)) {
            result = merge_status(result, answer.set_black(index, SURROUNDED_BLACK));
            if result == Status::Broken {
                return result;
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
    fn a_finished_island_is_walled_off() {
        // 1x3、左端が 1 → 完成しているので隣はかべ
        let board = Board::new(3, 1, vec![1, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(island(&mut methods), Status::Advanced);
        assert!(answer.is_black(1));
    }

    #[test]
    fn an_island_with_one_way_out_grows() {
        // 1x3、中央が 2、左がかべ → 右へ伸びるしかない
        let board = Board::new(3, 1, vec![NO_CLUE, 2, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(island(&mut methods), Status::Advanced);
        assert!(answer.is_white(2));
    }

    #[test]
    fn an_island_that_cannot_grow_is_a_contradiction() {
        let board = Board::new(3, 1, vec![NO_CLUE, 2, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        answer.set(2, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(island(&mut methods), Status::Broken);
    }

    #[test]
    fn a_cell_boxed_in_by_walls_becomes_wall() {
        // 3x3 の中央が未確定、四方がかべ
        let board = Board::new(3, 3, vec![NO_CLUE; 9]).unwrap();
        let mut answer = AnswerModel::new(&board);
        for i in [1, 3, 5, 7] {
            answer.set(i, CellState::Black).unwrap();
        }
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        island(&mut methods);
        assert!(answer.is_black(4));
    }
}
