// 新規手筋: DESIGN_JA.md の clue_corner_pair

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::{
    ONE_BLOCKED_CORNER, THREE_INCOMING, TWO_BLOCKED_CORNER,
};
use crate::status::Status;
use crate::techniques::{
    corner_cell_edges, outside_corner_edges, CORNERS,
};

fn reason(clue: i8) -> &'static str {
    match clue {
        1 => ONE_BLOCKED_CORNER,
        2 => TWO_BLOCKED_CORNER,
        3 => THREE_INCOMING,
        _ => unreachable!("1から3だけを列挙する"),
    }
}

pub fn clue_corner_pair(answer: &mut AnswerMethods<'_>) -> Status {
    let mut result = Status::Stopped;
    for y in 0..answer.board.rows {
        for x in 0..answer.board.cols {
            let clue = answer.board.clue(x, y);
            if !(1..=3).contains(&clue) {
                continue;
            }
            let cell_edges = answer.board.cell_edges(x, y);
            for corner in CORNERS {
                let near = corner_cell_edges(answer.board, x, y, corner);
                let outside = outside_corner_edges(answer.board, x, y, corner);
                let mut local = cell_edges.to_vec();
                for edge in &outside {
                    if !local.contains(edge) {
                        local.push(*edge);
                    }
                }

                let mut possibilities = Vec::new();
                for bits in 0usize..(1usize << local.len()) {
                    let states: Vec<_> = (0..local.len())
                        .map(|index| {
                            if bits & (1 << index) == 0 {
                                EdgeState::Cross
                            } else {
                                EdgeState::Line
                            }
                        })
                        .collect();
                    if local
                        .iter()
                        .zip(&states)
                        .any(|(&edge, &state)| {
                            let current = answer.edge(edge);
                            current != EdgeState::Unknown && current != state
                        })
                    {
                        continue;
                    }
                    let cell_line_count = cell_edges
                        .iter()
                        .filter(|&&edge| {
                            let index = local
                                .iter()
                                .position(|&candidate| candidate == edge)
                                .expect("セル辺は local に含まれる");
                            states[index] == EdgeState::Line
                        })
                        .count();
                    if cell_line_count != clue as usize {
                        continue;
                    }
                    let vertex_degree = near
                        .iter()
                        .chain(&outside)
                        .filter(|&&edge| {
                            let index = local
                                .iter()
                                .position(|&candidate| candidate == edge)
                                .expect("頂点辺は local に含まれる");
                            states[index] == EdgeState::Line
                        })
                        .count();
                    if vertex_degree == 0 || vertex_degree == 2 {
                        possibilities.push(states);
                    }
                }
                if possibilities.is_empty() {
                    return Status::Broken;
                }
                // 数字制約とこの隅の次数制約だけを満たす全場合で一致する辺のみ確定する。
                for (index, &edge) in local.iter().enumerate() {
                    let state = possibilities[0][index];
                    if possibilities
                        .iter()
                        .all(|possibility| possibility[index] == state)
                    {
                        result = merge_status(
                            result,
                            answer.set_edge(edge, state, reason(clue)),
                        );
                    }
                }
                if result == Status::Broken {
                    return result;
                }
            }
        }
    }
    result
}
