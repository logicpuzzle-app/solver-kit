// 新規手筋: DESIGN_JA.md の three_pair

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::THREE_PAIR;
use crate::solution::validate_solution;
use crate::status::Status;

fn miniature_loop_is_complete_solution(
    answer: &AnswerMethods<'_>,
    perimeter: &[usize],
) -> bool {
    let mut candidate = vec![EdgeState::Cross; answer.board.edge_count()];
    for &edge in perimeter {
        candidate[edge] = EdgeState::Line;
    }
    if candidate
        .iter()
        .zip(answer.answer.edges())
        .any(|(&candidate_state, &current)| {
            current != EdgeState::Unknown && current != candidate_state
        })
    {
        return false;
    }
    validate_solution(answer.board, &candidate).is_empty()
}

pub fn three_pair(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;

    for y in 0..answer.board.rows {
        for x in 0..answer.board.cols.saturating_sub(1) {
            if answer.board.clue(x, y) != 3 || answer.board.clue(x + 1, y) != 3 {
                continue;
            }
            let perimeter = [
                answer.board.h_id(x, y),
                answer.board.h_id(x + 1, y),
                answer.board.h_id(x, y + 1),
                answer.board.h_id(x + 1, y + 1),
                answer.board.v_id(x, y),
                answer.board.v_id(x + 2, y),
            ];
            // 共有辺を使わない長方形でも両端はループの一部なので、
            // 小ループが完成解になれるかに関係なく両端は Line になる。
            for edge in [
                answer.board.v_id(x, y),
                answer.board.v_id(x + 2, y),
            ] {
                result = merge_status(result, answer.set_line(edge, THREE_PAIR));
            }
            if result == Status::Broken {
                return result;
            }

            // 共有辺を使わない場合は2セルだけの閉路になる。その閉路が
            // 盤面全体の完成解になれるときだけ、共有辺は確定できない。
            if miniature_loop_is_complete_solution(answer, &perimeter) {
                continue;
            }
            result = merge_status(
                result,
                answer.set_line(answer.board.v_id(x + 1, y), THREE_PAIR),
            );
            if result == Status::Broken {
                return result;
            }
            // 共有辺が Line になった場合だけ、その両端の次数2から延長を塞げる。
            if y > 0 {
                result = merge_status(
                    result,
                    answer.set_cross(answer.board.v_id(x + 1, y - 1), THREE_PAIR),
                );
            }
            if y + 1 < answer.board.rows {
                result = merge_status(
                    result,
                    answer.set_cross(answer.board.v_id(x + 1, y + 1), THREE_PAIR),
                );
            }
            if result == Status::Broken {
                return result;
            }
        }
    }

    for y in 0..answer.board.rows.saturating_sub(1) {
        for x in 0..answer.board.cols {
            if answer.board.clue(x, y) != 3 || answer.board.clue(x, y + 1) != 3 {
                continue;
            }
            let perimeter = [
                answer.board.v_id(x, y),
                answer.board.v_id(x + 1, y),
                answer.board.v_id(x, y + 1),
                answer.board.v_id(x + 1, y + 1),
                answer.board.h_id(x, y),
                answer.board.h_id(x, y + 2),
            ];
            for edge in [
                answer.board.h_id(x, y),
                answer.board.h_id(x, y + 2),
            ] {
                result = merge_status(result, answer.set_line(edge, THREE_PAIR));
            }
            if result == Status::Broken {
                return result;
            }

            if miniature_loop_is_complete_solution(answer, &perimeter) {
                continue;
            }
            result = merge_status(
                result,
                answer.set_line(answer.board.h_id(x, y + 1), THREE_PAIR),
            );
            if result == Status::Broken {
                return result;
            }
            if x > 0 {
                result = merge_status(
                    result,
                    answer.set_cross(answer.board.h_id(x - 1, y + 1), THREE_PAIR),
                );
            }
            if x + 1 < answer.board.cols {
                result = merge_status(
                    result,
                    answer.set_cross(answer.board.h_id(x + 1, y + 1), THREE_PAIR),
                );
            }
            if result == Status::Broken {
                return result;
            }
        }
    }
    result
}
