//! 後戻り探索。一意性確認と解答出力のためのもので、難易度には関わらない。
//!
//! 手筋ソルバーとは状態の伝播を共有しない。ここでは軽い必要条件と、安い確定だけを
//! 独立に押し込んでから黒・白の 2 枝へ分ける。

use crate::answer_model::{AnswerModel, CellState};
use crate::board::{Board, LineScan};

pub struct SearchResult {
    pub solutions: Vec<AnswerModel>,
    pub aborted: bool,
    pub nodes: u64,
}

/// `limit` 個見つけたら止める。`max_nodes` を超えたら打ち切る。
pub fn count_solutions(board: &Board, limit: usize, max_nodes: u64) -> SearchResult {
    count_solutions_from(board, AnswerModel::new(board), limit, max_nodes)
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
        nodes: 0,
    };
    if limit == 0 {
        return result;
    }
    let mut answer = answer;
    search(board, &mut answer, limit, max_nodes, &mut result);
    result
}

/// 白の将来連結可能性。黒隣接と部屋数字の上下限は propagate 本体が同じ巡回で見るので、
/// ここでは見ない。BFS は propagate の不動点に達してから 1 回だけ呼ぶ
/// (毎巡回呼ぶと探索 1 ノードのコストが数倍になる。17×17 の打ち切りで実測)。
fn feasible(board: &Board, answer: &AnswerModel) -> bool {
    // 現在の白どうしが、未確定を白にしたとしてもつながらないなら回復不能。
    let Some(start) = (0..board.cell_count()).find(|&index| answer.is_white(index)) else {
        return true;
    };
    let mut seen = vec![false; board.cell_count()];
    seen[start] = true;
    let mut stack = vec![start];
    while let Some(index) = stack.pop() {
        for &next in board.neighbours(index) {
            if !seen[next] && !answer.is_black(next) {
                seen[next] = true;
                stack.push(next);
            }
        }
    }
    (0..board.cell_count()).all(|index| !answer.is_white(index) || seen[index])
}

/// 2 本以上の部屋境界をまたぐ区間には、少なくとも 1 つ黒が必要。
///
/// 見るのは「隣り合う境界 2 本の最小窓」(境界の左のマス〜次の境界の右のマス)だけでよい。
/// 2 本以上またぐ区間はどれも最小窓を含むので、矛盾の検出も 1 マス強制も等価になり、
/// 全区間ペアの走査 O(L^2) が境界の本数 O(R) に落ちる。探索の 1 ノードごとに呼ぶので効く。
fn propagate_line(answer: &mut AnswerModel, line: &LineScan) -> Result<bool, ()> {
    let mut moved = false;
    let mut previous: Option<usize> = None;
    for (at, &is_boundary) in line.boundaries.iter().enumerate() {
        if !is_boundary {
            continue;
        }
        if let Some(start) = previous {
            let cells = &line.cells[start..=at + 1];
            if !cells.iter().any(|&index| answer.is_black(index)) {
                let mut unknown = cells
                    .iter()
                    .copied()
                    .filter(|&index| answer.is_unknown(index));
                match (unknown.next(), unknown.next()) {
                    (None, _) => return Err(()),
                    (Some(only), None) => {
                        answer.set(only, CellState::Black).map_err(|_| ())?;
                        moved = true;
                    }
                    _ => {}
                }
            }
        }
        previous = Some(at);
    }
    Ok(moved)
}

/// 探索専用の確定。Recorder に載せず、手筋一覧にも数えない。
fn propagate(board: &Board, answer: &mut AnswerModel) -> bool {
    loop {
        let mut moved = false;

        let black: Vec<usize> = (0..board.cell_count())
            .filter(|&index| answer.is_black(index))
            .collect();
        for index in black {
            for &next in board.neighbours(index) {
                if answer.is_black(next) {
                    return false;
                }
                if answer.is_unknown(next) {
                    if answer.set(next, CellState::White).is_err() {
                        return false;
                    }
                    moved = true;
                }
            }
        }

        for (room_id, want) in board.clue_rooms() {
            let cells = &board.room(room_id).cells;
            let black = cells
                .iter()
                .filter(|&&index| answer.is_black(index))
                .count() as i32;
            let unknown: Vec<usize> = cells
                .iter()
                .copied()
                .filter(|&index| answer.is_unknown(index))
                .collect();
            if black > want || black + (unknown.len() as i32) < want {
                return false;
            }
            let fill = if black == want {
                Some(CellState::White)
            } else if black + unknown.len() as i32 == want {
                Some(CellState::Black)
            } else {
                None
            };
            if let Some(state) = fill {
                for index in unknown {
                    if answer.set(index, state).is_err() {
                        return false;
                    }
                    moved = true;
                }
            }
        }

        for line in board.row_lines().iter().chain(board.col_lines()) {
            match propagate_line(answer, line) {
                Ok(changed) => moved |= changed,
                Err(()) => return false,
            }
        }

        if !moved {
            return feasible(board, answer);
        }
    }
}

/// 制約の多い部屋を先に選び、同点なら隣に確定マスが多いものを選ぶ。
fn branch(board: &Board, answer: &AnswerModel) -> Option<usize> {
    (0..board.cell_count())
        .filter(|&index| answer.is_unknown(index))
        .max_by_key(|&index| {
            let room = board.room(board.room_id(index));
            let clue_score = room.clue.filter(|&n| n >= 0).map_or(0, |_| 100);
            let decided = board
                .neighbours(index)
                .iter()
                .filter(|&&next| !answer.is_unknown(next))
                .count();
            clue_score + decided
        })
}

fn search(
    board: &Board,
    answer: &mut AnswerModel,
    limit: usize,
    max_nodes: u64,
    result: &mut SearchResult,
) {
    if result.solutions.len() >= limit || result.aborted {
        return;
    }
    result.nodes += 1;
    if result.nodes > max_nodes {
        result.aborted = true;
        return;
    }
    if !propagate(board, answer) {
        return;
    }
    let Some(index) = branch(board, answer) else {
        if crate::solution::validate_solution(board, answer).is_empty() {
            result.solutions.push(answer.clone());
        }
        return;
    };
    for state in [CellState::Black, CellState::White] {
        let mut next = answer.clone();
        if next.set(index, state).is_ok() {
            search(board, &mut next, limit, max_nodes, result);
        }
        if result.solutions.len() >= limit || result.aborted {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::puzzlink::decode_url;
    use crate::solution::validate_solution;

    const CSPUZ_URL: &str = "https://puzz.link/p?heyawake/6/6/aa66aapv0fu0g2i3k";

    #[test]
    fn finds_a_solution_of_the_cspuz_fixture() {
        let board = decode_url(CSPUZ_URL).unwrap();
        let found = count_solutions(&board, 1, 2_000_000);
        assert!(!found.aborted, "{} ノードで打ち切り", found.nodes);
        assert_eq!(found.solutions.len(), 1);
        assert!(validate_solution(&board, &found.solutions[0]).is_empty());
    }

    #[test]
    fn continues_from_a_partial_board() {
        let board = Board::new(2, 1, vec![false], vec![], vec![Some(1)]).unwrap();
        let mut partial = AnswerModel::new(&board);
        partial.set(0, CellState::Black).unwrap();
        let found = count_solutions_from(&board, partial, 2, 100);
        assert!(!found.aborted);
        assert_eq!(found.solutions.len(), 1);
        assert!(found.solutions[0].is_white(1));
    }
}
