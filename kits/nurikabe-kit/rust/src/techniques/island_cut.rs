//! シマの継続(カタログ B の裏返し)。
//!
//! あるマスをかべにすると、どこかのシマが必要な大きさまで伸びられなくなるなら、
//! そのマスは白である。`reachable` が「届かないマスはかべ」と言うのに対し、
//! こちらは「そこを塞ぐと足りなくなるマスは白」と言う。
//!
//! 判定は、そのマスをかべと仮定して各シマの到達可能マス数を数え、
//! 数字に足りないシマが出るかどうか。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::AnswerModel;
use crate::board::{Board, UNKNOWN_CLUE};
use crate::reasons::ISLAND_MUST_GROW;
use crate::status::Status;

/// `blocked` を塞いだとき、`clue_index` のシマが到達できるマス数(自分を含む)。
fn capacity(
    board: &Board,
    answer: &AnswerModel,
    clue_index: usize,
    blocked: usize,
    other_clues: &[usize],
) -> usize {
    if clue_index == blocked {
        return 0;
    }
    let mut seen = vec![false; board.cell_count()];
    seen[clue_index] = true;
    let mut stack = vec![clue_index];
    let mut count = 0usize;
    while let Some(index) = stack.pop() {
        count += 1;
        for next in board.neighbours(index) {
            if seen[next] || next == blocked || answer.is_black(next) {
                continue;
            }
            // 他の数字マスとその隣は使えない
            if other_clues.contains(&next) {
                continue;
            }
            if board
                .neighbours(next)
                .iter()
                .any(|n| other_clues.contains(n) && !answer.is_white(next))
            {
                continue;
            }
            seen[next] = true;
            stack.push(next);
        }
    }
    count
}

pub fn island_cut(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let clues = board.clue_cells();
    let clue_indices: Vec<usize> = clues.iter().map(|&(i, _)| i).collect();
    let mut result = Status::Stopped;

    for index in 0..board.cell_count() {
        if !answer.answer.is_unknown(index) {
            continue;
        }
        for (i, &(clue_index, size)) in clues.iter().enumerate() {
            if size == UNKNOWN_CLUE {
                continue;
            }
            let others: Vec<usize> = clue_indices
                .iter()
                .enumerate()
                .filter(|&(j, _)| j != i)
                .map(|(_, &c)| c)
                .collect();
            if capacity(board, answer.answer, clue_index, index, &others) < size as usize {
                result = merge_status(result, answer.set_white(index, ISLAND_MUST_GROW));
                if result == Status::Broken {
                    return result;
                }
                break;
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
    fn blocking_the_only_route_is_forbidden() {
        // 1x3、左端が 2 のシマ。中央を塞ぐと 1 マスしか取れない → 中央は白
        let board = Board::new(3, 1, vec![2, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(island_cut(&mut methods), Status::Advanced);
        assert!(answer.is_white(1));
    }

    #[test]
    fn a_cell_with_slack_is_left_alone() {
        // 3x3 の角に 2 のシマ。2 方向に伸びられるのでどちらも確定しない
        let mut clues = vec![NO_CLUE; 9];
        clues[0] = 2;
        let board = Board::new(3, 3, clues).unwrap();
        let mut answer = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(island_cut(&mut methods), Status::Stopped);
    }

    #[test]
    fn respects_existing_walls() {
        // 1x4、左端が 3。(2) が既にかべなら (1) を塞ぐと足りない → (1) は白
        let board = Board::new(4, 1, vec![3, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        island_cut(&mut methods);
        assert!(answer.is_white(1));
    }
}
