use crate::board::{Board, EdgeId};

pub mod cell_exact;
pub mod cell_forced;
pub mod clue_corner_pair;
pub mod connect_line;
pub mod corner_clue;
pub mod inside_outside;
pub mod local_pattern;
pub mod no_small_loop;
pub mod one_blocked_corner;
pub mod parity_line;
pub mod three_diagonal;
pub mod three_incoming;
pub mod three_pair;
pub mod three_zero_adjacent;
pub mod three_zero_diagonal;
pub mod two_blocked_corner;
pub mod vertex_close;
pub mod vertex_dead;
pub mod vertex_extend;
pub mod zero_cell;

#[derive(Clone, Copy)]
pub(crate) enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

pub(crate) const CORNERS: [Corner; 4] = [
    Corner::TopLeft,
    Corner::TopRight,
    Corner::BottomLeft,
    Corner::BottomRight,
];

pub(crate) fn corner_vertex(x: usize, y: usize, corner: Corner) -> (usize, usize) {
    match corner {
        Corner::TopLeft => (x, y),
        Corner::TopRight => (x + 1, y),
        Corner::BottomLeft => (x, y + 1),
        Corner::BottomRight => (x + 1, y + 1),
    }
}

pub(crate) fn corner_cell_edges(
    board: &Board,
    x: usize,
    y: usize,
    corner: Corner,
) -> [EdgeId; 2] {
    match corner {
        Corner::TopLeft => [board.h_id(x, y), board.v_id(x, y)],
        Corner::TopRight => [board.h_id(x, y), board.v_id(x + 1, y)],
        Corner::BottomLeft => [board.h_id(x, y + 1), board.v_id(x, y)],
        Corner::BottomRight => [board.h_id(x, y + 1), board.v_id(x + 1, y)],
    }
}

pub(crate) fn far_cell_edges(
    board: &Board,
    x: usize,
    y: usize,
    corner: Corner,
) -> [EdgeId; 2] {
    match corner {
        Corner::TopLeft => [board.h_id(x, y + 1), board.v_id(x + 1, y)],
        Corner::TopRight => [board.h_id(x, y + 1), board.v_id(x, y)],
        Corner::BottomLeft => [board.h_id(x, y), board.v_id(x + 1, y)],
        Corner::BottomRight => [board.h_id(x, y), board.v_id(x, y)],
    }
}

pub(crate) fn outside_corner_edges(
    board: &Board,
    x: usize,
    y: usize,
    corner: Corner,
) -> Vec<EdgeId> {
    let inside = corner_cell_edges(board, x, y, corner);
    let (vx, vy) = corner_vertex(x, y, corner);
    board
        .vertex_edges(vx, vy)
        .into_iter()
        .filter(|edge| !inside.contains(edge))
        .collect()
}

#[cfg(test)]
mod tests;
