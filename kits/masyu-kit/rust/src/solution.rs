//! 完成解のルール検証。ソルバーと独立に実装する
//! (片方のバグがもう片方に伝染しないため)。
//!
//! 未定の辺は「線なし」とみなして検証する。

use crate::answer_model::AnswerModel;
use crate::board::{opposite, Board, BLACK, WHITE, DIRS, NO_CELL, NO_EDGE};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ValidationError {
    /// 線が 1 本もない。
    NoLine,
    /// 線の端点(次数 1)や分岐(次数 3 以上)がある。
    BadDegree { index: usize, degree: u8 },
    /// 丸の上を線が通っていない。
    PearlUnvisited { index: usize },
    /// 白丸の上で線が曲がっている。
    WhiteCurve { index: usize },
    /// 白丸の両隣がどちらも直進している。
    WhiteStraightNeighbours { index: usize },
    /// 黒丸の上で線が直進している。
    BlackStraight { index: usize },
    /// 黒丸の隣で線が曲がっている。
    BlackCurveNeighbour { index: usize, dir: usize },
    /// ループが 2 つ以上ある。
    MultipleLoops,
}

/// そのマスから dir 方向へ線が出ているか。盤外は「出ていない」。
fn line_towards(board: &Board, answer: &AnswerModel, cell: usize, dir: usize) -> bool {
    let edge = board.incident(cell)[dir];
    edge != NO_EDGE && answer.is_line(edge)
}

/// そのマスを線がまっすぐ通り抜けているか(dir と反対方向の両方に線)。
fn straight_through(board: &Board, answer: &AnswerModel, cell: usize, dir: usize) -> bool {
    line_towards(board, answer, cell, dir) && line_towards(board, answer, cell, opposite(dir))
}

pub fn validate_solution(board: &Board, answer: &AnswerModel) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    let degree: Vec<u8> = (0..board.cell_count())
        .map(|i| {
            DIRS.iter()
                .enumerate()
                .filter(|&(dir, _)| line_towards(board, answer, i, dir))
                .count() as u8
        })
        .collect();

    if degree.iter().all(|&d| d == 0) {
        errors.push(ValidationError::NoLine);
        return errors;
    }
    for (i, &d) in degree.iter().enumerate() {
        if d != 0 && d != 2 {
            errors.push(ValidationError::BadDegree { index: i, degree: d });
        }
    }

    for &(i, pearl) in board.pearls() {
        if degree[i] != 2 {
            if degree[i] == 0 {
                errors.push(ValidationError::PearlUnvisited { index: i });
            }
            continue;
        }
        let dirs: Vec<usize> = (0..4)
            .filter(|&dir| line_towards(board, answer, i, dir))
            .collect();
        let straight = dirs[1] == opposite(dirs[0]);
        if pearl == WHITE {
            if !straight {
                errors.push(ValidationError::WhiteCurve { index: i });
                continue;
            }
            let both_straight = dirs.iter().all(|&dir| {
                let n = board.neighbour(i, dir);
                n != NO_CELL && straight_through(board, answer, n, dir)
            });
            if both_straight {
                errors.push(ValidationError::WhiteStraightNeighbours { index: i });
            }
        } else if pearl == BLACK {
            if straight {
                errors.push(ValidationError::BlackStraight { index: i });
                continue;
            }
            for &dir in &dirs {
                let n = board.neighbour(i, dir);
                if n == NO_CELL || !line_towards(board, answer, n, dir) {
                    errors.push(ValidationError::BlackCurveNeighbour { index: i, dir });
                }
            }
        }
    }

    if !errors.is_empty() {
        return errors;
    }

    // 次数が全部 0/2 なので、1 マスから辿って全部の線マスに届けば単一ループ。
    let start = degree.iter().position(|&d| d == 2).unwrap();
    let line_cells = degree.iter().filter(|&&d| d == 2).count();
    let mut seen = vec![false; board.cell_count()];
    let mut stack = vec![start];
    seen[start] = true;
    let mut reached = 0;
    while let Some(cell) = stack.pop() {
        reached += 1;
        for dir in 0..4 {
            if line_towards(board, answer, cell, dir) {
                let n = board.neighbour(cell, dir);
                if !seen[n] {
                    seen[n] = true;
                    stack.push(n);
                }
            }
        }
    }
    if reached != line_cells {
        errors.push(ValidationError::MultipleLoops);
    }

    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::EdgeState;

    /// 3x3、中央上に白丸。外周をぐるっと回る解。
    fn ring_answer(cells: Vec<i32>) -> (Board, AnswerModel) {
        let board = Board::new(3, 3, cells).unwrap();
        let mut answer = AnswerModel::new(&board);
        // 外周: 水平 0,1(上辺) 4,5(下辺)、垂直 6,8(左右上段) 9,11(左右下段)。
        for e in [0, 1, 4, 5, 6, 8, 9, 11] {
            answer.set(&board, e, EdgeState::Line).unwrap();
        }
        (board, answer)
    }

    #[test]
    fn a_plain_ring_is_valid() {
        let (board, answer) = ring_answer(vec![0; 9]);
        assert_eq!(validate_solution(&board, &answer), vec![]);
    }

    #[test]
    fn white_pearl_on_the_ring_edge_is_satisfied() {
        // 上辺中央(マス1)の白丸: 直進し、両隣(角)で曲がる。
        let (board, answer) = ring_answer(vec![0, WHITE, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(validate_solution(&board, &answer), vec![]);
    }

    #[test]
    fn black_pearl_on_a_corner_of_a_3x3_ring_is_valid() {
        // 角(マス0)の黒丸: ここで曲がり、両腕とも 2 マス直進してから曲がる。
        let (board, answer) = ring_answer(vec![BLACK, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(validate_solution(&board, &answer), vec![]);
    }

    #[test]
    fn black_pearl_where_the_line_goes_straight_fails() {
        // 上辺中央(マス1)の黒丸: 線が直進してしまっている。
        let (board, answer) = ring_answer(vec![0, BLACK, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(
            validate_solution(&board, &answer),
            vec![ValidationError::BlackStraight { index: 1 }]
        );
    }

    #[test]
    fn white_pearl_with_straight_neighbours_fails() {
        // 5x3 の外周リングで、上辺中央(マス2)の白丸は両隣とも直進 → 違反。
        let board = Board::new(5, 3, vec![0, 0, WHITE, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
            .unwrap();
        let mut answer = AnswerModel::new(&board);
        // 水平辺: y0 は 0..4、y2 は 8..12。垂直辺: 左 12,17、右 16,21。
        for e in [0, 1, 2, 3, 8, 9, 10, 11, 12, 17, 16, 21] {
            answer.set(&board, e, EdgeState::Line).unwrap();
        }
        assert_eq!(
            validate_solution(&board, &answer),
            vec![ValidationError::WhiteStraightNeighbours { index: 2 }]
        );
    }

    #[test]
    fn unvisited_pearl_is_reported() {
        let (board, answer) = ring_answer(vec![0, 0, 0, 0, WHITE, 0, 0, 0, 0]);
        assert_eq!(
            validate_solution(&board, &answer),
            vec![ValidationError::PearlUnvisited { index: 4 }]
        );
    }
}
