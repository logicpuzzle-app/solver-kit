//! 置いてみて破綻するか(段階 3)。
//!
//! あるマスに照明を置くと、その光の届くマスにはもう照明を置けない。それだけで
//! どこかの数字が満たせなくなったり、どこかの白マスが照らせなくなったりするなら、
//! そのマスは非照明である。
//!
//! **カタログの C(数字どうしの相互作用)を個別に書かず、これ 1 つにまとめた。**
//! ナナメ手筋・13 手筋・向かい合う 33・1 つおきの 11 は、どれも
//! 「そこに置くと隣の数字が足りなくなる」の言い換えでしかない。
//! 形を覚えて当てはめるのではなく、破綻するかを直接見る方が短く、取りこぼしもない。
//!
//! 逆向き(非照明にすると破綻するマスは照明)は新しい手筋にならない。
//! 数字が足りなくなる場合は `clue` の飽和が、照らせなくなる場合は `only_source` が
//! 先に同じ結論を出す。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::AnswerModel;
use crate::board::Board;
use crate::reasons::{LAMP_BREAKS_CLUE, LAMP_BREAKS_LIGHT};
use crate::status::Status;

/// `target` に照明を置いたとき、光が届いて照明を置けなくなるマス。
fn shadowed(board: &Board, target: usize) -> Vec<usize> {
    board.rays(target).iter().flatten().copied().collect()
}

/// `target` に照明を置くと満たせなくなる数字があるか。
fn breaks_a_clue(board: &Board, answer: &AnswerModel, target: usize, dead: &[bool]) -> bool {
    for (index, want) in board.clue_cells() {
        let mut lamps = 0;
        let mut room = 0;
        for &n in board.neighbours(index) {
            if n == target || answer.is_lamp(n) {
                lamps += 1;
            } else if answer.is_unknown(n) && !dead[n] {
                room += 1;
            }
        }
        if lamps > want || lamps + room < want {
            return true;
        }
    }
    false
}

/// `target` に照明を置くと照らせなくなる白マスがあるか。
fn breaks_the_light(board: &Board, answer: &AnswerModel, target: usize, dead: &[bool]) -> bool {
    let lit = answer.lit(board);
    let mut now_lit = vec![false; board.cell_count()];
    for &seen in board.sight(target) {
        now_lit[seen] = true;
    }
    for index in 0..board.cell_count() {
        if !board.is_open(index) || lit[index] || now_lit[index] {
            continue;
        }
        let reachable = board
            .sight(index)
            .into_iter()
            .any(|&c| c != target && answer.is_unknown(c) && !dead[c]);
        if !reachable {
            return true;
        }
    }
    false
}

pub fn lamp_conflict(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let count = board.cell_count();
    let mut forced: Vec<(usize, &'static str)> = Vec::new();

    for target in 0..count {
        if !answer.answer.is_unknown(target) {
            continue;
        }
        let mut dead = vec![false; count];
        dead[target] = true;
        for seen in shadowed(board, target) {
            dead[seen] = true;
        }
        if breaks_a_clue(board, answer.answer, target, &dead) {
            forced.push((target, LAMP_BREAKS_CLUE));
        } else if breaks_the_light(board, answer.answer, target, &dead) {
            forced.push((target, LAMP_BREAKS_LIGHT));
        }
    }

    let mut result = Status::Stopped;
    for (index, reason) in forced {
        result = merge_status(result, answer.set_empty(index, reason));
        if result == Status::Broken {
            return result;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{Board, OPEN, WALL};

    #[test]
    fn the_diagonal_of_a_nearly_full_clue_is_empty() {
        // 3x3 の中央に 3 のかべ。斜めのマスに照明を置くと、
        // その光が数字の隣 2 マスを潰して 3 マス置けなくなる。
        let mut cells = vec![OPEN; 9];
        cells[4] = 3;
        let board = Board::new(3, 3, cells).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(lamp_conflict(&mut methods), Status::Advanced);
        for corner in [0usize, 2, 6, 8] {
            assert!(model.is_empty(corner), "角 {corner} は非照明のはず");
        }
    }

    #[test]
    fn a_roomy_board_decides_nothing() {
        let board = Board::new(4, 4, vec![OPEN; 16]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(lamp_conflict(&mut methods), Status::Stopped);
    }

    #[test]
    fn a_lamp_that_would_strand_a_cell_is_refused() {
        // 1x5: [白][白][かべ][白][白] のうち、右の 2 マスは互いにしか照らせない。
        // 左側には関係ないので、ここでは何も言えないことを確かめる(健全性)。
        let board = Board::new(5, 1, vec![OPEN, OPEN, WALL, OPEN, OPEN]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_ne!(lamp_conflict(&mut methods), Status::Broken);
    }
}
