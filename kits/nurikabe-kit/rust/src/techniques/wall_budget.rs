//! かべの連結費用(大域手筋)。`wall_cut` の予算つき版。
//!
//! かべの総数は `全マス − 数字の和` で決まっている。残りの本数を B とする。
//! かべは最後にひとつながりになるので、いま離れているかべの塊どうしを結ぶには
//! **その間に挟まる未確定マスを白にできない**。塊 i と塊 j を結ぶのに最低 d(i,j)
//! マス要るなら、`max d(i,j) ≤ B` でなければならない。
//!
//! - `max d(i,j) > B` なら矛盾
//! - あるマスを白にすると `max d(i,j) > B` になるなら、そのマスはかべ
//!
//! `wall_cut` は「白にすると *もう繋がらない*」しか見ておらず、
//! 「遠回りはできるが予算が足りない」を捉えられない。そこを埋める。
//!
//! 距離は 0-1 BFS で測る。既にかべのマスは 0、未確定のマスは 1
//! (新しくかべにする必要があるので)。白のマスは通れない。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::AnswerModel;
use crate::board::{Board, UNKNOWN_CLUE};
use crate::reasons::WALL_BUDGET;
use crate::status::Status;
use std::collections::VecDeque;

/// `from` の塊から各マスまで、新しくかべにする必要のあるマス数。
/// `blocked` のマスは白とみなして通らない。
fn costs(
    board: &Board,
    answer: &AnswerModel,
    from: &[usize],
    blocked: Option<usize>,
) -> Vec<i32> {
    let count = board.cell_count();
    let mut dist = vec![i32::MAX; count];
    let mut queue = VecDeque::new();
    for &index in from {
        dist[index] = 0;
        queue.push_front(index);
    }
    while let Some(index) = queue.pop_front() {
        for n in board.neighbours(index) {
            if answer.is_white(n) || Some(n) == blocked {
                continue;
            }
            let step = if answer.is_black(n) { 0 } else { 1 };
            if dist[index] + step < dist[n] {
                dist[n] = dist[index] + step;
                // 0-1 BFS: 費用 0 は前に、1 は後ろに
                if step == 0 {
                    queue.push_front(n);
                } else {
                    queue.push_back(n);
                }
            }
        }
    }
    dist
}

/// 塊どうしを結ぶのに最低いくつ要るか(いちばん遠い組)。届かない組があれば None。
fn worst_link(
    board: &Board,
    answer: &AnswerModel,
    groups: &[Vec<usize>],
    blocked: Option<usize>,
) -> Option<i32> {
    let mut worst = 0;
    for (i, group) in groups.iter().enumerate() {
        if group.iter().any(|&index| Some(index) == blocked) {
            return None; // かべのマスを白にはできない
        }
        let dist = costs(board, answer, group, blocked);
        for other in groups.iter().skip(i + 1) {
            let best = other.iter().map(|&index| dist[index]).min().unwrap_or(i32::MAX);
            if best == i32::MAX {
                return None; // もう繋がらない
            }
            worst = worst.max(best);
        }
    }
    Some(worst)
}

pub fn wall_budget(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let count = board.cell_count();
    let clues = board.clue_cells();
    if clues.iter().any(|&(_, size)| size == UNKNOWN_CLUE || size <= 0) {
        return Status::Stopped; // 総数が決まらない
    }
    let white_total: i32 = clues.iter().map(|&(_, size)| size).sum();
    let black_total = count as i32 - white_total;
    let black_now = (0..count).filter(|&i| answer.answer.is_black(i)).count() as i32;
    let budget = black_total - black_now;
    if budget < 0 {
        return Status::Broken;
    }

    // かべの塊
    let mut seen = vec![false; count];
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for start in 0..count {
        if !answer.answer.is_black(start) || seen[start] {
            continue;
        }
        let mut group = Vec::new();
        let mut stack = vec![start];
        seen[start] = true;
        while let Some(index) = stack.pop() {
            group.push(index);
            for n in board.neighbours(index) {
                if !seen[n] && answer.answer.is_black(n) {
                    seen[n] = true;
                    stack.push(n);
                }
            }
        }
        groups.push(group);
    }
    if groups.len() < 2 {
        return Status::Stopped; // 結ぶ相手がいない
    }

    match worst_link(board, answer.answer, &groups, None) {
        None => return Status::Broken,
        Some(worst) if worst > budget => return Status::Broken,
        Some(_) => {}
    }

    let mut result = Status::Stopped;
    for target in 0..count {
        if !answer.answer.is_unknown(target) {
            continue;
        }
        let over = match worst_link(board, answer.answer, &groups, Some(target)) {
            None => true,
            // 自分を白にした時点で予算は変わらないが、遠回りの費用が増える
            Some(worst) => worst > budget,
        };
        if over {
            result = merge_status(result, answer.set_black(target, WALL_BUDGET));
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
    fn a_detour_that_costs_more_than_the_budget_forces_the_short_way() {
        // 3x3、中央の列で上下のかべを結ぶ。数字 5 なのでかべは 4 マス、
        // うち 2 マスは置いてあるので残り 2。
        //   #  .  .
        //   .  5  .
        //   #  .  .
        // 左上と左下のかべを結ぶには (1,0) を通れば 1 マス。
        // (1,0) を白にすると遠回りは 5 のマスを踏むので不可能 → (1,0) はかべ。
        let mut clues = vec![NO_CLUE; 9];
        clues[4] = 5;
        let board = Board::new(3, 3, clues).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        answer.set(6, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(wall_budget(&mut methods), Status::Advanced);
        assert!(answer.is_black(3));
    }

    #[test]
    fn one_wall_group_decides_nothing() {
        let board = Board::new(3, 3, vec![NO_CLUE; 9]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(wall_budget(&mut methods), Status::Stopped);
    }
}
