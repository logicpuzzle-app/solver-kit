//! 完成解が 4 ルールを満たすかの検証。
//!
//! 手筋ソルバーや探索の伝播とは独立に、完成盤面を素朴に全走査する。

use crate::answer_model::AnswerModel;
use crate::board::Board;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ValidationError {
    Incomplete { index: usize },
    AdjacentBlack { a: usize, b: usize },
    WhiteNotConnected { components: usize },
    RoomClueMismatch {
        room_id: usize,
        want: i32,
        got: i32,
    },
    WhiteCrossesThreeRooms {
        horizontal: bool,
        line: usize,
        start: usize,
        end: usize,
        borders: usize,
    },
}

pub fn validate_solution(board: &Board, answer: &AnswerModel) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    for index in 0..board.cell_count() {
        if answer.is_unknown(index) {
            errors.push(ValidationError::Incomplete { index });
        }
    }
    if !errors.is_empty() {
        return errors;
    }

    // 黒隣接禁。右と下だけを見て同じ組を二重に数えない。
    for y in 0..board.rows {
        for x in 0..board.cols {
            let index = board.index(x, y);
            if !answer.is_black(index) {
                continue;
            }
            for (nx, ny) in [(x + 1, y), (x, y + 1)] {
                if board.in_board(nx, ny) {
                    let next = board.index(nx, ny);
                    if answer.is_black(next) {
                        errors.push(ValidationError::AdjacentBlack { a: index, b: next });
                    }
                }
            }
        }
    }

    // 白全体の連結。黒だけを壁として成分数を数える。
    let mut seen = vec![false; board.cell_count()];
    let mut components = 0;
    for start in 0..board.cell_count() {
        if seen[start] || !answer.is_white(start) {
            continue;
        }
        components += 1;
        seen[start] = true;
        let mut stack = vec![start];
        while let Some(index) = stack.pop() {
            for &next in board.neighbours(index) {
                if !seen[next] && answer.is_white(next) {
                    seen[next] = true;
                    stack.push(next);
                }
            }
        }
    }
    if components > 1 {
        errors.push(ValidationError::WhiteNotConnected { components });
    }

    for (room_id, want) in board.clue_rooms() {
        let got = board
            .room(room_id)
            .cells
            .iter()
            .filter(|&&index| answer.is_black(index))
            .count() as i32;
        if got != want {
            errors.push(ValidationError::RoomClueMismatch {
                room_id,
                want,
                got,
            });
        }
    }

    // 白の極大直線ごとに、その内側の部屋境界を数える。
    for (horizontal, lines) in [(true, board.row_lines()), (false, board.col_lines())] {
        for (line_no, line) in lines.iter().enumerate() {
            let mut at = 0;
            while at < line.cells.len() {
                if !answer.is_white(line.cells[at]) {
                    at += 1;
                    continue;
                }
                let start = at;
                while at + 1 < line.cells.len() && answer.is_white(line.cells[at + 1]) {
                    at += 1;
                }
                let end = at;
                let borders = line.boundaries[start..end]
                    .iter()
                    .filter(|&&border| border)
                    .count();
                if borders >= 2 {
                    errors.push(ValidationError::WhiteCrossesThreeRooms {
                        horizontal,
                        line: line_no,
                        start,
                        end,
                        borders,
                    });
                }
                at += 1;
            }
        }
    }

    errors
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::{AnswerModel, CellState};
    use crate::board::Board;

    fn paint(board: &Board, black: &[usize]) -> AnswerModel {
        let mut answer = AnswerModel::new(board);
        for index in 0..board.cell_count() {
            answer
                .set(
                    index,
                    if black.contains(&index) {
                        CellState::Black
                    } else {
                        CellState::White
                    },
                )
                .unwrap();
        }
        answer
    }

    #[test]
    fn accepts_a_correct_solution() {
        let board = Board::new(2, 1, vec![false], vec![], vec![Some(1)]).unwrap();
        assert!(validate_solution(&board, &paint(&board, &[0])).is_empty());
    }

    #[test]
    fn rejects_adjacent_black_cells() {
        let board = Board::new(2, 1, vec![false], vec![], vec![None]).unwrap();
        assert!(validate_solution(&board, &paint(&board, &[0, 1]))
            .iter()
            .any(|error| matches!(error, ValidationError::AdjacentBlack { .. })));
    }

    #[test]
    fn rejects_disconnected_white_cells() {
        let board = Board::new(3, 1, vec![false, false], vec![], vec![None]).unwrap();
        assert!(validate_solution(&board, &paint(&board, &[1]))
            .iter()
            .any(|error| matches!(error, ValidationError::WhiteNotConnected { .. })));
    }

    #[test]
    fn rejects_a_wrong_room_count() {
        let board = Board::new(1, 1, vec![], vec![], vec![Some(0)]).unwrap();
        assert!(validate_solution(&board, &paint(&board, &[0]))
            .iter()
            .any(|error| matches!(error, ValidationError::RoomClueMismatch { .. })));
    }

    #[test]
    fn rejects_white_across_three_rooms() {
        let board = Board::new(
            3,
            1,
            vec![true, true],
            vec![],
            vec![None, None, None],
        )
        .unwrap();
        assert!(validate_solution(&board, &paint(&board, &[]))
            .iter()
            .any(|error| matches!(error, ValidationError::WhiteCrossesThreeRooms { .. })));
    }
}
