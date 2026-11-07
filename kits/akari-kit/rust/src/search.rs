//! 全探索。解の数を数えるためのもので、難易度には関わらない。
//!
//! 手筋ソルバーとは状態を共有しない。「一意に決まるか」は手筋の強さと無関係に
//! 決まっていなければならないので、こちらは素朴な後戻り探索で独立に確かめる。
//!
//! 分岐は「まだ照らされていない白マスのうち、照らせる候補がいちばん少ないもの」を選ぶ。
//! 未照射マスは必ずどれかの照明に照らされるので、そのマスの候補が場合分けの全体になる。

use crate::answer_model::{AnswerModel, CellState};
use crate::board::Board;

pub struct SearchResult {
    pub solutions: Vec<AnswerModel>,
    /// ノード上限で打ち切ったか。打ち切ったら解の数は下限としか言えない。
    pub aborted: bool,
}

/// `limit` 個見つけたら止める。`max_nodes` を超えたら打ち切る。
pub fn count_solutions(board: &Board, limit: usize, max_nodes: u64) -> SearchResult {
    let answer = AnswerModel::new(board);
    count_solutions_from(board, answer, limit, max_nodes)
}

pub fn count_solutions_from(
    board: &Board,
    answer: AnswerModel,
    limit: usize,
    max_nodes: u64,
) -> SearchResult {
    let mut result = SearchResult {
        solutions: Vec::new(),
        aborted: false,
    };
    let mut nodes = 0u64;
    let mut answer = answer;
    search(board, &mut answer, limit, max_nodes, &mut nodes, &mut result);
    result
}

/// 数字と照らし合いの条件を、まだ矛盾していないかだけ確かめる。
fn feasible(board: &Board, answer: &AnswerModel) -> bool {
    for (index, want) in board.clue_cells() {
        let mut lamps = 0;
        let mut room = 0;
        for &n in board.neighbours(index) {
            if answer.is_lamp(n) {
                lamps += 1;
            } else if answer.is_unknown(n) {
                room += 1;
            }
        }
        if lamps > want || lamps + room < want {
            return false;
        }
    }
    for index in answer.lamps() {
        for ray in board.rays(index) {
            if ray.iter().any(|&seen| answer.is_lamp(seen)) {
                return false;
            }
        }
    }
    // まだ照らされておらず、照らせる見込みもない白マスがあれば行き止まり
    let lit = answer.lit(board);
    for index in 0..board.cell_count() {
        if !board.is_open(index) || lit[index] {
            continue;
        }
        let reachable = board
            .sight(index)
            .into_iter()
            .any(|&candidate| answer.is_unknown(candidate));
        if !reachable {
            return false;
        }
    }
    true
}

/// 次に場合分けするマス。未照射マスのうち候補がいちばん少ないものの候補列。
fn branch(board: &Board, answer: &AnswerModel) -> Option<Vec<usize>> {
    let lit = answer.lit(board);
    let mut best: Option<Vec<usize>> = None;
    for index in 0..board.cell_count() {
        if !board.is_open(index) || lit[index] {
            continue;
        }
        let candidates: Vec<usize> = board
            .sight(index)
            .into_iter()
            .filter(|&&c| answer.is_unknown(c))
            .copied()
            .collect();
        if best.as_ref().is_none_or(|b| candidates.len() < b.len()) {
            if candidates.len() <= 1 {
                return Some(candidates);
            }
            best = Some(candidates);
        }
    }
    best
}

/// 明らかな帰結だけを、動かなくなるまで押し込む。矛盾したら false。
///
/// 手筋ソルバーとは別に、ここで独立に書いてある。探索の枝刈りであって
/// 難易度の材料ではないので、記録も取らないし手筋の一覧にも載せない。
/// これが無いと 10x10 で 500 万ノードを超えて打ち切られる。
fn propagate(board: &Board, answer: &mut AnswerModel) -> bool {
    loop {
        let mut moved = false;
        // 照明が見ているマスには照明を置けない
        for index in answer.lamps() {
            for ray in board.rays(index) {
                for &seen in ray {
                    if answer.is_unknown(seen) {
                        if answer.set(seen, CellState::Empty).is_err() {
                            return false;
                        }
                        moved = true;
                    }
                }
            }
        }
        // 数字はちょうどその数だけ隣に照明を持つ
        for (index, want) in board.clue_cells() {
            let neighbours = board.neighbours(index);
            let lamps = neighbours.iter().filter(|&&n| answer.is_lamp(n)).count() as i32;
            let unknown: Vec<usize> = neighbours
                .iter()
                .copied()
                .filter(|&n| answer.is_unknown(n))
                .collect();
            if lamps > want || lamps + (unknown.len() as i32) < want {
                return false;
            }
            let fill = if lamps == want {
                Some(CellState::Empty)
            } else if lamps + (unknown.len() as i32) == want {
                Some(CellState::Lamp)
            } else {
                None
            };
            if let Some(state) = fill {
                for cell in unknown {
                    if answer.set(cell, state).is_err() {
                        return false;
                    }
                    moved = true;
                }
            }
        }
        if !moved {
            return true;
        }
    }
}

fn search(
    board: &Board,
    answer: &mut AnswerModel,
    limit: usize,
    max_nodes: u64,
    nodes: &mut u64,
    result: &mut SearchResult,
) {
    if result.solutions.len() >= limit || result.aborted {
        return;
    }
    *nodes += 1;
    if *nodes > max_nodes {
        result.aborted = true;
        return;
    }
    if !propagate(board, answer) {
        return;
    }
    if !feasible(board, answer) {
        return;
    }
    let Some(candidates) = branch(board, answer) else {
        // 全部照らせた。残った未確定は照明を置かないと決めれば完成する。
        let mut finished = answer.clone();
        for index in 0..board.cell_count() {
            if finished.is_unknown(index) {
                let _ = finished.set(index, CellState::Empty);
            }
        }
        if crate::solution::validate_solution(board, &finished).is_empty() {
            result.solutions.push(finished);
        }
        return;
    };
    // 候補が空なら、そのマスはもう照らせない = 行き止まり
    for (at, &candidate) in candidates.iter().enumerate() {
        let mut next = answer.clone();
        if next.set(candidate, CellState::Lamp).is_err() {
            continue;
        }
        // 同じ解を二度数えないよう、前に試した候補は「置かない」に固定する
        let mut ok = true;
        for &earlier in &candidates[..at] {
            if next.set(earlier, CellState::Empty).is_err() {
                ok = false;
                break;
            }
        }
        if ok {
            search(board, &mut next, limit, max_nodes, nodes, result);
        }
        if result.solutions.len() >= limit || result.aborted {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::CellState;
    use crate::puzzlink::decode_url;
    use crate::solution::validate_solution;

    #[test]
    fn the_cspuz_fixture_has_exactly_one_solution() {
        let board =
            decode_url("https://puzz.link/p?akari/10/10/hcscl.h.idn.i.cgcndg.h.ncs.h").unwrap();
        let found = count_solutions(&board, 2, 5_000_000);
        assert!(!found.aborted);
        assert_eq!(found.solutions.len(), 1);
    }

    #[test]
    fn the_cspuz_fixture_matches_the_published_answer() {
        let board =
            decode_url("https://puzz.link/p?akari/10/10/hcscl.h.idn.i.cgcndg.h.ncs.h").unwrap();
        let found = count_solutions(&board, 1, 5_000_000);
        #[rustfmt::skip]
        let expected = [
            1,0,0,1,0,0,0,0,0,0,
            0,0,1,0,0,0,0,0,0,1,
            0,0,0,0,1,0,0,0,1,0,
            0,0,0,0,0,1,0,0,0,0,
            0,0,0,0,1,0,0,1,0,0,
            0,1,0,0,0,1,0,0,0,0,
            1,0,0,0,0,0,1,0,0,0,
            0,0,0,0,0,1,0,0,0,0,
            0,0,1,0,0,0,0,0,0,0,
            0,1,0,0,0,0,0,0,0,1,
        ];
        let answer = &found.solutions[0];
        for (index, want) in expected.iter().enumerate() {
            assert_eq!(answer.is_lamp(index) as i32, *want, "マス {index}");
        }
    }

    /// 探索が正しいかを、探索と無関係に確かめる。
    /// 公開されている解をそのまま置いて、検証が通ることを見る。
    #[test]
    fn the_published_answer_validates() {
        let board =
            decode_url("https://puzz.link/p?akari/10/10/hcscl.h.idn.i.cgcndg.h.ncs.h").unwrap();
        #[rustfmt::skip]
        let expected = [
            1,0,0,1,0,0,0,0,0,0,
            0,0,1,0,0,0,0,0,0,1,
            0,0,0,0,1,0,0,0,1,0,
            0,0,0,0,0,1,0,0,0,0,
            0,0,0,0,1,0,0,1,0,0,
            0,1,0,0,0,1,0,0,0,0,
            1,0,0,0,0,0,1,0,0,0,
            0,0,0,0,0,1,0,0,0,0,
            0,0,1,0,0,0,0,0,0,0,
            0,1,0,0,0,0,0,0,0,1,
        ];
        let mut answer = AnswerModel::new(&board);
        for (index, want) in expected.iter().enumerate() {
            let state = if *want == 1 { CellState::Lamp } else { CellState::Empty };
            answer.set(index, state).unwrap_or_else(|e| panic!("マス {index}: {e}"));
        }
        let errors = validate_solution(&board, &answer);
        assert!(errors.is_empty(), "{errors:?}");
    }

    #[test]
    fn an_open_board_has_many_solutions() {
        let board = crate::board::Board::new(4, 4, vec![crate::board::OPEN; 16]).unwrap();
        let found = count_solutions(&board, 2, 1_000_000);
        assert_eq!(found.solutions.len(), 2);
    }
}
