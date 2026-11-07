// 移植元: SlitherSolver.Field.finalSolve（空ループ検査）を含み、
// 単一閉路ルールから小ループを事前に除外する形へ細分化した。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::NO_SMALL_LOOP;
use crate::solution::validate_solution;
use crate::status::Status;

fn completed_with(
    answer: &AnswerMethods<'_>,
    additional_line: Option<usize>,
) -> bool {
    let mut candidate = answer.answer.edges().to_vec();
    for (edge, state) in candidate.iter_mut().enumerate() {
        if Some(edge) == additional_line {
            *state = EdgeState::Line;
        } else if *state == EdgeState::Unknown {
            *state = EdgeState::Cross;
        }
    }
    validate_solution(answer.board, &candidate).is_empty()
}

pub fn no_small_loop(answer: &mut AnswerMethods<'_>) -> Status {
    if answer
        .answer
        .edges()
        .iter()
        .all(|&state| state == EdgeState::Cross)
    {
        // sdvx finalSolve と同じく、線が一本も置けない状態は解ではない。
        return Status::Broken;
    }
    if answer.answer.cycles() > 1 {
        return Status::Broken;
    }
    if answer.answer.cycles() == 1 {
        if !completed_with(answer, None) {
            return Status::Broken;
        }
        // 完成した閉路の外へさらに線を置くと複数閉路になる。
        let unknown: Vec<_> = answer
            .answer
            .edges()
            .iter()
            .enumerate()
            .filter_map(|(edge, &state)| {
                (state == EdgeState::Unknown).then_some(edge)
            })
            .collect();
        return answer.set_many(unknown, EdgeState::Cross, NO_SMALL_LOOP);
    }

    let unknown: Vec<_> = answer
        .answer
        .edges()
        .iter()
        .enumerate()
        .filter_map(|(edge, &state)| {
            (state == EdgeState::Unknown).then_some(edge)
        })
        .collect();
    let mut result = Status::Stopped;
    for edge in unknown {
        if answer.answer.endpoints_connected(answer.board, edge)
            && !completed_with(answer, Some(edge))
        {
            // 同じLine成分の端同士を結ぶ辺は閉路を作る。その閉路だけで
            // 全数字を満たす完成解にならない限り、小ループなのでCross。
            result =
                merge_status(result, answer.set_cross(edge, NO_SMALL_LOOP));
            if result == Status::Broken {
                return result;
            }
        }
    }
    result
}
