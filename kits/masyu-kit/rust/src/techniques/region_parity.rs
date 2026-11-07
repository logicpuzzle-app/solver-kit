//! 領域の出入り。
//!
//! 線がまだ通っていないマスのかたまり(× で仕切られた領域)を見つけ、
//! その境界を数える。ループは領域の境界を偶数回しか横切れないので:
//!
//! - 出入り口(未定の境界辺)が 1 本だけなら、そこは通れない → ×
//!   (ループが領域の内側にいても外側にいても、その辺が使えないのは同じ)
//! - 領域の中に丸があるなら、ループは外から入って来ざるを得ない。
//!   出入り口がなければ矛盾、2 本ちょうどなら両方とも線
//!
//! 直線のカット偶奇(cut_parity)の領域版。ヤジリンの「見えない壁」にあたる。
//! 市松カウンティング(白黒差分の原理)による下限の強化も試したが、
//! 本線で発火 0 回・完解率も不動で却下した(REJECTED_JA.md)。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::EdgeState;
use crate::board::NO_EDGE;
use crate::reasons::REGION_PARITY;
use crate::status::Status;

pub fn region_parity(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let cell_count = board.cell_count();

    // 線のないマスを、未定辺だけを渡って連結成分に分ける。
    let mut component = vec![usize::MAX; cell_count];
    let mut components = 0;
    for start in 0..cell_count {
        if component[start] != usize::MAX || answer.answer.line_count(start) > 0 {
            continue;
        }
        let id = components;
        components += 1;
        let mut stack = vec![start];
        component[start] = id;
        while let Some(cell) = stack.pop() {
            for dir in 0..4 {
                let edge = board.incident(cell)[dir];
                if edge == NO_EDGE || !answer.answer.is_unknown(edge) {
                    continue;
                }
                let next = board.neighbour(cell, dir);
                if answer.answer.line_count(next) > 0 || component[next] != usize::MAX {
                    continue;
                }
                component[next] = id;
                stack.push(next);
            }
        }
    }

    // 成分ごとの出入り口(片端だけが成分内の未定辺)と丸の数。
    let mut openings: Vec<Vec<usize>> = vec![Vec::new(); components];
    let mut pearls_in = vec![0i32; components];
    let mut free_pearls = 0i32;
    for &(cell, _) in board.pearls() {
        if answer.answer.line_count(cell) == 0 {
            pearls_in[component[cell]] += 1;
            free_pearls += 1;
        }
    }
    for edge in 0..board.edge_count() {
        if !answer.answer.is_unknown(edge) {
            continue;
        }
        let [a, b] = board.edge_cells(edge);
        let ca = component[a];
        let cb = component[b];
        if ca == cb {
            continue; // 成分の内部(両方 MAX なら両端とも線マス)。
        }
        if ca != usize::MAX {
            openings[ca].push(edge);
        }
        if cb != usize::MAX {
            openings[cb].push(edge);
        }
    }

    // 丸を根拠にする規則は「ループが成分の外に必ずある」ときだけ使える。
    // 外に線マスがあるか、外に(まだ線のない)丸があれば、ループは外を通る。
    let line_exists = (0..cell_count).any(|c| answer.answer.line_count(c) > 0);

    let mut forced: Vec<(usize, EdgeState)> = Vec::new();
    for id in 0..components {
        let n = openings[id].len();
        let anchored = line_exists || free_pearls > pearls_in[id];
        if anchored && pearls_in[id] > 0 {
            match n {
                0 | 1 => return Status::Broken,
                2 => {
                    for &edge in &openings[id] {
                        forced.push((edge, EdgeState::Line));
                    }
                    continue;
                }
                _ => {}
            }
        }
        // 偶数回しか横切れないので、出入り口 1 本は使えない。
        if n == 1 {
            forced.push((openings[id][0], EdgeState::Bar));
        }
    }

    let mut result = Status::Stopped;
    for (edge, state) in forced {
        result = merge_status(result, answer.set(edge, state, REGION_PARITY));
        if result == Status::Broken {
            return result;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_methods::AnswerMethods;
    use crate::answer_model::AnswerModel;
    use crate::board::{Board, DOWN, WHITE};

    #[test]
    fn a_pocket_with_one_opening_is_sealed() {
        // 左上のマス0 を、下は × で仕切り、隣接マスに線を通して孤立させる。
        // 出入り口は右の辺 1 本だけになり、ループは入れないので ×。
        let board = Board::new(4, 4, {
            let mut cells = vec![0; 16];
            cells[10] = WHITE;
            cells
        })
        .unwrap();
        let mut model = AnswerModel::new(&board);
        model
            .set(&board, board.incident(0)[DOWN], EdgeState::Bar)
            .unwrap();
        model.set(&board, 1, EdgeState::Line).unwrap(); // 1-2
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(region_parity(&mut answer), Status::Advanced);
        assert!(model.is_bar(0));
    }

    #[test]
    fn a_pearl_pocket_with_two_openings_forces_both() {
        let board = Board::new(4, 4, {
            let mut cells = vec![0; 16];
            cells[0] = WHITE;
            cells
        })
        .unwrap();
        let mut model = AnswerModel::new(&board);
        // 何も仕切らない: マス0 の成分は盤面全体なので何も起きない。
        {
            let mut answer = AnswerMethods::new(&board, &mut model, None);
            assert_eq!(region_parity(&mut answer), Status::Stopped);
        }
        // 隣のマス 1 と 4 に線を通して成分を 1 マスに切り出す。
        model.set(&board, 1, EdgeState::Line).unwrap();
        model
            .set(&board, board.incident(4)[DOWN], EdgeState::Line)
            .unwrap();
        let mut answer = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(region_parity(&mut answer), Status::Advanced);
        assert!(model.is_line(0));
        assert!(model.is_line(board.incident(0)[DOWN]));
    }
}
