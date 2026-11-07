use crate::board::{to_id, Board};
use crate::engine::*;
use crate::position::Position;
use crate::random::Rng;
use crate::solution::Solution;

pub struct SearchLimits {
    pub limit: usize,
    pub max_nodes: i32,
    pub black_bias: i32,
}

pub struct SearchResult {
    pub solutions: Vec<Solution>,
    pub nodes: i32,
    pub aborted: bool,
}

fn pick_branch_cell(engine: &Engine, random: bool, rng: &mut Option<&mut Rng>, buffer: &mut Vec<i32>) -> i32 {
    let mut best = -1;
    buffer.clear();
    for i in 0..engine.cell_count {
        if engine.cell[i] != CELL_UNKNOWN {
            continue;
        }
        let score = engine.blank_count[i] as i32 * 2 + engine.line_count[i] as i32;
        if score > best {
            best = score;
            buffer.clear();
            buffer.push(i as i32);
        } else if random && score == best {
            buffer.push(i as i32);
        }
    }
    if buffer.is_empty() {
        -1
    } else if !random || buffer.len() == 1 {
        buffer[0]
    } else {
        let at = rng.as_deref_mut().unwrap().next_int(buffer.len());
        buffer[at]
    }
}

fn pick_branch_edge(engine: &Engine, random: bool, rng: &mut Option<&mut Rng>, buffer: &mut Vec<i32>) -> i32 {
    let mut fallback = -1;
    buffer.clear();
    for edge in 0..engine.edge_count {
        if engine.edge[edge] != EDGE_UNKNOWN {
            continue;
        }
        let a = engine.edge_cells[edge * 2] as usize;
        let b = engine.edge_cells[edge * 2 + 1] as usize;
        let open = (engine.cell[a] == CELL_LINE && engine.line_count[a] == 1)
            || (engine.cell[b] == CELL_LINE && engine.line_count[b] == 1);
        if !open {
            if fallback < 0 {
                fallback = edge as i32;
            }
            continue;
        }
        buffer.push(edge as i32);
        if !random {
            break;
        }
    }
    if buffer.is_empty() {
        fallback
    } else if buffer.len() == 1 {
        buffer[0]
    } else {
        let at = rng.as_deref_mut().unwrap().next_int(buffer.len());
        buffer[at]
    }
}

struct Searcher<'a> {
    engine: &'a mut Engine,
    limits: SearchLimits,
    rng: Option<&'a mut Rng>,
    result: SearchResult,
    buffer: Vec<i32>,
    marks: Vec<Mark>,
}

impl Searcher<'_> {
    fn visit(&mut self, depth: usize) {
        if self.result.solutions.len() >= self.limits.limit || self.result.aborted {
            return;
        }
        self.result.nodes += 1;
        if self.limits.max_nodes > 0 && self.result.nodes > self.limits.max_nodes {
            self.result.aborted = true;
            return;
        }
        if !propagate_engine(self.engine) {
            return;
        }
        if self.marks.len() <= depth {
            self.marks.push(mark(self.engine));
        }
        let random = self.rng.is_some();
        let cell = pick_branch_cell(self.engine, random, &mut self.rng, &mut self.buffer);
        if cell >= 0 {
            let black_first = if let Some(rng) = self.rng.as_deref_mut() {
                rng.next_int(1000) < self.limits.black_bias as usize
            } else {
                true
            };
            let (first, second) = if black_first {
                (CELL_BLACK, CELL_LINE)
            } else {
                (CELL_LINE, CELL_BLACK)
            };
            let mut saved = self.marks[depth].clone();
            remark(self.engine, &mut saved);
            self.marks[depth] = saved.clone();
            set_cell(self.engine, cell, first);
            self.visit(depth + 1);
            undo(self.engine, &saved);
            if self.result.solutions.len() >= self.limits.limit || self.result.aborted {
                return;
            }
            remark(self.engine, &mut saved);
            self.marks[depth] = saved.clone();
            set_cell(self.engine, cell, second);
            self.visit(depth + 1);
            undo(self.engine, &saved);
            return;
        }
        let edge = pick_branch_edge(self.engine, random, &mut self.rng, &mut self.buffer);
        if edge >= 0 {
            let line_first = self
                .rng
                .as_deref_mut()
                .map(Rng::next_boolean)
                .unwrap_or(true);
            let (first, second) = if line_first {
                (EDGE_LINE, EDGE_BLANK)
            } else {
                (EDGE_BLANK, EDGE_LINE)
            };
            let mut saved = self.marks[depth].clone();
            remark(self.engine, &mut saved);
            self.marks[depth] = saved.clone();
            set_edge(self.engine, edge, first);
            self.visit(depth + 1);
            undo(self.engine, &saved);
            if self.result.solutions.len() >= self.limits.limit || self.result.aborted {
                return;
            }
            remark(self.engine, &mut saved);
            self.marks[depth] = saved.clone();
            set_edge(self.engine, edge, second);
            self.visit(depth + 1);
            undo(self.engine, &saved);
        } else if is_solved(self.engine) {
            self.result.solutions.push(to_solution(self.engine));
        }
    }
}

pub fn search_engine(
    engine: &mut Engine,
    limits: SearchLimits,
    rng: Option<&mut Rng>,
) -> SearchResult {
    let root = mark(engine);
    let mut searcher = Searcher {
        engine,
        limits,
        rng,
        result: SearchResult {
            solutions: Vec::new(),
            nodes: 0,
            aborted: false,
        },
        buffer: Vec::new(),
        marks: Vec::new(),
    };
    searcher.visit(0);
    undo(searcher.engine, &root);
    searcher.result
}

pub fn search(board: &Board, limits: SearchLimits, rng: Option<&mut Rng>) -> SearchResult {
    search_engine(&mut create_engine(board), limits, rng)
}

pub struct PropagationAnalysis {
    pub coverage: i32,
    pub undetermined: Vec<usize>,
}

pub fn propagation_coverage(board: &Board) -> i32 {
    analyse_propagation(board).coverage
}

pub fn analyse_propagation(board: &Board) -> PropagationAnalysis {
    let mut engine = create_engine(board);
    if !propagate_engine(&mut engine) {
        return PropagationAnalysis {
            coverage: -1,
            undetermined: Vec::new(),
        };
    }
    let mut determined = 0;
    let mut undetermined = Vec::new();
    for i in 0..engine.cell_count {
        if engine.cell[i] != CELL_UNKNOWN {
            determined += 1;
        } else {
            undetermined.push(i);
        }
    }
    for edge in 0..engine.edge_count {
        if engine.edge[edge] != EDGE_UNKNOWN {
            determined += 1;
        }
    }
    PropagationAnalysis {
        coverage: determined,
        undetermined,
    }
}

pub fn maximum_coverage(board: &Board) -> i32 {
    let engine = create_engine(board);
    (engine.cell_count + engine.edge_count) as i32
}

pub fn count_solutions(board: &Board, limit: usize, max_nodes: i32) -> SearchResult {
    search(
        board,
        SearchLimits {
            limit,
            max_nodes,
            black_bias: 500,
        },
        None,
    )
}

pub fn count_loop_routings(
    board: &Board,
    solution: &Solution,
    limit: usize,
    max_nodes: i32,
) -> SearchResult {
    let mut engine = create_engine(board);
    for i in 0..engine.cell_count {
        if engine.cell[i] != CELL_UNKNOWN {
            continue;
        }
        let pos = Position {
            x: i as i32 % engine.cols,
            y: i as i32 / engine.cols,
        };
        let state = if solution.blacks.contains(&to_id(pos)) {
            CELL_BLACK
        } else {
            CELL_LINE
        };
        set_cell(&mut engine, i as i32, state);
    }
    if engine.contradiction {
        return SearchResult {
            solutions: Vec::new(),
            nodes: 0,
            aborted: false,
        };
    }
    search_engine(
        &mut engine,
        SearchLimits {
            limit,
            max_nodes,
            black_bias: 500,
        },
        None,
    )
}

/// A random valid solution, or None when the board admits none.
///
/// Deliberately a single search with no restarts; restarting on a wasted node budget was
/// measured and reverted (failures cost eight times as much and the success rate fell).
pub fn find_random_solution(
    board: &Board,
    rng: &mut Rng,
    max_nodes: i32,
    black_bias: i32,
) -> Option<Solution> {
    search(
        board,
        SearchLimits {
            limit: 1,
            max_nodes,
            black_bias,
        },
        Some(rng),
    )
    .solutions
    .into_iter()
    .next()
}

pub const INITIAL_RESTARTS: i32 = 8;
pub const REDRAW_RESTARTS: i32 = 3;

pub fn draw_solution(
    board: &Board,
    rng: &mut Rng,
    max_nodes: i32,
    black_bias: i32,
    restarts: i32,
) -> Option<Solution> {
    if max_nodes <= 0 {
        return find_random_solution(board, rng, max_nodes, black_bias);
    }
    for _ in 0..restarts {
        let result = search(
            board,
            SearchLimits {
                limit: 1,
                max_nodes,
                black_bias,
            },
            Some(rng),
        );
        if let Some(solution) = result.solutions.into_iter().next() {
            return Some(solution);
        }
        if !result.aborted {
            return None;
        }
    }
    None
}

pub fn find_initial_solution(
    board: &Board,
    rng: &mut Rng,
    max_nodes: i32,
    black_bias: i32,
) -> Option<Solution> {
    draw_solution(
        board,
        rng,
        max_nodes,
        black_bias,
        INITIAL_RESTARTS,
    )
}
