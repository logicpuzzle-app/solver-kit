//! 区画の奥は白(`region_budget` と かべの連結性を組み合わせた大域手筋)。
//!
//! かべでないマスの連結成分(区画)に入るかべの数は
//! `区画の広さ − その区画の数字の和` で決まっている。これを k とする。
//!
//! 区画はまわりをかべに囲まれているので、区画の中に置いたかべは
//! **区画の中を通って境界まで到達し、外のかべ本体と合流しなければならない**。
//! つまり区画の中のかべは、境界に接するマスからぶら下がる形にしかならない。
//!
//! よって「境界に接するマスから数えて k マスより奥」のマスはかべにできない = 白。
//!
//! `region_budget` は k = 0 のときしか動けないが、こちらは k が小さければ効く。
//! 人間が「この一角に入るかべは 2 マスだけだから、奥のここは白」と読むのがこれ。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::board::UNKNOWN_CLUE;
use crate::reasons::REGION_DEPTH_WHITE;
use crate::status::Status;
use std::collections::VecDeque;

pub fn region_depth(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let count = board.cell_count();
    if (0..count).all(|i| !answer.answer.is_black(i)) {
        return Status::Stopped; // かべが 1 つもないと境界が決まらない
    }

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

    let mut total = vec![Some(0i32); members.len()];
    for (clue_index, size) in board.clue_cells() {
        let id = region[clue_index];
        if id == usize::MAX {
            return Status::Broken;
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
        let walls = cells.len() as i32 - sum; // この区画に入るかべの数
        if walls < 0 {
            return Status::Broken;
        }
        if walls == 0 {
            continue; // region_budget の担当
        }

        // 境界(外のかべに接するマス)を起点にした多始点 BFS。
        // depth[u] = u を含めて、境界まで並べるのに要するかべの数。
        let mut depth = vec![i32::MAX; count];
        let mut queue = VecDeque::new();
        for &index in cells {
            if board
                .neighbours(index)
                .into_iter()
                .any(|n| answer.answer.is_black(n))
            {
                depth[index] = 1;
                queue.push_back(index);
            }
        }
        if queue.is_empty() {
            continue; // 外のかべに触れていない区画。ここでは何も言えない
        }
        while let Some(index) = queue.pop_front() {
            for n in board.neighbours(index) {
                if region[n] == id && depth[n] == i32::MAX {
                    depth[n] = depth[index] + 1;
                    queue.push_back(n);
                }
            }
        }

        for &index in cells {
            if !answer.answer.is_unknown(index) {
                continue;
            }
            if depth[index] > walls {
                result = merge_status(result, answer.set_white(index, REGION_DEPTH_WHITE));
                if result == Status::Broken {
                    return result;
                }
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
    fn cells_deeper_than_the_wall_budget_are_white() {
        // 1x6: [かべ][.][.][.][.][4]
        // 区画は右の 5 マス、数字の和 4 なのでかべは 1 マス。
        // 境界に接するのは 1 マス目だけなので、2 マス目より奥はすべて白。
        let board = Board::new(6, 1, vec![NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE, 4]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(region_depth(&mut methods), Status::Advanced);
        assert!(answer.is_unknown(1), "境界のマスはかべになりうる");
        for i in 2..5 {
            assert!(answer.is_white(i), "マス {i} は奥すぎてかべにできない");
        }
    }

    #[test]
    fn a_roomy_region_decides_nothing() {
        // 1x6: [かべ][.][.][.][.][2] — かべは 3 マス入るので奥まで届く
        let board = Board::new(6, 1, vec![NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE, 2]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        region_depth(&mut methods);
        assert!(answer.is_unknown(3), "深さ 3 でかべ 3 マスなら確定しない");
    }
}
