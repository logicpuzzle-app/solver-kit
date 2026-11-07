//! 全探索。一意性の判定用。
//!
//! 枝刈りの伝播はソルバー(手筋)と独立に素朴に書く。片方のバグが
//! もう片方に伝染しないための重複実装で、共通化しない。

use crate::answer_model::{AnswerModel, EdgeState};
use crate::board::{opposite, Board, BLACK, WHITE, NO_CELL, NO_EDGE, DOWN, RIGHT};
use crate::solution::validate_solution;

pub struct SearchResult {
    pub solutions: Vec<AnswerModel>,
    /// ノード上限で打ち切った。
    pub aborted: bool,
}

pub fn count_solutions(board: &Board, limit: usize, max_nodes: u64) -> SearchResult {
    count_solutions_from(board, AnswerModel::new(board), limit, max_nodes)
}

/// 手筋で途中まで進めた盤面から探索を再開できる。手筋が健全な演繹で
/// ある限り、どの解も途中盤面と両立するので数え漏れはない。
pub fn count_solutions_from(
    board: &Board,
    answer: AnswerModel,
    limit: usize,
    max_nodes: u64,
) -> SearchResult {
    let mut ctx = Context {
        board,
        limit,
        max_nodes,
        nodes: 0,
        solutions: Vec::new(),
        aborted: false,
    };
    let mut answer = answer;
    if propagate(board, &mut answer).is_ok() {
        search(&mut ctx, answer);
    }
    SearchResult {
        solutions: ctx.solutions,
        aborted: ctx.aborted,
    }
}

struct Context<'a> {
    board: &'a Board,
    limit: usize,
    max_nodes: u64,
    nodes: u64,
    solutions: Vec<AnswerModel>,
    aborted: bool,
}

fn set(board: &Board, answer: &mut AnswerModel, edge: usize, state: EdgeState) -> Result<(), ()> {
    answer.set(board, edge, state).map(|_| ()).map_err(|_| ())
}

/// 局所ルールで確定できるだけ確定する。矛盾したら Err。
fn propagate(board: &Board, answer: &mut AnswerModel) -> Result<(), ()> {
    loop {
        let before = answer.unknown_count();

        for cell in 0..board.cell_count() {
            let lines = answer.line_count(cell);
            let unknown = answer.unknown_count_at(board, cell);
            if lines == 2 {
                for dir in 0..4 {
                    let e = board.incident(cell)[dir];
                    if e != NO_EDGE && answer.is_unknown(e) {
                        set(board, answer, e, EdgeState::Bar)?;
                    }
                }
            } else if lines == 1 {
                if unknown == 0 {
                    return Err(());
                }
                if unknown == 1 {
                    for dir in 0..4 {
                        let e = board.incident(cell)[dir];
                        if e != NO_EDGE && answer.is_unknown(e) {
                            set(board, answer, e, EdgeState::Line)?;
                        }
                    }
                }
            } else if lines == 0 && unknown == 1 && !board.is_pearl(cell) {
                for dir in 0..4 {
                    let e = board.incident(cell)[dir];
                    if e != NO_EDGE && answer.is_unknown(e) {
                        set(board, answer, e, EdgeState::Bar)?;
                    }
                }
            }
            if board.is_pearl(cell) && u32::from(lines) + u32::from(unknown) < 2 {
                return Err(());
            }
        }

        for &(cell, pearl) in board.pearls() {
            if pearl == WHITE {
                white_pearl(board, answer, cell)?;
            } else if pearl == BLACK {
                black_pearl(board, answer, cell)?;
            }
        }

        if answer.loop_closed {
            if !answer.is_complete(board) {
                return Err(());
            }
            for e in 0..board.edge_count() {
                if answer.is_unknown(e) {
                    set(board, answer, e, EdgeState::Bar)?;
                }
            }
        }

        if answer.unknown_count() == before {
            return Ok(());
        }
    }
}

/// 白丸: 縦か横にまっすぐ通る。通れる向きが 1 つなら確定。
fn white_pearl(board: &Board, answer: &mut AnswerModel, cell: usize) -> Result<(), ()> {
    let can = |axis: usize| -> bool {
        let e1 = board.incident(cell)[axis];
        let e2 = board.incident(cell)[opposite(axis)];
        let p1 = board.incident(cell)[axis ^ 1];
        let p2 = board.incident(cell)[opposite(axis ^ 1)];
        e1 != NO_EDGE
            && e2 != NO_EDGE
            && !answer.is_bar(e1)
            && !answer.is_bar(e2)
            && !(p1 != NO_EDGE && answer.is_line(p1))
            && !(p2 != NO_EDGE && answer.is_line(p2))
    };
    let horizontal = can(RIGHT);
    let vertical = can(DOWN);
    match (horizontal, vertical) {
        (false, false) => Err(()),
        (true, false) => fix_straight(board, answer, cell, RIGHT),
        (false, true) => fix_straight(board, answer, cell, DOWN),
        (true, true) => Ok(()),
    }
}

fn fix_straight(
    board: &Board,
    answer: &mut AnswerModel,
    cell: usize,
    axis: usize,
) -> Result<(), ()> {
    for dir in [axis, opposite(axis)] {
        let e = board.incident(cell)[dir];
        if answer.is_unknown(e) {
            set(board, answer, e, EdgeState::Line)?;
        }
    }
    for dir in [axis ^ 1, opposite(axis ^ 1)] {
        let e = board.incident(cell)[dir];
        if e != NO_EDGE && answer.is_unknown(e) {
            set(board, answer, e, EdgeState::Bar)?;
        }
    }
    Ok(())
}

/// 黒丸: 縦横 1 本ずつの腕が、丸の隣でもう 1 マス直進する。
fn black_pearl(board: &Board, answer: &mut AnswerModel, cell: usize) -> Result<(), ()> {
    for axis in [RIGHT, DOWN] {
        let d1 = axis;
        let d2 = opposite(axis);
        let p1 = arm_possible(board, answer, cell, d1);
        let p2 = arm_possible(board, answer, cell, d2);
        let e1 = board.incident(cell)[d1];
        let e2 = board.incident(cell)[d2];
        if e1 != NO_EDGE && answer.is_line(e1) {
            fix_arm(board, answer, cell, d1)?;
        } else if e2 != NO_EDGE && answer.is_line(e2) {
            fix_arm(board, answer, cell, d2)?;
        } else {
            match (p1, p2) {
                (false, false) => return Err(()),
                (true, false) => fix_arm(board, answer, cell, d1)?,
                (false, true) => fix_arm(board, answer, cell, d2)?,
                (true, true) => {}
            }
        }
    }
    Ok(())
}

/// dir 方向の腕(丸から 2 マスぶんの直進)がまだ可能か。
fn arm_possible(board: &Board, answer: &AnswerModel, cell: usize, dir: usize) -> bool {
    let e1 = board.incident(cell)[dir];
    if e1 == NO_EDGE || answer.is_bar(e1) {
        return false;
    }
    let n = board.neighbour(cell, dir);
    debug_assert_ne!(n, NO_CELL);
    let e2 = board.incident(n)[dir];
    e2 != NO_EDGE && !answer.is_bar(e2)
}

fn fix_arm(board: &Board, answer: &mut AnswerModel, cell: usize, dir: usize) -> Result<(), ()> {
    let e1 = board.incident(cell)[dir];
    set_if_unknown(board, answer, e1, EdgeState::Line)?;
    let n = board.neighbour(cell, dir);
    let e2 = board.incident(n)[dir];
    if e2 == NO_EDGE {
        return Err(());
    }
    set_if_unknown(board, answer, e2, EdgeState::Line)?;
    let back = board.incident(cell)[opposite(dir)];
    if back != NO_EDGE {
        set_if_unknown(board, answer, back, EdgeState::Bar)?;
    }
    Ok(())
}

fn set_if_unknown(
    board: &Board,
    answer: &mut AnswerModel,
    edge: usize,
    state: EdgeState,
) -> Result<(), ()> {
    if edge == NO_EDGE {
        return Err(());
    }
    if answer.is_unknown(edge) {
        set(board, answer, edge, state)?;
    } else if (state == EdgeState::Line) != answer.is_line(edge) {
        return Err(());
    }
    Ok(())
}

/// 分岐する辺を選ぶ。線の端点に接する辺を最優先、次に未通過の丸のまわり。
fn pick_edge(board: &Board, answer: &AnswerModel) -> Option<usize> {
    let mut pearl_edge = None;
    for cell in 0..board.cell_count() {
        let lines = answer.line_count(cell);
        for dir in 0..4 {
            let e = board.incident(cell)[dir];
            if e == NO_EDGE || !answer.is_unknown(e) {
                continue;
            }
            if lines == 1 {
                return Some(e);
            }
            if pearl_edge.is_none() && board.is_pearl(cell) {
                pearl_edge = Some(e);
            }
        }
    }
    if pearl_edge.is_some() {
        return pearl_edge;
    }
    (0..board.edge_count()).find(|&e| answer.is_unknown(e))
}

fn search(ctx: &mut Context<'_>, answer: AnswerModel) {
    if ctx.solutions.len() >= ctx.limit || ctx.aborted {
        return;
    }
    ctx.nodes += 1;
    if ctx.nodes > ctx.max_nodes {
        ctx.aborted = true;
        return;
    }

    let edge = match pick_edge(ctx.board, &answer) {
        Some(edge) => edge,
        None => {
            if validate_solution(ctx.board, &answer).is_empty() {
                ctx.solutions.push(answer);
            }
            return;
        }
    };

    for state in [EdgeState::Line, EdgeState::Bar] {
        let mut trial = answer.clone_for_trial();
        if trial.set(ctx.board, edge, state).is_ok() && propagate(ctx.board, &mut trial).is_ok() {
            search(ctx, trial);
            if ctx.solutions.len() >= ctx.limit || ctx.aborted {
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::puzzlink::decode_url;

    #[test]
    fn a_tiny_puzzle_has_a_unique_solution() {
        // pzprjs のテスト実例。一意解のはず。
        let board = decode_url("mashu/6/6/1063000i3000").unwrap();
        let result = count_solutions(&board, 2, 10_000_000);
        assert!(!result.aborted);
        assert_eq!(result.solutions.len(), 1);
    }

    #[test]
    fn an_empty_board_has_many_loops() {
        let board = crate::board::Board::new(3, 3, vec![0; 9]).unwrap();
        let result = count_solutions(&board, 5, 10_000_000);
        // 丸が無ければループは何通りもある(3x3 でも 2x2 の四角が 4 つ + …)。
        assert!(result.solutions.len() >= 5);
    }
}
