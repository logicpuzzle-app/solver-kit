//! 部屋の黒配置の全列挙(段階 2)。
//!
//! 数字のある部屋について、いま確定しているマスと矛盾しない置き方を全部並べ、
//! どの置き方でも同じになるマスを確定させる。飛び石定理・腹の白・重隅定理・起爆などの
//! 「部屋単体で決まる」手筋は、名前ごとに実装しなくてもすべてここから導出される。
//!
//! 置き方は部屋の中の黒隣接・確定マスとの整合に加えて、**盤面全体の即時矛盾**でも
//! 篩う: 白の将来連結が壊れる置き方(砲台・天地開闢がここから出る)と、
//! 黒の置けなくなった 3 連続禁の窓ができる置き方は数えない。
//! どの篩も真の解を落とさないので、共通部分の確定は健全。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::CellState;
use crate::board::Board;
use crate::reasons::{ROOM_ALL_BLACK, ROOM_ALL_WHITE};
use crate::status::Status;

/// 置き方がこれを超える部屋は諦める。
///
/// 実問題の数字部屋は大半が 6 マス以下で、超えるのは広い部屋だけ。広い部屋の
/// 置き方は共通部分がほとんど空になるので、数え続けても確定が出ない。
const MAX_PATTERNS: usize = 96;

pub fn room_patterns(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut result = Status::Stopped;
    for (room_id, want) in board.clue_rooms() {
        let cells = &board.room(room_id).cells;
        let black = cells
            .iter()
            .filter(|&&index| answer.answer.is_black(index))
            .count() as i32;
        let unknown: Vec<usize> = cells
            .iter()
            .copied()
            .filter(|&index| answer.answer.is_unknown(index))
            .collect();
        if unknown.is_empty() {
            continue;
        }
        let need = want - black;
        if need < 0 || need > unknown.len() as i32 {
            return Status::Broken;
        }

        // 未確定マスごとに「黒にできない」(確定黒の隣)を先に引いておく。
        let blocked: Vec<bool> = unknown
            .iter()
            .map(|&index| {
                board
                    .neighbours(index)
                    .iter()
                    .any(|&next| answer.answer.is_black(next))
            })
            .collect();

        let mut patterns: Vec<Vec<usize>> = Vec::new();
        let mut chosen: Vec<usize> = Vec::new();
        if !enumerate(
            board,
            &unknown,
            &blocked,
            need as usize,
            0,
            &mut chosen,
            &mut patterns,
        ) {
            continue; // 打ち切り。確定は出さない
        }

        // 置き方を盤面全体の即時矛盾で篩う。
        let mut states: Vec<Cell> = (0..board.cell_count())
            .map(|index| {
                if answer.answer.is_black(index) {
                    Cell::Black
                } else if answer.answer.is_white(index) {
                    Cell::White
                } else {
                    Cell::Unknown
                }
            })
            .collect();
        patterns.retain(|pattern| {
            for &index in &unknown {
                states[index] = if pattern.contains(&index) {
                    Cell::Black
                } else {
                    Cell::White
                };
            }
            let ok = whites_can_connect(board, &states) && !breaks_a_line(board, &states);
            for &index in &unknown {
                states[index] = Cell::Unknown;
            }
            ok
        });
        if patterns.is_empty() {
            return Status::Broken;
        }

        for &index in &unknown {
            let black_count = patterns
                .iter()
                .filter(|pattern| pattern.contains(&index))
                .count();
            let fill = if black_count == patterns.len() {
                Some((CellState::Black, ROOM_ALL_BLACK))
            } else if black_count == 0 {
                Some((CellState::White, ROOM_ALL_WHITE))
            } else {
                None
            };
            if let Some((state, reason)) = fill {
                result = merge_status(result, answer.set(index, state, reason));
                if result == Status::Broken {
                    return result;
                }
            }
        }
    }
    result
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Cell {
    Unknown,
    Black,
    White,
}

/// 白(確定+置き方で白になったマス)が、黒以外のマスを通って 1 つにつながれるか。
fn whites_can_connect(board: &Board, states: &[Cell]) -> bool {
    let Some(start) = (0..states.len()).find(|&index| states[index] == Cell::White) else {
        return true;
    };
    let mut seen = vec![false; states.len()];
    seen[start] = true;
    let mut stack = vec![start];
    while let Some(index) = stack.pop() {
        for &next in board.neighbours(index) {
            if !seen[next] && states[next] != Cell::Black {
                seen[next] = true;
                stack.push(next);
            }
        }
    }
    (0..states.len()).all(|index| states[index] != Cell::White || seen[index])
}

/// 黒の置けなくなった 3 連続禁の窓(隣り合う境界 2 本の最小窓が全部白)があるか。
fn breaks_a_line(board: &Board, states: &[Cell]) -> bool {
    for line in board.row_lines().iter().chain(board.col_lines()) {
        let mut previous: Option<usize> = None;
        for (at, &is_boundary) in line.boundaries.iter().enumerate() {
            if !is_boundary {
                continue;
            }
            if let Some(start) = previous {
                if line.cells[start..=at + 1]
                    .iter()
                    .all(|&index| states[index] == Cell::White)
                {
                    return true;
                }
            }
            previous = Some(at);
        }
    }
    false
}

/// `unknown[from..]` から黒を `need` 個選ぶ。
/// 置き方が [`MAX_PATTERNS`] を超えたら偽を返して部屋ごと打ち切る。
fn enumerate(
    board: &Board,
    unknown: &[usize],
    blocked: &[bool],
    need: usize,
    from: usize,
    chosen: &mut Vec<usize>,
    patterns: &mut Vec<Vec<usize>>,
) -> bool {
    if need == 0 {
        if patterns.len() >= MAX_PATTERNS {
            return false;
        }
        patterns.push(chosen.clone());
        return true;
    }
    if unknown.len() - from < need {
        return true; // この枝には置き方がないだけで、打ち切りではない
    }
    for at in from..unknown.len() {
        if blocked[at] {
            continue;
        }
        let index = unknown[at];
        if chosen
            .iter()
            .any(|&done| board.neighbours(index).contains(&done))
        {
            continue;
        }
        chosen.push(index);
        let ok = enumerate(board, unknown, blocked, need - 1, at + 1, chosen, patterns);
        chosen.pop();
        if !ok {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::AnswerModel;
    use crate::board::Board;

    /// 2 in 1×3(飛び石定理)。黒白黒に一意確定する。
    #[test]
    fn stepping_stone_room_is_forced()  {
        let board = Board::new(3, 1, vec![false, false], vec![], vec![Some(2)]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(room_patterns(&mut methods), Status::Advanced);
        assert!(model.is_black(0) && model.is_white(1) && model.is_black(2));
    }

    /// 天地開闢: 辺に長辺を接した 3 in 2×3 は、市松 2 通りの片方が
    /// 「上辺中央の白が孤立する」ので消え、部屋が一意確定する。
    #[test]
    fn heaven_and_earth_room_is_forced() {
        // 5×3。上辺中央に 3 in 2×3(x=1..3, y=0..1)、残りは 1 部屋。
        let vertical = vec![
            true, false, false, true, // y=0
            true, false, false, true, // y=1
            false, false, false, false, // y=2
        ];
        let horizontal = vec![
            false, false, false, false, false, // y0-y1
            false, true, true, true, false, // y1-y2: 部屋の下辺
        ];
        let board = Board::new(5, 3, vertical, horizontal, vec![None, Some(3)]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(room_patterns(&mut methods), Status::Advanced);
        assert!(model.is_black(board.index(2, 0)));
        assert!(model.is_black(board.index(1, 1)) && model.is_black(board.index(3, 1)));
        assert!(model.is_white(board.index(1, 0)) && model.is_white(board.index(3, 0)));
        assert!(model.is_white(board.index(2, 1)));
    }

    /// 外の確定黒に隣接する置き方は数えない。
    #[test]
    fn respects_black_neighbours_outside_the_room() {
        // 左 1 マスが別部屋で黒確定。右 2 マスの部屋は 1 in 1×2。
        let board = Board::new(3, 1, vec![true, false], vec![], vec![None, Some(1)]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(0, CellState::Black).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(room_patterns(&mut methods), Status::Advanced);
        assert!(model.is_white(1) && model.is_black(2));
    }

    /// 砲台: 角の 2 in 2×2 は、角を切り離す置き方が分断禁で消えて一意になる。
    #[test]
    fn corner_two_by_two_room_is_forced() {
        // 4×4。左上の 2×2 が数字 2 の部屋、残りが 1 部屋。
        let vertical = vec![
            false, true, false, // y=0: x1-x2 の間に境界
            false, true, false, // y=1
            false, false, false, // y=2
            false, false, false, // y=3
        ];
        let horizontal = vec![
            false, false, false, false, // y0-y1
            true, true, false, false, // y1-y2: 部屋の下辺
            false, false, false, false, // y2-y3
        ];
        let board = Board::new(4, 4, vertical, horizontal, vec![Some(2), None]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(room_patterns(&mut methods), Status::Advanced);
        // ナナメのもう一方((1,0),(0,1) 黒)は角 (0,0) の白を切り離すので消える。
        assert!(model.is_black(board.index(0, 0)) && model.is_black(board.index(1, 1)));
        assert!(model.is_white(board.index(1, 0)) && model.is_white(board.index(0, 1)));
    }

    /// 置けない数字は矛盾。
    #[test]
    fn an_impossible_room_is_broken() {
        // 2 in 1×2 は黒隣接禁で置けない。
        let board = Board::new(2, 1, vec![false], vec![], vec![Some(2)]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(room_patterns(&mut methods), Status::Broken);
    }
}
