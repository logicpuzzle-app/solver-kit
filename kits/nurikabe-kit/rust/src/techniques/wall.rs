//! かべの連結性(カタログ C)。
//!
//! すべてのかべはひとつながりでなければならない。したがって
//! - かべの塊が 2 つ以上あるとき、ある塊から出られる未確定マスが 1 つなら、そこはかべ
//! - どの塊とも繋がれない塊があれば矛盾
//!
//! 併せて「数字に届かない白マス」も見る。白の連結成分に数字がなく、伸ばせる先が
//! 1 つしかないなら、そこは白(いずれ数字に辿り着く必要があるため)。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::AnswerModel;
use crate::board::Board;
use crate::reasons::{ISLAND_MUST_GROW, WALL_EXTEND};
use crate::status::Status;

/// `want` が真のマスの連結成分と、それぞれに隣接する未確定マスを返す。
fn components(
    board: &Board,
    answer: &AnswerModel,
    want: impl Fn(usize) -> bool,
) -> Vec<(Vec<usize>, Vec<usize>)> {
    let mut seen = vec![false; board.cell_count()];
    let mut out = Vec::new();
    for start in 0..board.cell_count() {
        if seen[start] || !want(start) {
            continue;
        }
        let mut stack = vec![start];
        let mut group = Vec::new();
        let mut frontier = Vec::new();
        seen[start] = true;
        while let Some(index) = stack.pop() {
            group.push(index);
            for next in board.neighbours(index) {
                if want(next) {
                    if !seen[next] {
                        seen[next] = true;
                        stack.push(next);
                    }
                } else if answer.is_unknown(next) && !frontier.contains(&next) {
                    frontier.push(next);
                }
            }
        }
        out.push((group, frontier));
    }
    out
}

pub fn wall(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut result = Status::Stopped;

    let walls = components(board, answer.answer, |i| answer.answer.is_black(i));
    if walls.len() > 1 {
        for (_, frontier) in &walls {
            match frontier.len() {
                // 出口がないのに他の塊と繋がっていない → 矛盾
                0 => return Status::Broken,
                // 出口が 1 つならそこを通るしかない
                1 => {
                    result = merge_status(result, answer.set_black(frontier[0], WALL_EXTEND));
                    if result == Status::Broken {
                        return result;
                    }
                }
                _ => {}
            }
        }
    }

    // 数字を含まない白の塊は、いずれ数字に届かなければならない
    let whites = components(board, answer.answer, |i| answer.answer.is_white(i));
    for (group, frontier) in whites {
        let has_clue = group.iter().any(|&i| {
            let (x, y) = board.position(i);
            board.is_clue(x, y)
        });
        if has_clue {
            continue; // 数字つきの塊は island 手筋が見る
        }
        match frontier.len() {
            0 => return Status::Broken, // 数字に届けない白の塊
            1 => {
                result = merge_status(result, answer.set_white(frontier[0], ISLAND_MUST_GROW));
                if result == Status::Broken {
                    return result;
                }
            }
            _ => {}
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
    fn a_lone_wall_extends_through_its_only_exit() {
        // 1x3: 左端かべ、中央未確定、右端かべ → 2 つの塊。中央を通るしかない
        let board = Board::new(3, 1, vec![NO_CLUE; 3]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        answer.set(2, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(wall(&mut methods), Status::Advanced);
        assert!(answer.is_black(1));
    }

    #[test]
    fn a_single_wall_component_decides_nothing() {
        let board = Board::new(3, 1, vec![NO_CLUE; 3]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(wall(&mut methods), Status::Stopped);
    }

    #[test]
    fn a_sealed_off_wall_component_is_a_contradiction() {
        // 1x3: 左端かべ、中央白、右端かべ → 繋がる余地なし
        let board = Board::new(3, 1, vec![NO_CLUE, 1, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::Black).unwrap();
        answer.set(2, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(wall(&mut methods), Status::Broken);
    }

    #[test]
    fn a_clueless_white_blob_grows_toward_its_only_exit() {
        // 1x3: 左端が数字なしの白、中央未確定、右端に 2
        let board = Board::new(3, 1, vec![NO_CLUE, NO_CLUE, 2]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(0, CellState::White).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(wall(&mut methods), Status::Advanced);
        assert!(answer.is_white(1));
    }
}
