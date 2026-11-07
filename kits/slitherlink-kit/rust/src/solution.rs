use std::collections::VecDeque;

use crate::board::{Board, EdgeId};
use crate::engine::EdgeState;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ValidationError {
    EdgeCount {
        expected: usize,
        actual: usize,
    },
    UnknownEdge {
        edge: EdgeId,
    },
    Clue {
        x: usize,
        y: usize,
        expected: usize,
        actual: usize,
    },
    VertexDegree {
        x: usize,
        y: usize,
        degree: usize,
    },
    NoLoop,
    MultipleLoops,
}

pub fn validate_solution(board: &Board, edges: &[EdgeState]) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    if edges.len() != board.edge_count() {
        errors.push(ValidationError::EdgeCount {
            expected: board.edge_count(),
            actual: edges.len(),
        });
        return errors;
    }
    for (edge, &state) in edges.iter().enumerate() {
        if state == EdgeState::Unknown {
            errors.push(ValidationError::UnknownEdge { edge });
        }
    }
    for y in 0..board.rows {
        for x in 0..board.cols {
            let clue = board.clue(x, y);
            if clue < 0 {
                continue;
            }
            let actual = board
                .cell_edges(x, y)
                .into_iter()
                .filter(|&edge| edges[edge] == EdgeState::Line)
                .count();
            if actual != clue as usize {
                errors.push(ValidationError::Clue {
                    x,
                    y,
                    expected: clue as usize,
                    actual,
                });
            }
        }
    }

    let mut line_vertices = vec![false; board.vertex_count()];
    for vertex in 0..board.vertex_count() {
        let position = board.vertex_position(vertex);
        let degree = board
            .vertex_edges(position.x, position.y)
            .into_iter()
            .filter(|&edge| edges[edge] == EdgeState::Line)
            .count();
        if degree > 0 {
            line_vertices[vertex] = true;
        }
        if degree != 0 && degree != 2 {
            errors.push(ValidationError::VertexDegree {
                x: position.x,
                y: position.y,
                degree,
            });
        }
    }

    let Some(start) = line_vertices.iter().position(|&used| used) else {
        errors.push(ValidationError::NoLoop);
        return errors;
    };
    let mut reached = vec![false; board.vertex_count()];
    let mut queue = VecDeque::from([start]);
    reached[start] = true;
    while let Some(vertex) = queue.pop_front() {
        let position = board.vertex_position(vertex);
        for edge in board.vertex_edges(position.x, position.y) {
            if edges[edge] != EdgeState::Line {
                continue;
            }
            let (left, right) = board.edge_endpoints(edge);
            let next = if left == vertex { right } else { left };
            if !reached[next] {
                reached[next] = true;
                queue.push_back(next);
            }
        }
    }
    if line_vertices
        .iter()
        .zip(&reached)
        .any(|(&used, &visited)| used && !visited)
    {
        errors.push(ValidationError::MultipleLoops);
    }
    errors
}

pub fn describe_validation_error(error: &ValidationError) -> String {
    match error {
        ValidationError::EdgeCount { expected, actual } => {
            format!("辺の本数が不正です（期待 {expected}、実際 {actual}）")
        }
        ValidationError::UnknownEdge { edge } => format!("辺 {edge} が未確定です"),
        ValidationError::Clue {
            x,
            y,
            expected,
            actual,
        } => format!(
            "セル ({},{}) は数字 {} に対して線が {} 本です",
            x + 1,
            y + 1,
            expected,
            actual
        ),
        ValidationError::VertexDegree { x, y, degree } => format!(
            "頂点 ({},{}) の次数が {} です",
            x + 1,
            y + 1,
            degree
        ),
        ValidationError::NoLoop => "線が一本もありません".into(),
        ValidationError::MultipleLoops => "線が複数の閉路に分かれています".into(),
    }
}
