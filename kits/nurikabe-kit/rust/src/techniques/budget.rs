//! マス数の勘定(カタログ D)。
//!
//! 白マスの総数は数字の和で決まっているので、かべの総数も決まっている。
//! - 白が数字の和に達したら、残りは全部かべ
//! - かべが総数に達したら、残りは全部白
//!
//! 終盤で一気に片付く手筋で、人間も最後に必ず使う。`?` の数字が 1 つでもあると
//! 総数が決まらないので、その盤面では何もしない。
//! (`?` を「1 マス以上」として下限で動かす版も試したが、1 マスも変わらなかった。
//!  README の却下表を参照。)

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::board::UNKNOWN_CLUE;
use crate::reasons::{BUDGET_BLACK, BUDGET_WHITE};
use crate::status::Status;

pub fn budget(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let clues = board.clue_cells();
    if clues.iter().any(|&(_, size)| size == UNKNOWN_CLUE || size <= 0) {
        return Status::Stopped;
    }
    let white_total: i32 = clues.iter().map(|&(_, size)| size).sum();
    let count = board.cell_count();
    let black_total = count as i32 - white_total;

    let white_now = (0..count).filter(|&i| answer.answer.is_white(i)).count() as i32;
    let black_now = (0..count).filter(|&i| answer.answer.is_black(i)).count() as i32;
    if white_now > white_total || black_now > black_total {
        return Status::Broken;
    }

    let fill = if white_now == white_total {
        Some((false, BUDGET_BLACK))
    } else if black_now == black_total {
        Some((true, BUDGET_WHITE))
    } else {
        None
    };
    let Some((white, reason)) = fill else {
        return Status::Stopped;
    };

    let mut result = Status::Stopped;
    for index in 0..count {
        if !answer.answer.is_unknown(index) {
            continue;
        }
        let status = if white {
            answer.set_white(index, reason)
        } else {
            answer.set_black(index, reason)
        };
        result = merge_status(result, status);
        if result == Status::Broken {
            return result;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::{AnswerModel, CellState};
    use crate::board::{Board, NO_CLUE};

    #[test]
    fn when_every_white_is_placed_the_rest_is_wall() {
        // 1x4 に 2 のシマ。白 2 マスが揃えば残りはかべ。
        let board = Board::new(4, 1, vec![2, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(1, CellState::White).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(budget(&mut methods), Status::Advanced);
        assert!(answer.is_black(2) && answer.is_black(3));
    }

    #[test]
    fn when_every_wall_is_placed_the_rest_is_white() {
        // 1x4 に 3 のシマ。かべは 1 マスだけなので、置いた時点で残りは白。
        let board = Board::new(4, 1, vec![3, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(3, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(budget(&mut methods), Status::Advanced);
        assert!(answer.is_white(1) && answer.is_white(2));
    }

    #[test]
    fn unknown_clues_disable_the_count() {
        use crate::board::UNKNOWN_CLUE;
        let board = Board::new(4, 1, vec![UNKNOWN_CLUE, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(budget(&mut methods), Status::Stopped);
    }
}
