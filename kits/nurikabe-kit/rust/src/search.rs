//! 解の全数探索。一意性の証明と、手筋の健全性検証に使う。
//!
//! 手筋ソルバーとは独立に書く。ここが「真であることが要求される判定」を担う。

use crate::answer_model::{AnswerModel, CellState};
use crate::board::Board;
use crate::solution::validate_solution;

pub struct CountResult {
    pub solutions: Vec<AnswerModel>,
    pub nodes: usize,
    /// ノード上限に達して打ち切った。`false` でなければ「解は 1 つ」と言い切れない。
    pub aborted: bool,
}

struct Search<'a> {
    board: &'a Board,
    limit: usize,
    max_nodes: usize,
    nodes: usize,
    aborted: bool,
    solutions: Vec<AnswerModel>,
}

impl Search<'_> {
    /// まだ矛盾していないかの軽い枝刈り。完成前でも使える必要条件だけを見る。
    fn feasible(&self, answer: &AnswerModel) -> bool {
        let board = self.board;
        // 2x2 のかべは完成を待たずに禁止できる
        for y in 0..board.rows - 1 {
            for x in 0..board.cols - 1 {
                if [
                    board.index(x, y),
                    board.index(x + 1, y),
                    board.index(x, y + 1),
                    board.index(x + 1, y + 1),
                ]
                .iter()
                .all(|&i| answer.is_black(i))
                {
                    return false;
                }
            }
        }
        // 白の連結成分が、数字を 2 つ以上含んだり、数字のサイズを超えたりしていないか
        let count = board.cell_count();
        let mut seen = vec![false; count];
        for start in 0..count {
            if seen[start] || !answer.is_white(start) {
                continue;
            }
            let mut stack = vec![start];
            seen[start] = true;
            let mut size = 0usize;
            let mut clue = None;
            let mut touches_unknown = false;
            while let Some(index) = stack.pop() {
                size += 1;
                let (x, y) = board.position(index);
                if board.is_clue(x, y) {
                    if clue.is_some() {
                        return false; // 1 つのシマに数字が 2 つ
                    }
                    clue = Some(board.clue(x, y));
                }
                for next in board.neighbours(index) {
                    if answer.is_unknown(next) {
                        touches_unknown = true;
                    } else if answer.is_white(next) && !seen[next] {
                        seen[next] = true;
                        stack.push(next);
                    }
                }
            }
            match clue {
                Some(n) if n > 0 => {
                    if size > n as usize {
                        return false; // シマが大きすぎる
                    }
                    if size < n as usize && !touches_unknown {
                        return false; // もう伸ばせないのに小さい
                    }
                }
                // 数字のないシマは、まだ伸びる余地があるならよい
                _ => {
                    if !touches_unknown && clue.is_none() {
                        return false;
                    }
                }
            }
        }
        true
    }

    fn visit(&mut self, answer: &mut AnswerModel) {
        if self.aborted || self.solutions.len() >= self.limit {
            return;
        }
        self.nodes += 1;
        if self.max_nodes > 0 && self.nodes >= self.max_nodes {
            self.aborted = true;
            return;
        }
        if !self.feasible(answer) {
            return;
        }
        let Some(index) = (0..self.board.cell_count()).find(|&i| answer.is_unknown(i)) else {
            if validate_solution(self.board, answer).is_empty() {
                self.solutions.push(answer.clone());
            }
            return;
        };
        for state in [CellState::Black, CellState::White] {
            let mut next = answer.clone();
            if next.set(index, state).is_ok() {
                self.visit(&mut next);
            }
            if self.aborted || self.solutions.len() >= self.limit {
                return;
            }
        }
    }
}

/// 解を最大 `limit` 個まで数える。`max_nodes` が 0 なら無制限。
pub fn count_solutions(board: &Board, limit: usize, max_nodes: usize) -> CountResult {
    count_solutions_from(board, &AnswerModel::new(board), limit, max_nodes)
}

/// 途中盤面から続きを探索する。手筋の健全性検証に使う。
pub fn count_solutions_from(
    board: &Board,
    start: &AnswerModel,
    limit: usize,
    max_nodes: usize,
) -> CountResult {
    let mut search = Search {
        board,
        limit,
        max_nodes,
        nodes: 0,
        aborted: false,
        solutions: Vec::new(),
    };
    let mut answer = start.clone();
    search.visit(&mut answer);
    CountResult {
        solutions: search.solutions,
        nodes: search.nodes,
        aborted: search.aborted,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::NO_CLUE;
    use crate::puzzlink::decode_url;

    #[test]
    fn finds_the_unique_solution_of_a_tiny_board() {
        // 2x2、左上が 1 → 残り 3 マスがかべ。ただし 2x2 のかべ禁により…実は解なし。
        let board = Board::new(2, 2, vec![1, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let result = count_solutions(&board, 2, 100_000);
        assert!(!result.aborted);
        assert_eq!(result.solutions.len(), 1, "1 のシマ + L 字のかべ");
    }

    /// puzsq #293(人手評価 ★1)。投稿作品なので解は 1 つのはず。
    #[test]
    fn a_published_problem_has_exactly_one_solution() {
        let board = decode_url("https://puzz.link/p?nurikabe/6/6/g5l3zg6i4g").unwrap();
        let result = count_solutions(&board, 2, 5_000_000);
        assert!(!result.aborted, "打ち切られたら一意とは言えない");
        assert_eq!(result.solutions.len(), 1);
    }

    /// cspuz のテスト用問題は多解(cspuz 側の期待値にも未確定セルがある)。
    #[test]
    fn the_cspuz_fixture_is_not_unique() {
        let board = decode_url("https://puzz.link/p?nurikabe/6/6/m8n8i9u").unwrap();
        let result = count_solutions(&board, 2, 5_000_000);
        assert!(result.solutions.len() >= 2);
    }
}
