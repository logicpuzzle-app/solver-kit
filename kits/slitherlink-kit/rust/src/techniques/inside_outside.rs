// 新規手筋: DESIGN_JA.md の inside_outside

use crate::answer_methods::AnswerMethods;
use crate::board::Board;
use crate::engine::EdgeState;
use crate::parity_union_find::{Parity, RollbackParityUnionFind};
use crate::reasons::INSIDE_OUTSIDE;
use crate::status::Status;

fn edge_cells(board: &Board, edge: usize) -> (usize, usize) {
    let outside = board.cols * board.rows;
    if edge < board.horizontal_edge_count() {
        let x = edge % board.cols;
        let y = edge / board.cols;
        let above = if y == 0 {
            outside
        } else {
            board.cell_index(x, y - 1)
        };
        let below = if y == board.rows {
            outside
        } else {
            board.cell_index(x, y)
        };
        (above, below)
    } else {
        let offset = edge - board.horizontal_edge_count();
        let x = offset % (board.cols + 1);
        let y = offset / (board.cols + 1);
        let left = if x == 0 {
            outside
        } else {
            board.cell_index(x - 1, y)
        };
        let right = if x == board.cols {
            outside
        } else {
            board.cell_index(x, y)
        };
        (left, right)
    }
}

fn vertex_cells(
    board: &Board,
    x: usize,
    y: usize,
) -> (usize, usize, usize, usize) {
    let outside = board.cols * board.rows;
    let top_left = if x > 0 && y > 0 {
        board.cell_index(x - 1, y - 1)
    } else {
        outside
    };
    let top_right = if x < board.cols && y > 0 {
        board.cell_index(x, y - 1)
    } else {
        outside
    };
    let bottom_left = if x > 0 && y < board.rows {
        board.cell_index(x - 1, y)
    } else {
        outside
    };
    let bottom_right = if x < board.cols && y < board.rows {
        board.cell_index(x, y)
    } else {
        outside
    };
    (top_left, top_right, bottom_left, bottom_right)
}

fn absorb_edges(
    answer: &AnswerMethods<'_>,
    union_find: &mut RollbackParityUnionFind,
) -> Result<bool, ()> {
    let mut changed = false;
    for edge in 0..answer.board.edge_count() {
        let parity = match answer.edge(edge) {
            EdgeState::Line => Parity::Different,
            EdgeState::Cross => Parity::Same,
            EdgeState::Unknown => continue,
        };
        let (left, right) = edge_cells(answer.board, edge);
        changed |= union_find.unite(left, right, parity)?;
    }
    Ok(changed)
}

fn deduce_edges(
    answer: &mut AnswerMethods<'_>,
    union_find: &RollbackParityUnionFind,
) -> Result<bool, ()> {
    let mut changed = false;
    for edge in 0..answer.board.edge_count() {
        if answer.edge(edge) != EdgeState::Unknown {
            continue;
        }
        let (left, right) = edge_cells(answer.board, edge);
        let Some(parity) = union_find.relation(left, right) else {
            continue;
        };
        let state = match parity {
            Parity::Same => EdgeState::Cross,
            Parity::Different => EdgeState::Line,
        };
        match answer.set_edge(edge, state, INSIDE_OUTSIDE) {
            Status::Advanced => changed = true,
            Status::Stopped => {}
            Status::Broken => return Err(()),
        }
    }
    Ok(changed)
}

fn deduce_vertex_relations(
    union_find: &mut RollbackParityUnionFind,
    top_left: usize,
    top_right: usize,
    bottom_left: usize,
    bottom_right: usize,
) -> Result<bool, ()> {
    let diagonal_one = (top_left, bottom_right);
    let diagonal_two = (top_right, bottom_left);
    let adjacent = [
        (top_left, top_right),
        (top_left, bottom_left),
        (bottom_left, bottom_right),
        (top_right, bottom_right),
    ];
    let mut changed = false;

    for side in adjacent {
        let first = union_find.relation(diagonal_one.0, diagonal_one.1);
        let second = union_find.relation(diagonal_two.0, diagonal_two.1);
        let side_relation = union_find.relation(side.0, side.1);

        // 対角二組がともに同側なら、隣接組だけが異なる配置は次数4になる。
        if first == Some(Parity::Same) && second == Some(Parity::Same) {
            changed |= union_find.unite(side.0, side.1, Parity::Same)?;
        }
        // 一方の対角が同側で隣接組が異側なら、もう一方の対角も
        // 同側にはできない。四方向を列挙して回転・鏡映を同じ形で扱う。
        if first == Some(Parity::Same)
            && side_relation == Some(Parity::Different)
        {
            changed |= union_find.unite(
                diagonal_two.0,
                diagonal_two.1,
                Parity::Different,
            )?;
        }
        if second == Some(Parity::Same)
            && side_relation == Some(Parity::Different)
        {
            changed |= union_find.unite(
                diagonal_one.0,
                diagonal_one.1,
                Parity::Different,
            )?;
        }
    }
    Ok(changed)
}

fn deduce_all_vertex_relations(
    board: &Board,
    union_find: &mut RollbackParityUnionFind,
) -> Result<bool, ()> {
    let mut changed = false;
    for y in 0..=board.rows {
        for x in 0..=board.cols {
            let (top_left, top_right, bottom_left, bottom_right) =
                vertex_cells(board, x, y);
            changed |= deduce_vertex_relations(
                union_find,
                top_left,
                top_right,
                bottom_left,
                bottom_right,
            )?;
        }
    }
    Ok(changed)
}

pub fn inside_outside(answer: &mut AnswerMethods<'_>) -> Status {
    let node_count = answer.board.cols * answer.board.rows + 1;
    let mut union_find = RollbackParityUnionFind::new(node_count);
    let mut result = Status::Stopped;

    loop {
        let mut changed = match absorb_edges(answer, &mut union_find) {
            Ok(changed) => changed,
            Err(()) => return Status::Broken,
        };
        match deduce_edges(answer, &union_find) {
            Ok(edges_changed) => {
                changed |= edges_changed;
                if edges_changed {
                    result = Status::Advanced;
                }
            }
            Err(()) => return Status::Broken,
        }
        match deduce_all_vertex_relations(answer.board, &mut union_find) {
            Ok(relations_changed) => changed |= relations_changed,
            Err(()) => return Status::Broken,
        }
        if !changed {
            return result;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::deduce_vertex_relations;
    use crate::parity_union_find::{Parity, RollbackParityUnionFind};

    #[test]
    fn diagonal_rule_deduces_the_only_missing_relation() {
        let mut union_find = RollbackParityUnionFind::new(4);
        union_find
            .unite(0, 3, Parity::Same)
            .expect("一方の対角関係を設定できる");
        union_find
            .unite(1, 2, Parity::Same)
            .expect("もう一方の対角関係を設定できる");

        assert_eq!(union_find.relation(0, 1), None);
        assert_eq!(
            deduce_vertex_relations(&mut union_find, 0, 1, 2, 3),
            Ok(true)
        );
        assert_eq!(union_find.relation(0, 1), Some(Parity::Same));
    }

    #[test]
    fn diagonal_rule_handles_both_remaining_diagonals_symmetrically() {
        let mut second_diagonal = RollbackParityUnionFind::new(4);
        second_diagonal
            .unite(0, 3, Parity::Same)
            .expect("一方の対角関係を設定できる");
        second_diagonal
            .unite(0, 1, Parity::Different)
            .expect("隣接関係を設定できる");
        assert_eq!(
            deduce_vertex_relations(&mut second_diagonal, 0, 1, 2, 3),
            Ok(true)
        );
        assert_eq!(
            second_diagonal.relation(1, 2),
            Some(Parity::Different)
        );

        let mut first_diagonal = RollbackParityUnionFind::new(4);
        first_diagonal
            .unite(1, 2, Parity::Same)
            .expect("一方の対角関係を設定できる");
        // 上辺以外から既知になった場合も同じ推論が働くことを確かめる。
        first_diagonal
            .unite(0, 2, Parity::Different)
            .expect("左辺の関係を設定できる");
        assert_eq!(
            deduce_vertex_relations(&mut first_diagonal, 0, 1, 2, 3),
            Ok(true)
        );
        assert_eq!(
            first_diagonal.relation(0, 3),
            Some(Parity::Different)
        );
    }

    #[test]
    fn diagonal_rule_rejects_degree_four_coloring() {
        let mut union_find = RollbackParityUnionFind::new(4);
        union_find
            .unite(0, 3, Parity::Same)
            .expect("一方の対角関係を設定できる");
        union_find
            .unite(1, 2, Parity::Same)
            .expect("もう一方の対角関係を設定できる");
        union_find
            .unite(0, 1, Parity::Different)
            .expect("次数4になる隣接関係を設定できる");
        assert_eq!(
            deduce_vertex_relations(&mut union_find, 0, 1, 2, 3),
            Err(())
        );
    }
}
