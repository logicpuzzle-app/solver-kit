//! 到達可能性(カタログ B)。ぬりかべで最も効く手筋。
//!
//! どのシマからも届かないマスはかべにするしかない。
//! 「届く」の判定は、数字マスから
//!   - かべ確定のマスを通らない
//!   - 他の数字マスとその隣接マスを通らない(2 つの数字が同じシマに入れないため)
//! という条件で BFS し、距離が島サイズ未満の範囲。
//!
//! sdvx の `setContinueNotBlackPosSet2` / `farSolve` に相当する。
//! `?`(サイズ不明)の数字は距離を制限できないので、盤面全体に届くとみなす。
//! 「全マス − 他の数字の和」で上限を付ける版も試したが、実問題ではその上限が
//! 盤面の半分ほどになり、BFS が結局全体に届いて 1 マスも変わらなかった(README の却下表)。

use crate::answer_methods::AnswerMethods;
use crate::board::UNKNOWN_CLUE;
use crate::reasons::UNREACHABLE_BLACK;
use crate::status::Status;

/// 各数字が届きうるマスの集合。返り値は数字ごとの (自分のシマ, 届く範囲)。
/// 届く範囲には自分のシマも含む。`blocked` のマスは通れないものとして扱う。
///
/// 「数字の組でまとめて容量を数える」手筋(Hall 型)を書くために切り出したが、
/// その手筋は計測で効果がなく取り下げた(README の却下表)。同じ計算を別の
/// 大域手筋で使い回せるので、この関数は残してある。
pub fn reachable_sets(
    board: &crate::board::Board,
    answer: &crate::answer_model::AnswerModel,
    blocked: Option<usize>,
) -> Vec<(Vec<usize>, Vec<bool>)> {
    let count = board.cell_count();
    let clues = board.clue_cells();
    let mut own = vec![Vec::new(); clues.len()];
    for (i, &(start, _)) in clues.iter().enumerate() {
        let mut seen = vec![false; count];
        let mut stack = vec![start];
        seen[start] = true;
        while let Some(index) = stack.pop() {
            own[i].push(index);
            for next in board.neighbours(index) {
                if !seen[next] && answer.is_white(next) {
                    seen[next] = true;
                    stack.push(next);
                }
            }
        }
    }
    let mut forbidden_for = vec![vec![false; count]; clues.len()];
    for (self_i, &(self_index, _)) in clues.iter().enumerate() {
        for (other_i, &(other_index, _)) in clues.iter().enumerate() {
            if self_i == other_i {
                continue;
            }
            forbidden_for[self_i][other_index] = true;
            for n in board.neighbours(other_index) {
                if n != self_index && !own[self_i].contains(&n) {
                    forbidden_for[self_i][n] = true;
                }
            }
        }
    }
    let mut out = Vec::with_capacity(clues.len());
    for (i, &(_, size)) in clues.iter().enumerate() {
        let mut reach = vec![false; count];
        for &index in &own[i] {
            reach[index] = true;
        }
        let limit = if size == UNKNOWN_CLUE {
            i32::MAX
        } else {
            (size - own[i].len() as i32).max(0)
        };
        let mut distance = vec![-1i32; count];
        let mut queue = std::collections::VecDeque::new();
        for &index in &own[i] {
            distance[index] = 0;
            queue.push_back(index);
        }
        while let Some(index) = queue.pop_front() {
            if distance[index] >= limit {
                continue;
            }
            for next in board.neighbours(index) {
                if distance[next] >= 0
                    || forbidden_for[i][next]
                    || answer.is_black(next)
                    || Some(next) == blocked
                {
                    continue;
                }
                distance[next] = distance[index] + 1;
                reach[next] = true;
                queue.push_back(next);
            }
        }
        out.push((std::mem::take(&mut own[i]), reach));
    }
    out
}

pub fn reachable(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let count = board.cell_count();
    let clues = board.clue_cells();

    // 各数字について、既に確定している自分のシマ(白の連結成分)を求める。
    // 残り容量 = 数字 - 既に確定した大きさ。BFS はこの残り容量ぶんしか伸ばせない。
    let mut own = vec![Vec::new(); clues.len()];
    for (i, &(start, _)) in clues.iter().enumerate() {
        let mut seen = vec![false; count];
        let mut stack = vec![start];
        seen[start] = true;
        while let Some(index) = stack.pop() {
            own[i].push(index);
            for next in board.neighbours(index) {
                if !seen[next] && answer.answer.is_white(next) {
                    seen[next] = true;
                    stack.push(next);
                }
            }
        }
    }

    // 他の数字マスとその隣接は、そのシマには使えない。
    let mut forbidden_for = vec![vec![false; count]; clues.len()];
    for (self_i, &(self_index, _)) in clues.iter().enumerate() {
        for (other_i, &(other_index, _)) in clues.iter().enumerate() {
            if self_i == other_i {
                continue;
            }
            forbidden_for[self_i][other_index] = true;
            for n in board.neighbours(other_index) {
                if n != self_index && !own[self_i].contains(&n) {
                    forbidden_for[self_i][n] = true;
                }
            }
        }
    }

    let mut reachable = vec![false; count];
    for (i, &(_, size)) in clues.iter().enumerate() {
        // 既に自分のシマと確定しているマスは当然到達可能。
        for &index in &own[i] {
            reachable[index] = true;
        }
        let limit = if size == UNKNOWN_CLUE {
            i32::MAX
        } else {
            // 残り何マス伸ばせるか。既に size に達していれば 0。
            (size - own[i].len() as i32).max(0)
        };
        // シマ全体を起点にした多始点 BFS。
        let mut distance = vec![-1i32; count];
        let mut queue = std::collections::VecDeque::new();
        for &index in &own[i] {
            distance[index] = 0;
            queue.push_back(index);
        }
        while let Some(index) = queue.pop_front() {
            if distance[index] >= limit {
                continue;
            }
            for next in board.neighbours(index) {
                if distance[next] >= 0 || forbidden_for[i][next] || answer.answer.is_black(next) {
                    continue;
                }
                distance[next] = distance[index] + 1;
                reachable[next] = true;
                queue.push_back(next);
            }
        }
    }

    let mut result = Status::Stopped;
    for index in 0..count {
        if !reachable[index] {
            if answer.answer.is_white(index) {
                return Status::Broken; // 白なのにどの数字にも属せない
            }
            result = crate::answer_methods::merge_status(
                result,
                answer.set_black(index, UNREACHABLE_BLACK),
            );
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
    use crate::answer_model::AnswerModel;
    use crate::board::{Board, NO_CLUE};

    fn apply(board: &Board) -> AnswerModel {
        let mut answer = AnswerModel::new(board);
        let mut methods = AnswerMethods::new(board, &mut answer, None);
        reachable(&mut methods);
        answer
    }

    #[test]
    fn cells_beyond_the_island_size_become_wall() {
        // 1x5 に 2 のシマ。届くのは自分と隣の 1 マスだけ。
        let board = Board::new(5, 1, vec![2, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let answer = apply(&board);
        assert!(answer.is_white(0));
        assert!(answer.is_unknown(1), "隣は届くので未確定のまま");
        for i in 2..5 {
            assert!(answer.is_black(i), "マス {i} は届かないのでかべ");
        }
    }

    #[test]
    fn a_cell_between_two_clues_is_unreachable_for_both() {
        // 1x3 の両端に 2。中央は「他の数字の隣」なのでどちらからも使えない。
        let board = Board::new(3, 1, vec![2, NO_CLUE, 2]).unwrap();
        let answer = apply(&board);
        assert!(answer.is_black(1));
    }

    #[test]
    fn question_mark_clues_reach_everywhere() {
        use crate::board::UNKNOWN_CLUE;
        let board = Board::new(5, 1, vec![UNKNOWN_CLUE, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let answer = apply(&board);
        for i in 1..5 {
            assert!(answer.is_unknown(i), "サイズ不明なら距離で切れない");
        }
    }

    #[test]
    fn existing_walls_block_reachability() {
        use crate::answer_model::CellState;
        // 1x4、左端に 4 のシマ。だが 2 番目がかべなら右側には届かない。
        let board = Board::new(4, 1, vec![4, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(1, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        reachable(&mut methods);
        assert!(answer.is_black(2) && answer.is_black(3));
    }
}
