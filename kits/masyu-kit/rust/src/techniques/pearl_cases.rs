//! 丸まわりの場合分け。
//!
//! 丸の通り方は少ない: 白丸は縦横の 2 通り、黒丸は腕の組み合わせで
//! 高々 4 通り。全部並べて軽い手筋で押し込み、生き残った通り方すべてで
//! 同じに決まる辺を確定させる。全滅なら矛盾。
//!
//! 仮置きとの違いは場合分けの単位。辺 1 本の線/× ではなく「この丸を
//! どう通るか」という意味のある少数の場合だけを見る。黒丸と斜めの白丸の
//! 相互作用のような形もここで拾える。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::{AnswerModel, EdgeState};
use crate::board::{opposite, Board, BLACK, DOWN, NO_EDGE, RIGHT, WHITE};
use crate::reasons::PEARL_CASES;
use crate::status::Status;
use crate::techniques::degree::degree;
use crate::techniques::pearl_basic::pearl_basic;
use crate::techniques::small_loop_ban::small_loop_ban;
use crate::techniques::white_neighbours::white_neighbours;

/// 1 通りぶんの辺の割り当て。
type Case = Vec<(usize, EdgeState)>;

fn white_cases(board: &Board, cell: usize) -> Vec<Case> {
    [RIGHT, DOWN]
        .iter()
        .filter_map(|&axis| {
            let mut case = Vec::new();
            for dir in [axis, opposite(axis)] {
                let e = board.incident(cell)[dir];
                if e == NO_EDGE {
                    return None;
                }
                case.push((e, EdgeState::Line));
            }
            for dir in [axis ^ 1, opposite(axis ^ 1)] {
                let e = board.incident(cell)[dir];
                if e != NO_EDGE {
                    case.push((e, EdgeState::Bar));
                }
            }
            Some(case)
        })
        .collect()
}

fn black_cases(board: &Board, cell: usize) -> Vec<Case> {
    let arm = |dir: usize| -> Option<Case> {
        let e1 = board.incident(cell)[dir];
        if e1 == NO_EDGE {
            return None;
        }
        let mid = board.neighbour(cell, dir);
        let e2 = board.incident(mid)[dir];
        if e2 == NO_EDGE {
            return None;
        }
        let mut case = vec![(e1, EdgeState::Line), (e2, EdgeState::Line)];
        let back = board.incident(cell)[opposite(dir)];
        if back != NO_EDGE {
            case.push((back, EdgeState::Bar));
        }
        Some(case)
    };
    let mut cases = Vec::new();
    for v in [DOWN, opposite(DOWN)] {
        for h in [RIGHT, opposite(RIGHT)] {
            if let (Some(a), Some(b)) = (arm(v), arm(h)) {
                let mut case = a;
                case.extend(b);
                cases.push(case);
            }
        }
    }
    cases
}

/// 1 通りを盤面に押し込み、軽い手筋で収束させて生き残るか調べる。
fn survives(board: &Board, base: &AnswerModel, case: &Case) -> Option<AnswerModel> {
    let mut trial = base.clone_for_trial();
    for &(edge, state) in case {
        match trial.set(board, edge, state) {
            Ok(_) => {}
            Err(_) => return None,
        }
    }
    loop {
        let mut methods = AnswerMethods::new(board, &mut trial, None);
        let mut status = Status::Stopped;
        for technique in [degree, pearl_basic, white_neighbours, small_loop_ban] {
            status = merge_status(status, technique(&mut methods));
            if status == Status::Broken {
                return None;
            }
        }
        if status == Status::Stopped {
            return Some(trial);
        }
    }
}

pub fn pearl_cases(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;

    for &(cell, pearl) in board.pearls() {
        // まわりが全部決まっている丸は見ない。
        if board
            .incident(cell)
            .iter()
            .all(|&e| e == NO_EDGE || !answer.answer.is_unknown(e))
        {
            continue;
        }
        let cases = if pearl == WHITE {
            white_cases(board, cell)
        } else if pearl == BLACK {
            black_cases(board, cell)
        } else {
            continue;
        };

        let survivors: Vec<AnswerModel> = cases
            .iter()
            .filter_map(|case| survives(board, answer.answer, case))
            .collect();
        if survivors.is_empty() {
            return Status::Broken;
        }

        // どの通り方でも同じに決まる辺を取り込む。
        let mut agreed: Vec<(usize, EdgeState)> = Vec::new();
        for edge in 0..board.edge_count() {
            if !answer.answer.is_unknown(edge) {
                continue;
            }
            let state = survivors[0].edge(edge);
            if state == EdgeState::Unknown {
                continue;
            }
            if survivors[1..].iter().all(|s| s.edge(edge) == state) {
                agreed.push((edge, state));
            }
        }
        if !agreed.is_empty() {
            let mut result = Status::Stopped;
            for (edge, state) in agreed {
                result = merge_status(result, answer.set(edge, state, PEARL_CASES));
                if result == Status::Broken {
                    return result;
                }
            }
            // 1 丸ぶん確定したら戻る(次のパスでまた安い手筋から回す)。
            return result;
        }
    }
    Status::Stopped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_methods::AnswerMethods;
    use crate::answer_model::AnswerModel;

    #[test]
    fn a_black_pearl_with_two_diagonal_whites_turns_away() {
        // 黒丸の上側の斜め 2 マスが両方白丸だと、上に腕を張れない
        // (Wikipedia の手筋 12)。どの生き残りでも下の腕が共通になる。
        let board = Board::new(6, 6, {
            let mut cells = vec![0; 36];
            cells[14] = BLACK; // (2,2)
            cells[7] = WHITE; // (1,1)
            cells[9] = WHITE; // (3,1)
            cells
        })
        .unwrap();
        let mut model = AnswerModel::new(&board);
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        let status = pearl_cases(&mut answer);
        assert_eq!(status, Status::Advanced);
        assert!(model.is_line_at(&board, 14, DOWN));
    }
}
