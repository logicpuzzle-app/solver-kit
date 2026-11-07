use crate::board::{create_board, to_id, to_pos, Board};
use crate::difficulty::{difficulty, technique_work};
use crate::position::{Position, DIRS};
use crate::random::Rng;
use crate::search::{
    analyse_propagation, count_loop_routings, count_solutions, draw_solution,
    find_initial_solution, REDRAW_RESTARTS,
};
use crate::solution::{count_blacks_along_arrow, validate_solution, Solution};
use crate::solver::{run_all, SolveOptions, SolveOutcome};

#[derive(Clone, Copy, Debug)]
pub enum Symmetry {
    None,
    Rot2,
    Rot4,
    MirrorH,
    MirrorV,
}

pub struct GenerateOptions {
    pub cols: i32,
    pub rows: i32,
    pub clues: Option<usize>,
    pub clue_ratio: f64,
    pub attempts: i32,
    pub dp_min: Option<i32>,
    pub dp_max: Option<i32>,
    pub max_nodes: i32,
    pub weaken: bool,
    pub reduce: bool,
    pub symmetry: Symmetry,
    pub pattern: Option<Vec<bool>>,
    pub black_bias: i32,
    pub refine: i32,
    pub anneal: Option<i32>,
    /// Let the annealing add and remove clues, not just move and re-aim them. Produces
    /// harder puzzles at the cost of roughly 40% more time.
    pub vary_clue_count: bool,
}

pub struct Generated {
    pub board: Board,
    pub solution: Solution,
    pub outcome: SolveOutcome,
    pub difficulty: i32,
    pub attempts: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Clue {
    pos: Position,
    index: usize,
}

const REPAIR_ROUNDS: i32 = 24;
const PROMOTION_REJECTIONS: i32 = 24;
/// How many unsolvable pattern draws are skipped before one counts as a failed attempt.
const PATTERN_DRAWS: i32 = 30;

fn anneal_rounds_for(cols: i32, rows: i32) -> i32 {
    400.max(cols * rows * 8)
}

fn ray_length(board: &Board, origin: Position, dir: i32) -> i32 {
    let delta = DIRS[dir as usize];
    let mut x = origin.x + delta.x;
    let mut y = origin.y + delta.y;
    let mut length = 0;
    while board.in_board(Position { x, y }) {
        length += 1;
        x += delta.x;
        y += delta.y;
    }
    length
}

fn directions_by_reach(board: &Board, origin: Position, rng: &mut Rng) -> Vec<i32> {
    let mut scored: Vec<_> = (1..=4)
        .map(|dir| (dir, ray_length(board, origin, dir), rng.next_int(1 << 20)))
        .collect();
    scored.sort_by(|a, b| {
        b.1.cmp(&a.1)
            .then_with(|| a.2.cmp(&b.2))
    });
    scored.into_iter().map(|entry| entry.0).collect()
}

fn refresh_counts(board: &mut Board, solution: &Solution, clues: &[Clue]) {
    for clue in clues {
        let dir = board.cell[clue.index].qdir;
        board.cell[clue.index].qnum =
            count_blacks_along_arrow(board, solution, clue.pos, dir);
    }
}

struct Unique {
    unique: bool,
    other: Option<Solution>,
    aborted: bool,
}

fn uniqueness(board: &Board, max_nodes: i32) -> Unique {
    let mut result = count_solutions(board, 2, max_nodes);
    if result.aborted {
        Unique {
            unique: false,
            other: None,
            aborted: true,
        }
    } else if result.solutions.len() == 1 {
        Unique {
            unique: true,
            other: None,
            aborted: false,
        }
    } else {
        let other = if result.solutions.len() > 1 {
            Some(result.solutions.swap_remove(1))
        } else {
            result.solutions.pop()
        };
        Unique {
            unique: false,
            other,
            aborted: false,
        }
    }
}

fn choose_direction(
    board: &Board,
    solution: &Solution,
    other: Option<&Solution>,
    pos: Position,
    rng: &mut Rng,
) -> i32 {
    let ordered = directions_by_reach(board, pos, rng);
    if let Some(other) = other {
        for &dir in &ordered {
            if count_blacks_along_arrow(board, solution, pos, dir)
                != count_blacks_along_arrow(board, other, pos, dir)
            {
                return dir;
            }
        }
    }
    ordered[0]
}

fn promote(
    board: &mut Board,
    solution: &mut Solution,
    clues: &mut Vec<Clue>,
    pos: Position,
    dir: i32,
) {
    let index = (pos.y * board.cols + pos.x) as usize;
    solution.blacks.remove(&to_id(pos));
    board.cell[index].qdir = dir;
    board.cell[index].qnum = 0;
    clues.push(Clue { pos, index });
    refresh_counts(board, solution, clues);
}

fn demote(
    board: &mut Board,
    solution: &mut Solution,
    clues: &mut Vec<Clue>,
    clue: Clue,
) {
    solution.blacks.insert(to_id(clue.pos));
    board.cell[clue.index].qdir = -1;
    board.cell[clue.index].qnum = -1;
    if let Some(at) = clues.iter().position(|&c| c == clue) {
        clues.remove(at);
    }
    refresh_counts(board, solution, clues);
}

fn reduce_clues(
    board: &mut Board,
    solution: &mut Solution,
    clues: &mut Vec<Clue>,
    rng: &mut Rng,
    max_nodes: i32,
) {
    let mut order = clues.clone();
    rng.shuffle(&mut order);
    for clue in order {
        let blocked = (1..=4).any(|dir| {
            let d = DIRS[dir];
            let pos = Position {
                x: clue.pos.x + d.x,
                y: clue.pos.y + d.y,
            };
            board.in_board(pos) && solution.blacks.contains(&to_id(pos))
        });
        if blocked {
            continue;
        }
        let saved = board.cell[clue.index];
        demote(board, solution, clues, clue);
        if !uniqueness(board, max_nodes).unique {
            solution.blacks.remove(&to_id(clue.pos));
            board.cell[clue.index] = saved;
            clues.push(clue);
            refresh_counts(board, solution, clues);
        }
    }
}

fn weaken_clues(
    board: &mut Board,
    solution: &Solution,
    clues: &[Clue],
    rng: &mut Rng,
    max_nodes: i32,
) {
    let mut order = clues.to_vec();
    rng.shuffle(&mut order);
    for clue in order {
        let original = board.cell[clue.index].qdir;
        let mut dirs = directions_by_reach(board, clue.pos, rng);
        dirs.reverse();
        for dir in dirs {
            if dir == original {
                continue;
            }
            board.cell[clue.index].qdir = dir;
            refresh_counts(board, solution, clues);
            if uniqueness(board, max_nodes).unique {
                break;
            }
            board.cell[clue.index].qdir = original;
            refresh_counts(board, solution, clues);
        }
    }
}

#[derive(Clone)]
struct Snapshot {
    board: Board,
    solution: Solution,
    clues: Vec<Clue>,
}

fn restore(board: &mut Board, solution: &mut Solution, clues: &mut Vec<Clue>, saved: Snapshot) {
    *board = saved.board;
    *solution = saved.solution;
    *clues = saved.clues;
}

fn snapshot(board: &Board, solution: &Solution, clues: &[Clue]) -> Snapshot {
    Snapshot {
        board: board.clone(),
        solution: solution.clone(),
        clues: clues.to_vec(),
    }
}

fn adopt_solution(target: &mut Solution, source: Solution) {
    target.blacks = source.blacks;
    target.horizontal = source.horizontal;
    target.vertical = source.vertical;
}

fn black_neighbour(board: &Board, solution: &Solution, pos: Position) -> bool {
    (1..=4).any(|dir| {
        let d = DIRS[dir];
        let other = Position {
            x: pos.x + d.x,
            y: pos.y + d.y,
        };
        board.in_board(other) && solution.blacks.contains(&to_id(other))
    })
}

fn refine_puzzle(
    board: &mut Board,
    solution: &mut Solution,
    clues: &mut Vec<Clue>,
    rng: &mut Rng,
    rounds: i32,
    max_nodes: i32,
) {
    let mut best = technique_work(&run_all(board, None, SolveOptions::default()));
    for _ in 0..rounds {
        if clues.is_empty() {
            return;
        }
        let saved = snapshot(board, solution, clues);
        let clue = clues[rng.next_int(clues.len())];
        if rng.next_int(2) == 0 {
            let dirs = directions_by_reach(board, clue.pos, rng);
            let dir = dirs[rng.next_int(dirs.len())];
            board.cell[clue.index].qdir = dir;
            refresh_counts(board, solution, clues);
        } else {
            if black_neighbour(board, solution, clue.pos) {
                continue;
            }
            demote(board, solution, clues, clue);
            let mut ids: Vec<_> = solution.blacks.iter().copied().collect();
            ids.sort();
            let all: Vec<_> = ids.into_iter().map(to_pos).collect();
            let near: Vec<_> = all
                .iter()
                .copied()
                .filter(|pos| (pos.x - clue.pos.x).abs() + (pos.y - clue.pos.y).abs() <= 3)
                .collect();
            let pool = if near.is_empty() { all } else { near };
            if pool.is_empty() {
                restore(board, solution, clues, saved);
                continue;
            }
            let target = pool[rng.next_int(pool.len())];
            let dir = choose_direction(board, solution, None, target, rng);
            promote(board, solution, clues, target, dir);
        }
        if !validate_solution(board, solution).is_empty()
            || !uniqueness(board, max_nodes).unique
        {
            restore(board, solution, clues, saved);
            continue;
        }
        let score = technique_work(&run_all(board, None, SolveOptions::default()));
        if score > best {
            best = score;
        } else {
            restore(board, solution, clues, saved);
        }
    }
}

fn steer_directions(
    board: &mut Board,
    solution: &Solution,
    clues: &[Clue],
    rng: &mut Rng,
    max_nodes: i32,
) -> bool {
    for _ in 0..clues.len() * 4 + 4 {
        let status = uniqueness(board, max_nodes);
        if status.aborted {
            return false;
        }
        if status.unique {
            return true;
        }
        let other = status.other.unwrap();
        let mut order = clues.to_vec();
        rng.shuffle(&mut order);
        let mut changed = false;
        for clue in order {
            let dir = choose_direction(board, solution, Some(&other), clue.pos, rng);
            if dir == board.cell[clue.index].qdir {
                continue;
            }
            let mine = count_blacks_along_arrow(board, solution, clue.pos, dir);
            let theirs = count_blacks_along_arrow(board, &other, clue.pos, dir);
            if mine == theirs {
                continue;
            }
            board.cell[clue.index].qdir = dir;
            refresh_counts(board, solution, clues);
            changed = true;
            break;
        }
        if !changed {
            return false;
        }
    }
    uniqueness(board, max_nodes).unique
}

struct LoopSlack {
    forced: bool,
    ambiguous: Vec<Position>,
}

fn loop_slack(board: &Board, solution: &Solution, max_nodes: i32) -> LoopSlack {
    let result = count_loop_routings(board, solution, 2, max_nodes);
    if result.aborted {
        return LoopSlack {
            forced: false,
            ambiguous: Vec::new(),
        };
    }
    if result.solutions.len() == 1 {
        return LoopSlack {
            forced: true,
            ambiguous: Vec::new(),
        };
    }
    let Some(rival) = result.solutions.get(1) else {
        return LoopSlack {
            forced: false,
            ambiguous: Vec::new(),
        };
    };
    let mut cells = std::collections::HashSet::new();
    let mut note = |id: i64, horizontal: bool| {
        let pos = to_pos(id);
        cells.insert(to_id(pos));
        let other = if horizontal {
            Position {
                x: pos.x + 1,
                y: pos.y,
            }
        } else {
            Position {
                x: pos.x,
                y: pos.y + 1,
            }
        };
        if board.in_board(other) {
            cells.insert(to_id(other));
        }
    };
    for &id in &solution.horizontal {
        if !rival.horizontal.contains(&id) {
            note(id, true);
        }
    }
    for &id in &rival.horizontal {
        if !solution.horizontal.contains(&id) {
            note(id, true);
        }
    }
    for &id in &solution.vertical {
        if !rival.vertical.contains(&id) {
            note(id, false);
        }
    }
    for &id in &rival.vertical {
        if !solution.vertical.contains(&id) {
            note(id, false);
        }
    }
    let mut ids: Vec<_> = cells.into_iter().collect();
    ids.sort();
    LoopSlack {
        forced: false,
        ambiguous: ids.into_iter().map(to_pos).collect(),
    }
}

fn relocate_clue(board: &mut Board, clues: &mut [Clue], clue_index: usize, to: Position) {
    let old_index = clues[clue_index].index;
    let dir = board.cell[old_index].qdir;
    board.cell[old_index].qdir = -1;
    board.cell[old_index].qnum = -1;
    let index = (to.y * board.cols + to.x) as usize;
    board.cell[index].qdir = dir;
    board.cell[index].qnum = 0;
    clues[clue_index].pos = to;
    clues[clue_index].index = index;
}

fn is_clue_cell(board: &Board, pos: Position) -> bool {
    board.cell[(pos.y * board.cols + pos.x) as usize].qnum != -1
}

/// The cells a position maps to under a symmetry, deduplicated and inside the board.
fn orbit_of(
    cols: i32,
    rows: i32,
    symmetry: Symmetry,
    pos: Position,
) -> Vec<Position> {
    let x = pos.x;
    let y = pos.y;
    let raw = match symmetry {
        Symmetry::Rot2 => vec![
            pos,
            Position {
                x: cols - 1 - x,
                y: rows - 1 - y,
            },
        ],
        Symmetry::Rot4 => vec![
            pos,
            Position {
                x: cols - 1 - y,
                y: x,
            },
            Position {
                x: cols - 1 - x,
                y: rows - 1 - y,
            },
            Position {
                x: y,
                y: rows - 1 - x,
            },
        ],
        Symmetry::MirrorH => vec![
            pos,
            Position {
                x: cols - 1 - x,
                y,
            },
        ],
        Symmetry::MirrorV => vec![
            pos,
            Position {
                x,
                y: rows - 1 - y,
            },
        ],
        Symmetry::None => vec![pos],
    };
    let mut cells = Vec::new();
    for cell in raw {
        if cell.x < 0
            || cell.x >= cols
            || cell.y < 0
            || cell.y >= rows
            || cells.contains(&cell)
        {
            continue;
        }
        cells.push(cell);
    }
    cells
}

const ANNEAL_START_THRESHOLD: i32 = 6;
const ANNEAL_REHEAT_AFTER: i32 = 60;
const ANNEAL_GIVE_UP: i32 = 240;
const ANNEAL_CHECK_EVERY: i32 = 25;

fn anneal_clues(
    board: &mut Board,
    answer: &mut Solution,
    clues: &mut Vec<Clue>,
    rng: &mut Rng,
    rounds: i32,
    max_nodes: i32,
    black_bias: i32,
    // move_positions: whether clues may move. Pattern mode fixes the positions by
    // definition, so there only the aiming moves are available.
    // vary_clue_count: whether the annealing may add and remove clues as well.
    move_positions: bool,
    vary_clue_count: bool,
    // Pattern mode only. Whole symmetry orbits may be relocated together.
    orbit_symmetry: Option<Symmetry>,
) -> bool {
    if clues.is_empty() || rounds <= 0 {
        return uniqueness(board, max_nodes).unique;
    }
    // Bounds for the add/remove moves, relative to where phase 1 left off.
    let clue_ceiling = clues.len() + std::cmp::max(2, clues.len().div_ceil(2));
    let clue_floor = std::cmp::max(1, clues.len() / 2);
    let mut analysis = analyse_propagation(board);
    let mut current = analysis.coverage;
    let mut best = current;
    if uniqueness(board, max_nodes).unique {
        return true;
    }
    let mut since_improvement = 0;
    for round in 0..rounds {
        let mut threshold = ANNEAL_START_THRESHOLD * (rounds - round) / rounds;
        if since_improvement > ANNEAL_GIVE_UP {
            break;
        }
        if since_improvement > ANNEAL_REHEAT_AFTER {
            threshold = ANNEAL_START_THRESHOLD;
            since_improvement = 0;
        }
        since_improvement += 1;
        if round > 0
            && round % ANNEAL_CHECK_EVERY == 0
            && uniqueness(board, max_nodes).unique
        {
            return true;
        }

        let saved = snapshot(board, answer, clues);
        let clue_at = rng.next_int(clues.len());
        let clue = clues[clue_at];
        // Moves 5 and 6 change how many clues there are, which phase 1 otherwise fixes
        // from the board area and never revisits. They are opt-in: measured over the same
        // seeds they bought roughly 50% more difficulty for 35-45% more time.
        let move_kind = if move_positions {
            rng.next_int(if vary_clue_count { 7 } else { 5 })
        } else if orbit_symmetry.is_some() && rng.next_int(3) == 0 {
            7
        } else {
            1 + 2 * rng.next_int(2)
        };
        let relocates = move_kind != 1 && move_kind != 3;

        if move_kind == 0 {
            let delta = DIRS[1 + rng.next_int(4)];
            let to = Position {
                x: clue.pos.x + delta.x,
                y: clue.pos.y + delta.y,
            };
            if !board.in_board(to) || is_clue_cell(board, to) {
                continue;
            }
            relocate_clue(board, clues, clue_at, to);
        } else if move_kind == 1 {
            let directions = directions_by_reach(board, clue.pos, rng);
            board.cell[clue.index].qdir = directions[rng.next_int(directions.len())];
        } else if move_kind == 2 {
            let mut blacks: Vec<_> = answer.blacks.iter().copied().collect();
            blacks.sort();
            if blacks.is_empty() {
                continue;
            }
            let target = to_pos(blacks[rng.next_int(blacks.len())]);
            relocate_clue(board, clues, clue_at, target);
        } else if move_kind == 3 {
            if analysis.undetermined.is_empty() {
                continue;
            }
            let open_cells: std::collections::HashSet<_> =
                analysis.undetermined.iter().copied().collect();
            let mut best_dir = 0;
            let mut best_seen = -1;
            for dir in directions_by_reach(board, clue.pos, rng) {
                let delta = DIRS[dir as usize];
                let mut x = clue.pos.x + delta.x;
                let mut y = clue.pos.y + delta.y;
                let mut seen = 0;
                while board.in_board(Position { x, y }) {
                    if open_cells.contains(&((y * board.cols + x) as usize)) {
                        seen += 1;
                    }
                    x += delta.x;
                    y += delta.y;
                }
                if seen > best_seen {
                    best_seen = seen;
                    best_dir = dir;
                }
            }
            if best_dir == 0 || best_dir == board.cell[clue.index].qdir {
                continue;
            }
            board.cell[clue.index].qdir = best_dir;
        } else if move_kind == 5 {
            // Add a clue on one of the answer's black cells.
            if clues.len() >= clue_ceiling {
                continue;
            }
            let mut blacks: Vec<_> = answer.blacks.iter().copied().collect();
            blacks.sort();
            if blacks.is_empty() {
                continue;
            }
            let pos = to_pos(blacks[rng.next_int(blacks.len())]);
            let dir = choose_direction(board, answer, None, pos, rng);
            promote(board, answer, clues, pos, dir);
        } else if move_kind == 7 {
            // Relocate this clue's whole orbit onto a free orbit elsewhere.
            let from = orbit_of(board.cols, board.rows, orbit_symmetry.unwrap(), clue.pos);
            let target_x = rng.next_int(board.cols as usize) as i32;
            let target_y = rng.next_int(board.rows as usize) as i32;
            let target = orbit_of(
                board.cols,
                board.rows,
                orbit_symmetry.unwrap(),
                Position {
                    x: target_x,
                    y: target_y,
                },
            );
            if target.len() != from.len() {
                continue;
            }
            if target
                .iter()
                .any(|&pos| is_clue_cell(board, pos) && !from.contains(&pos))
            {
                continue;
            }
            let moved: Vec<_> = from
                .iter()
                .map(|pos| clues.iter().position(|clue| clue.pos == *pos))
                .collect();
            if moved.iter().any(|clue| clue.is_none()) {
                continue;
            }
            for clue_at in moved.iter().flatten() {
                let index = clues[*clue_at].index;
                board.cell[index].qnum = -1;
                board.cell[index].qdir = -1;
            }
            for (at, clue_at) in moved.into_iter().enumerate() {
                let clue_at = clue_at.unwrap();
                let to = target[at];
                let index = (to.y * board.cols + to.x) as usize;
                board.cell[index].qdir = 1;
                board.cell[index].qnum = 0;
                clues[clue_at].pos = to;
                clues[clue_at].index = index;
            }
        } else if move_kind == 6 {
            // Drop a clue, turning it back into a black cell. Only safe where that would
            // not put two black cells side by side.
            if clues.len() <= clue_floor || black_neighbour(board, answer, clue.pos) {
                continue;
            }
            demote(board, answer, clues, clue);
        } else {
            if analysis.undetermined.is_empty() {
                continue;
            }
            let focus = analysis.undetermined[rng.next_int(analysis.undetermined.len())];
            let fx = focus as i32 % board.cols;
            let fy = focus as i32 / board.cols;
            let mut blacks: Vec<_> = answer.blacks.iter().copied().collect();
            blacks.sort();
            if blacks.is_empty() {
                continue;
            }
            let mut target = to_pos(blacks[0]);
            let mut best_distance = i32::MAX;
            for id in blacks {
                let pos = to_pos(id);
                let distance = (pos.x - fx).abs() + (pos.y - fy).abs();
                if distance < best_distance {
                    best_distance = distance;
                    target = pos;
                }
            }
            relocate_clue(board, clues, clue_at, target);
        }

        if relocates {
            let Some(next) = draw_solution(
                board,
                rng,
                max_nodes,
                black_bias,
                REDRAW_RESTARTS,
            ) else {
                restore(board, answer, clues, saved);
                continue;
            };
            adopt_solution(answer, next);
        }
        refresh_counts(board, answer, clues);
        let candidate = analyse_propagation(board);
        if candidate.coverage < 0 || candidate.coverage < current - threshold {
            restore(board, answer, clues, saved);
            continue;
        }
        analysis = candidate;
        current = analysis.coverage;
        if current > best {
            best = current;
            since_improvement = 0;
            if uniqueness(board, max_nodes).unique {
                return true;
            }
        }
    }
    uniqueness(board, max_nodes).unique
}

fn finish(
    mut board: Board,
    mut solution: Solution,
    rng: &mut Rng,
    mut clues: Vec<Clue>,
    options: &GenerateOptions,
    attempts: i32,
    allow_reduce: bool,
) -> Option<Generated> {
    if !validate_solution(&board, &solution).is_empty() {
        return None;
    }
    if allow_reduce && options.reduce {
        reduce_clues(
            &mut board,
            &mut solution,
            &mut clues,
            rng,
            options.max_nodes,
        );
    }
    if options.weaken {
        weaken_clues(
            &mut board,
            &solution,
            &clues,
            rng,
            options.max_nodes,
        );
    }
    if options.refine > 0 {
        refine_puzzle(
            &mut board,
            &mut solution,
            &mut clues,
            rng,
            options.refine,
            options.max_nodes,
        );
    }
    if !uniqueness(&board, options.max_nodes).unique {
        return None;
    }
    let outcome = run_all(&board, None, SolveOptions::default());
    let score = difficulty(&outcome, &board);
    if options.dp_min.is_some_and(|min| score < min)
        || options.dp_max.is_some_and(|max| score > max)
    {
        return None;
    }
    Some(Generated {
        board,
        solution,
        outcome,
        difficulty: score,
        attempts,
    })
}

fn clue_target(options: &GenerateOptions) -> usize {
    options.clues.unwrap_or_else(|| {
        (((options.cols * options.rows) as f64 * options.clue_ratio + 0.5).floor() as usize)
            .max(1)
    })
}

pub fn generate_loop(rng: &mut Rng, options: &GenerateOptions) -> Option<Generated> {
    let clue_limit = clue_target(options);
    let mut attempt = 1;
    while options.attempts == 0 || attempt <= options.attempts {
        let mut board = create_board(options.cols, options.rows);
        let Some(mut answer) =
            find_initial_solution(&board, rng, options.max_nodes, options.black_bias)
        else {
            attempt += 1;
            continue;
        };
        let mut clues = Vec::new();
        let mut failed = false;
        let mut rejections = 0;
        let mut batch_cap = clue_limit;
        while clues.len() < clue_limit {
            let remaining = clue_limit - clues.len();
            let mut ids: Vec<_> = answer.blacks.iter().copied().collect();
            ids.sort();
            let mut candidates: Vec<_> = ids.into_iter().map(to_pos).collect();
            let batch = remaining
                .div_ceil(2)
                .min(candidates.len().div_ceil(2))
                .min(batch_cap)
                .max(1);
            rng.shuffle(&mut candidates);
            let chosen: Vec<_> = candidates
                .into_iter()
                .take(batch.min(remaining))
                .collect();
            if chosen.is_empty() {
                failed = true;
                break;
            }
            let saved = snapshot(&board, &answer, &clues);
            for &pos in &chosen {
                let dir = choose_direction(&board, &answer, None, pos, rng);
                promote(&mut board, &mut answer, &mut clues, pos, dir);
            }
            let next = draw_solution(
                &board,
                rng,
                options.max_nodes,
                options.black_bias,
                REDRAW_RESTARTS,
            );
            let Some(next) = next else {
                restore(&mut board, &mut answer, &mut clues, saved);
                rejections += 1;
                batch_cap = (chosen.len() / 2).max(1);
                if rejections > PROMOTION_REJECTIONS {
                    failed = true;
                    break;
                }
                continue;
            };
            answer = next;
            refresh_counts(&mut board, &answer, &clues);
        }
        if failed {
            attempt += 1;
            continue;
        }

        let mut unique = false;
        let clue_ceiling = clue_limit + 2.max(clue_limit.div_ceil(2));
        for _ in 0..=REPAIR_ROUNDS {
            let slack = loop_slack(&board, &answer, options.max_nodes);
            if slack.forced {
                if steer_directions(&mut board, &answer, &clues, rng, options.max_nodes) {
                    unique = true;
                    break;
                }
                let Some(next) = draw_solution(
                    &board,
                    rng,
                    options.max_nodes,
                    options.black_bias,
                    REDRAW_RESTARTS,
                ) else {
                    break;
                };
                answer = next;
                refresh_counts(&mut board, &answer, &clues);
                continue;
            }

            if slack.ambiguous.is_empty() || clues.len() >= clue_ceiling {
                break;
            }
            let mut targets = slack.ambiguous;
            rng.shuffle(&mut targets);
            let mut planted = false;
            for target in targets {
                let saved = snapshot(&board, &answer, &clues);
                let dir = choose_direction(&board, &answer, None, target, rng);
                promote(&mut board, &mut answer, &mut clues, target, dir);
                if let Some(next) = draw_solution(
                    &board,
                    rng,
                    options.max_nodes,
                    options.black_bias,
                    REDRAW_RESTARTS,
                ) {
                    answer = next;
                    refresh_counts(&mut board, &answer, &clues);
                    planted = true;
                    break;
                }
                restore(&mut board, &mut answer, &mut clues, saved);
            }
            if !planted {
                break;
            }
        }
        if !unique {
            let rounds = options
                .anneal
                .unwrap_or_else(|| anneal_rounds_for(options.cols, options.rows));
            unique = anneal_clues(
                &mut board,
                &mut answer,
                &mut clues,
                rng,
                rounds,
                options.max_nodes,
                options.black_bias,
                true,
                options.vary_clue_count,
                None,
            );
        }
        if !unique {
            attempt += 1;
            continue;
        }
        if let Some(result) = finish(board, answer, rng, clues, options, attempt, true) {
            return Some(result);
        }
        attempt += 1;
    }
    None
}

pub fn build_pattern(
    cols: i32,
    rows: i32,
    count: usize,
    symmetry: Symmetry,
    rng: &mut Rng,
) -> Vec<bool> {
    let mut pattern = vec![false; (cols * rows) as usize];
    let mut placed = 0;
    let mut guard = cols * rows * 20;
    while placed < count && guard > 0 {
        guard -= 1;
        let x = rng.next_int(cols as usize) as i32;
        let y = rng.next_int(rows as usize) as i32;
        let orbit = match symmetry {
            Symmetry::Rot2 => vec![
                Position { x, y },
                Position {
                    x: cols - 1 - x,
                    y: rows - 1 - y,
                },
            ],
            Symmetry::Rot4 => vec![
                Position { x, y },
                Position {
                    x: cols - 1 - y,
                    y: x,
                },
                Position {
                    x: cols - 1 - x,
                    y: rows - 1 - y,
                },
                Position {
                    x: y,
                    y: rows - 1 - x,
                },
            ],
            Symmetry::MirrorH => vec![
                Position { x, y },
                Position {
                    x: cols - 1 - x,
                    y,
                },
            ],
            Symmetry::MirrorV => vec![
                Position { x, y },
                Position {
                    x,
                    y: rows - 1 - y,
                },
            ],
            Symmetry::None => vec![Position { x, y }],
        };
        let mut cells = Vec::new();
        for pos in orbit {
            if pos.x < 0
                || pos.x >= cols
                || pos.y < 0
                || pos.y >= rows
                || cells.contains(&pos)
            {
                continue;
            }
            cells.push(pos);
        }
        if cells
            .iter()
            .any(|p| pattern[(p.y * cols + p.x) as usize])
            || placed + cells.len() > count
        {
            continue;
        }
        for pos in cells {
            pattern[(pos.y * cols + pos.x) as usize] = true;
            placed += 1;
        }
    }
    pattern
}

pub fn generate_pattern(rng: &mut Rng, options: &GenerateOptions) -> Option<Generated> {
    let target = clue_target(options);
    let mut draws = 0;
    let mut attempt = 1;
    while options.attempts == 0 || attempt <= options.attempts {
        let pattern = options.pattern.clone().unwrap_or_else(|| {
            build_pattern(
                options.cols,
                options.rows,
                target,
                options.symmetry,
                rng,
            )
        });
        let mut board = create_board(options.cols, options.rows);
        let mut clues = Vec::new();
        for (index, flag) in pattern.into_iter().enumerate() {
            if flag {
                let pos = Position {
                    x: index as i32 % options.cols,
                    y: index as i32 / options.cols,
                };
                clues.push(Clue { pos, index });
                board.cell[index].qdir = 1;
                board.cell[index].qnum = -2;
            }
        }
        if clues.is_empty() {
            attempt += 1;
            continue;
        }
        let Some(mut answer) =
            find_initial_solution(&board, rng, options.max_nodes, options.black_bias)
        else {
            if options.pattern.is_none() && draws < PATTERN_DRAWS {
                draws += 1;
                continue;
            }
            draws = 0;
            attempt += 1;
            continue;
        };
        draws = 0;
        for clue in &clues {
            board.cell[clue.index].qdir =
                choose_direction(&board, &answer, None, clue.pos, rng);
        }
        refresh_counts(&mut board, &answer, &clues);
        if !steer_directions(&mut board, &answer, &clues, rng, options.max_nodes) {
            // Same fallback loop mode gets, restricted to re-aiming: the clue positions
            // belong to the pattern and must not move. Without this, pattern mode simply
            // gave up here, which made it the weaker of the two modes at every size.
            let rounds = options
                .anneal
                .unwrap_or_else(|| anneal_rounds_for(options.cols, options.rows));
            if !anneal_clues(
                &mut board,
                &mut answer,
                &mut clues,
                rng,
                rounds,
                options.max_nodes,
                options.black_bias,
                false,
                false,
                if options.pattern.is_none() {
                    Some(options.symmetry)
                } else {
                    None
                },
            ) {
                attempt += 1;
                continue;
            }
        }
        if let Some(result) = finish(board, answer, rng, clues, options, attempt, false) {
            return Some(result);
        }
        attempt += 1;
    }
    None
}

impl Default for GenerateOptions {
    fn default() -> Self {
        Self {
            cols: 10,
            rows: 10,
            clues: None,
            clue_ratio: 0.16,
            attempts: 100,
            dp_min: None,
            dp_max: None,
            max_nodes: 200_000,
            weaken: true,
            reduce: true,
            vary_clue_count: false,
            symmetry: Symmetry::Rot2,
            pattern: None,
            black_bias: 850,
            refine: 0,
            anneal: None,
        }
    }
}
