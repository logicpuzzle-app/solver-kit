//! 数字マスの近くだけで決まる手筋(カタログ A の入口)。
//!
//! - 1 の島: 数字 1 の隣接 4 マスはかべ
//! - 斜め数字: 斜めに並ぶ 2 つの数字の共通隣接はかべ
//! - 1マス飛ばし: タテヨコに 1 マス空けて並ぶ 2 数字の間はかべ
//!
//! いずれも「2 つの数字が同じシマに入ってはいけない」という同じ理屈だが、
//! 人が見る形が違うので難易度の説明としては別の名前で記録する。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::board::UNKNOWN_CLUE;
use crate::reasons::{CLUE_NEIGHBOUR_BLACK, DIAGONAL_CLUES, GAP_BETWEEN_CLUES};
use crate::status::Status;

pub fn clue_neighbours(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let mut result = Status::Stopped;

    for (index, clue) in board.clue_cells() {
        let (x, y) = board.position(index);

        // 1 の島は自分だけで完結するので、周り 4 マスはかべ。
        if clue == 1 {
            let neighbours = board.neighbours(index);
            result = merge_status(
                result,
                answer.set_many(
                    neighbours,
                    crate::answer_model::CellState::Black,
                    CLUE_NEIGHBOUR_BLACK,
                ),
            );
            if result == Status::Broken {
                return result;
            }
        }

        // 斜めに数字がある場合、共通の隣接 2 マスはどちらの島にも入れない。
        for (dx, dy) in [(1, -1), (1, 1)] {
            let (nx, ny) = (x + dx, y + dy);
            if !board.in_board(nx, ny) || !board.is_clue(nx, ny) {
                continue;
            }
            for (cx, cy) in [(x + dx, y), (x, y + dy)] {
                if board.in_board(cx, cy) && !board.is_clue(cx, cy) {
                    result = merge_status(result, answer.set_black(board.index(cx, cy), DIAGONAL_CLUES));
                    if result == Status::Broken {
                        return result;
                    }
                }
            }
        }

        // タテヨコに 1 マス空けて数字がある場合、間のマスはかべ。
        for (dx, dy) in [(2, 0), (0, 2)] {
            let (nx, ny) = (x + dx, y + dy);
            if !board.in_board(nx, ny) || !board.is_clue(nx, ny) {
                continue;
            }
            let (mx, my) = (x + dx / 2, y + dy / 2);
            if !board.is_clue(mx, my) {
                result = merge_status(result, answer.set_black(board.index(mx, my), GAP_BETWEEN_CLUES));
                if result == Status::Broken {
                    return result;
                }
            }
        }

        let _ = UNKNOWN_CLUE; // `?` でも上の推論はすべて成り立つ
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
        clue_neighbours(&mut methods);
        answer
    }

    #[test]
    fn a_one_is_surrounded_by_wall() {
        // 3x3 の中央に 1
        let mut clues = vec![NO_CLUE; 9];
        clues[4] = 1;
        let board = Board::new(3, 3, clues).unwrap();
        let answer = apply(&board);
        for i in [1, 3, 5, 7] {
            assert!(answer.is_black(i), "マス {i} はかべのはず");
        }
        for i in [0, 2, 6, 8] {
            assert!(answer.is_unknown(i), "斜めは未確定のはず");
        }
    }

    #[test]
    fn diagonal_clues_block_the_shared_neighbours() {
        // (0,0)=2 と (1,1)=2 が斜め → (1,0) と (0,1) がかべ
        let board = Board::new(2, 2, vec![2, NO_CLUE, NO_CLUE, 2]).unwrap();
        let answer = apply(&board);
        assert!(answer.is_black(1));
        assert!(answer.is_black(2));
    }

    #[test]
    fn clues_one_apart_block_the_gap() {
        let board = Board::new(3, 1, vec![2, NO_CLUE, 2]).unwrap();
        let answer = apply(&board);
        assert!(answer.is_black(1));
    }

    #[test]
    fn adjacent_clues_are_left_alone() {
        // 隣接する数字は「間のマス」を持たないので、この手筋は何もしない
        let board = Board::new(2, 1, vec![2, 2]).unwrap();
        let answer = apply(&board);
        assert!(answer.is_white(0) && answer.is_white(1));
    }
}
