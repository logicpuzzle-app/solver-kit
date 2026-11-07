//! 区画ごとのマス数の勘定(カタログ D の大域版)。
//!
//! シマはかべをまたげないので、**かべでないマスの連結成分(区画)ごとに、
//! 白マスの数は「その区画に入っている数字の和」で決まっている**。
//!
//! - 和 > 区画の広さ、または 和 < 区画内の確定した白 → 矛盾
//! - これから白にするマス数が 0 → 区画の未確定はすべてかべ
//! - これから白にするマス数 = 区画の未確定マス数 → 区画の未確定はすべて白
//!
//! 盤面全体で数える `budget` は終盤にしか効かないが、こちらは
//! かべが盤面を分け始めた時点から効く。人間が「この右下の一角は 4 マスで、
//! 入っている数字は 3 だから 1 マスだけかべ」と読むのがこれ。
//!
//! `?` の数字が入っている区画は和が決まらないので手を出さない。
//! (下限で動かす版も試したが、1 マスも変わらなかった。README の却下表を参照。)

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::board::UNKNOWN_CLUE;
use crate::reasons::{REGION_ALL_BLACK, REGION_ALL_WHITE};
use crate::status::Status;

pub fn region_budget(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let count = board.cell_count();

    // かべでないマス(白 ∪ 未確定)の連結成分に番号を振る
    let mut region = vec![usize::MAX; count];
    let mut members: Vec<Vec<usize>> = Vec::new();
    for start in 0..count {
        if answer.answer.is_black(start) || region[start] != usize::MAX {
            continue;
        }
        let id = members.len();
        let mut cells = Vec::new();
        let mut stack = vec![start];
        region[start] = id;
        while let Some(index) = stack.pop() {
            cells.push(index);
            for n in board.neighbours(index) {
                if region[n] == usize::MAX && !answer.answer.is_black(n) {
                    region[n] = id;
                    stack.push(n);
                }
            }
        }
        members.push(cells);
    }

    // 区画ごとの数字の和。`?` が混じったら諦める。
    let mut total = vec![Some(0i32); members.len()];
    for (clue_index, size) in board.clue_cells() {
        let id = region[clue_index];
        if id == usize::MAX {
            return Status::Broken; // 数字マスがかべになっている
        }
        if size == UNKNOWN_CLUE || size <= 0 {
            total[id] = None;
        } else if let Some(sum) = total[id].as_mut() {
            *sum += size;
        }
    }

    let mut result = Status::Stopped;
    for (id, cells) in members.iter().enumerate() {
        let Some(sum) = total[id] else { continue };
        let white_now = cells.iter().filter(|&&i| answer.answer.is_white(i)).count() as i32;
        let unknown: Vec<usize> = cells
            .iter()
            .copied()
            .filter(|&i| answer.answer.is_unknown(i))
            .collect();
        if sum > cells.len() as i32 || sum < white_now {
            return Status::Broken;
        }
        let need = sum - white_now; // この区画でこれから白にするマス数
        let (fill_white, reason) = if need == 0 {
            (false, REGION_ALL_BLACK)
        } else if need == unknown.len() as i32 {
            (true, REGION_ALL_WHITE)
        } else {
            continue;
        };
        for index in unknown {
            let status = if fill_white {
                answer.set_white(index, reason)
            } else {
                answer.set_black(index, reason)
            };
            result = merge_status(result, status);
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
    use crate::answer_model::{AnswerModel, CellState};
    use crate::board::{Board, NO_CLUE};

    #[test]
    fn a_region_that_exactly_fits_its_clues_is_all_white() {
        // 1x5: [2][.][かべ][3][.] — 右の区画は 2 マスに 3 が入る…ではなく
        // 左の区画は 2 マスで数字の和 2 なので全部白
        let board = Board::new(5, 1, vec![2, NO_CLUE, NO_CLUE, 2, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(2, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(region_budget(&mut methods), Status::Advanced);
        assert!(answer.is_white(1), "左の区画は 2 マスちょうど");
        assert!(answer.is_white(4), "右の区画も 2 マスちょうど");
    }

    #[test]
    fn a_region_with_no_room_left_is_all_wall() {
        // 1x5: [1][.][.][かべ][.] — 左の区画は 3 マスだが数字は 1 なので残りはかべ
        let board = Board::new(5, 1, vec![1, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(3, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        region_budget(&mut methods);
        assert!(answer.is_black(1) && answer.is_black(2));
        assert!(answer.is_black(4), "数字のない区画はまるごとかべ");
    }

    #[test]
    fn a_region_too_small_for_its_clues_is_a_contradiction() {
        // 1x4: [3][.][かべ][.] — 3 のシマが 2 マスの区画に閉じ込められている
        let board = Board::new(4, 1, vec![3, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(2, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(region_budget(&mut methods), Status::Broken);
    }
}
