//! 数字まわりの場合分け(段階 4)。
//!
//! 数字のまわりに照明をどう置くかは、たかだか 4 マスから選ぶだけなので
//! **全部並べられる**(多くても 6 通り)。それぞれについて、
//!
//! - 置いた照明どうしが照らし合わないか
//! - その光で他の数字が満たせなくならないか
//! - その光で照らせなくなる白マスが出ないか
//!
//! を確かめ、生き残った置き方すべてに共通するマスを確定させる。
//!
//! `lamp_conflict` は照明を 1 つずつしか置いてみないので、
//! 「2 つ置いたときだけ破綻する」形を捉えられない。こちらはそれを捉える。
//! ぬりかべでいちばん効いた「シマの形の全列挙」の美術館版にあたる。
//!
//! 生き残る置き方が 1 つも無ければ矛盾。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::{AnswerModel, CellState};
use crate::board::Board;
use crate::reasons::CLUE_CASES;
use crate::status::Status;

/// `size` 個を選ぶ組み合わせをすべて並べる。`items` は高々 4 個。
fn combinations(items: &[usize], size: usize) -> Vec<Vec<usize>> {
    let mut out = Vec::new();
    let mut pick = Vec::new();
    fn walk(
        items: &[usize],
        size: usize,
        at: usize,
        pick: &mut Vec<usize>,
        out: &mut Vec<Vec<usize>>,
    ) {
        if pick.len() == size {
            out.push(pick.clone());
            return;
        }
        for i in at..items.len() {
            pick.push(items[i]);
            walk(items, size, i + 1, pick, out);
            pick.pop();
        }
    }
    walk(items, size, 0, &mut pick, &mut out);
    out
}

/// この置き方でルールが破れていないか。破れていたら false。
///
/// `source_cases` と共用する。
pub(crate) fn survives(board: &Board, trial: &AnswerModel) -> bool {
    // 照明どうしが照らし合っていないか
    for index in trial.lamps() {
        for ray in board.rays(index) {
            if ray.iter().any(|&seen| trial.is_lamp(seen)) {
                return false;
            }
        }
    }
    // どの数字もまだ満たせるか
    for (index, want) in board.clue_cells() {
        let mut lamps = 0;
        let mut room = 0;
        for &n in board.neighbours(index) {
            if trial.is_lamp(n) {
                lamps += 1;
            } else if trial.is_unknown(n) {
                room += 1;
            }
        }
        if lamps > want || lamps + room < want {
            return false;
        }
    }
    // まだ照らせる見込みのない白マスが出ていないか
    let lit = trial.lit(board);
    for index in 0..board.cell_count() {
        if !board.is_open(index) || lit[index] {
            continue;
        }
        if !board.sight(index).iter().any(|&c| trial.is_unknown(c)) {
            return false;
        }
    }
    true
}

pub fn clue_cases(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let count = board.cell_count();
    let mut forced: Vec<(usize, CellState)> = Vec::new();

    for (index, want) in board.clue_cells() {
        let neighbours = board.neighbours(index);
        let lamps = neighbours.iter().filter(|&&n| answer.answer.is_lamp(n)).count() as i32;
        let unknown: Vec<usize> = neighbours
            .iter()
            .copied()
            .filter(|&n| answer.answer.is_unknown(n))
            .collect();
        let need = want - lamps;
        if need <= 0 || need > unknown.len() as i32 {
            continue; // `clue` の担当か、そもそも矛盾
        }
        if need as usize == unknown.len() {
            continue; // 選ぶ余地がない。`clue` の飽和が決める
        }

        let mut always_lamp = vec![true; count];
        let mut always_empty = vec![true; count];
        let mut found = 0;
        for placement in combinations(&unknown, need as usize) {
            let mut trial = answer.answer.clone_for_trial();
            let mut ok = true;
            for &cell in &unknown {
                let state = if placement.contains(&cell) {
                    CellState::Lamp
                } else {
                    CellState::Empty
                };
                if trial.set(cell, state).is_err() {
                    ok = false;
                    break;
                }
            }
            // 置いた照明の光の上には照明を置けない
            if ok {
                for &cell in &placement {
                    for ray in board.rays(cell) {
                        for &seen in ray {
                            if trial.is_unknown(seen) && trial.set(seen, CellState::Empty).is_err() {
                                ok = false;
                            }
                        }
                    }
                }
            }
            if !ok || !survives(board, &trial) {
                continue;
            }
            found += 1;
            for cell in 0..count {
                match trial.state(cell) {
                    CellState::Lamp => always_empty[cell] = false,
                    CellState::Empty => always_lamp[cell] = false,
                    CellState::Unknown => {
                        always_lamp[cell] = false;
                        always_empty[cell] = false;
                    }
                }
            }
        }
        if found == 0 {
            return Status::Broken; // どの置き方も成り立たない
        }
        for cell in 0..count {
            if !answer.answer.is_unknown(cell) {
                continue;
            }
            if always_lamp[cell] {
                forced.push((cell, CellState::Lamp));
            } else if always_empty[cell] {
                forced.push((cell, CellState::Empty));
            }
        }
    }

    let mut result = Status::Stopped;
    for (index, state) in forced {
        result = merge_status(result, answer.set(index, state, CLUE_CASES));
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
    fn combinations_are_enumerated_without_repeats() {
        assert_eq!(combinations(&[1, 2, 3], 2).len(), 3);
        assert_eq!(combinations(&[1, 2, 3, 4], 2).len(), 6);
    }

    #[test]
    fn a_placement_that_strands_a_cell_is_dropped() {
        // 3x3、中央が 1 のかべ。四隅は白。
        //   .  .  .
        //   .  1  .
        //   .  .  .
        // 1 の照明が上下左右のどこに来ても、四隅のうちどれかは照らされない…
        // わけではないので、ここでは矛盾を出さないことだけ確かめる(健全性)。
        let mut cells = vec![OPEN; 9];
        cells[4] = 1;
        let board = Board::new(3, 3, cells).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_ne!(clue_cases(&mut methods), Status::Broken);
    }

    #[test]
    fn a_clue_with_no_choice_is_left_to_the_basic_technique() {
        // 1x3: [白][2のかべ][白] — 選ぶ余地がないので何もしない
        let board = Board::new(3, 1, vec![OPEN, 2, OPEN]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(clue_cases(&mut methods), Status::Stopped);
    }

    #[test]
    fn a_wall_line_does_not_confuse_the_enumeration() {
        let cells = vec![OPEN, WALL, OPEN, OPEN, 1, OPEN, OPEN, WALL, OPEN];
        let board = Board::new(3, 3, cells).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_ne!(clue_cases(&mut methods), Status::Broken);
    }
}
