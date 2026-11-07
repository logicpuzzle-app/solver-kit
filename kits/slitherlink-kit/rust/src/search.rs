use crate::board::Board;
use crate::engine::{ConstraintEngine, EdgeState};
use crate::solution::validate_solution;

#[derive(Clone, Debug)]
pub struct CountResult {
    pub solutions: Vec<Vec<EdgeState>>,
    pub nodes: usize,
    pub aborted: bool,
}

struct Search<'a> {
    board: &'a Board,
    engine: ConstraintEngine<'a>,
    limit: usize,
    max_nodes: usize,
    result: CountResult,
}

pub fn count_solutions(board: &Board, limit: usize, max_nodes: i32) -> CountResult {
    if limit == 0 {
        return CountResult {
            solutions: Vec::new(),
            nodes: 0,
            aborted: false,
        };
    }
    let mut search = Search {
        board,
        engine: ConstraintEngine::new(board),
        limit,
        max_nodes: if max_nodes <= 0 {
            0
        } else {
            max_nodes as usize
        },
        result: CountResult {
            solutions: Vec::new(),
            nodes: 0,
            aborted: false,
        },
    };
    search.visit();
    search.result
}

impl Search<'_> {
    fn visit(&mut self) {
        if self.result.aborted || self.result.solutions.len() >= self.limit {
            return;
        }
        if self.max_nodes != 0 && self.result.nodes >= self.max_nodes {
            self.result.aborted = true;
            return;
        }
        self.result.nodes += 1;
        if self.engine.propagate().is_err() {
            return;
        }
        if !self.engine.has_unknown_edges() {
            if validate_solution(self.board, self.engine.edges()).is_empty() {
                self.result.solutions.push(self.engine.edges().to_vec());
            }
            return;
        }

        if let Some(candidates) = self.engine.endpoint_candidates() {
            for chosen in candidates.iter().copied() {
                if self.result.aborted || self.result.solutions.len() >= self.limit {
                    break;
                }
                let checkpoint = self.engine.checkpoint();
                let branch = self.engine.set_edge(chosen, EdgeState::Line).and_then(|_| {
                    for &other in &candidates {
                        if other != chosen {
                            self.engine.set_edge(other, EdgeState::Cross)?;
                        }
                    }
                    Ok(())
                });
                if branch.is_ok() {
                    self.visit();
                }
                self.engine.rollback(checkpoint);
            }
        } else {
            let edge = self.engine.best_unknown_edge();
            for state in [EdgeState::Line, EdgeState::Cross] {
                if self.result.aborted || self.result.solutions.len() >= self.limit {
                    break;
                }
                let checkpoint = self.engine.checkpoint();
                if self.engine.set_edge(edge, state).is_ok() {
                    self.visit();
                }
                self.engine.rollback(checkpoint);
            }
        }
    }
}
