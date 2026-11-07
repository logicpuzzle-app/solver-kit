use crate::board::{to_id, Board};
use crate::position::{Position, DIRS};
use crate::solution::Solution;

pub const CELL_UNKNOWN: i8 = 0;
pub const CELL_BLACK: i8 = 1;
pub const CELL_LINE: i8 = 2;
pub const CELL_BLOCKED: i8 = 3;
pub const EDGE_UNKNOWN: i8 = 0;
pub const EDGE_LINE: i8 = 1;
pub const EDGE_BLANK: i8 = 2;

const TRAIL_CELL: i32 = 0;
const TRAIL_EDGE: i32 = 1;
const TRAIL_LINE_COUNT: i32 = 2;
const TRAIL_BLANK_COUNT: i32 = 3;
const TRAIL_PARENT: i32 = 4;
const TRAIL_SIZE: i32 = 5;

#[derive(Clone, Debug)]
pub struct Clue {
    pub count: i32,
    pub ray: Vec<i32>,
}

pub struct Engine {
    pub cols: i32,
    pub rows: i32,
    pub cell_count: usize,
    pub edge_count: usize,
    pub h_count: usize,
    pub cell: Vec<i8>,
    pub edge: Vec<i8>,
    pub line_count: Vec<i8>,
    pub blank_count: Vec<i8>,
    pub incident: Vec<i32>,
    pub edge_cells: Vec<i32>,
    pub neighbours: Vec<i32>,
    pub parent: Vec<i32>,
    pub size: Vec<i32>,
    pub unknown_cells: i32,
    pub line_cells: i32,
    pub contradiction: bool,
    pub loop_closed: bool,
    pub loop_root: i32,
    pub clues: Vec<Clue>,
    trail: Vec<i32>,
    forced: Vec<i32>,
    cell_queue: Vec<i32>,
    in_cell_queue: Vec<u8>,
    clue_queue: Vec<i32>,
    in_clue_queue: Vec<u8>,
    clue_of_cell_start: Vec<i32>,
    clue_of_cell_data: Vec<i32>,
    /// Edge ids grouped by the grid line they cross: vertical edges for a horizontal cut,
    /// horizontal edges for a vertical one.
    cuts: Vec<Vec<i32>>,
    /// Scratch state for the connectivity check; stamped per call instead of cleared.
    visit_stamp: Vec<i32>,
    visit_generation: i32,
    dfs_stack: Vec<i32>,
}

#[derive(Clone, Debug)]
pub struct Mark {
    trail: usize,
    unknown_cells: i32,
    line_cells: i32,
    contradiction: bool,
    loop_closed: bool,
    loop_root: i32,
}

fn h_index(cols: i32, x: i32, y: i32) -> i32 {
    y * (cols - 1) + x
}
fn v_index(cols: i32, h_count: usize, x: i32, y: i32) -> i32 {
    h_count as i32 + y * cols + x
}

pub fn create_engine(board: &Board) -> Engine {
    let cols = board.cols;
    let rows = board.rows;
    let cell_count = (cols * rows) as usize;
    let h_count = (rows * (cols - 1).max(0)) as usize;
    let edge_count = h_count + ((rows - 1).max(0) * cols) as usize;
    let mut e = Engine {
        cols,
        rows,
        cell_count,
        edge_count,
        h_count,
        cell: vec![0; cell_count],
        edge: vec![0; edge_count],
        line_count: vec![0; cell_count],
        blank_count: vec![0; cell_count],
        incident: vec![-1; cell_count * 4],
        edge_cells: vec![0; edge_count * 2],
        neighbours: vec![-1; cell_count * 4],
        parent: (0..cell_count as i32).collect(),
        size: vec![1; cell_count],
        unknown_cells: cell_count as i32,
        line_cells: 0,
        contradiction: false,
        loop_closed: false,
        loop_root: -1,
        clues: Vec::new(),
        trail: Vec::new(),
        forced: Vec::new(),
        cell_queue: Vec::new(),
        in_cell_queue: vec![0; cell_count],
        clue_queue: Vec::new(),
        in_clue_queue: Vec::new(),
        clue_of_cell_start: vec![0; cell_count + 1],
        clue_of_cell_data: Vec::new(),
        cuts: Vec::new(),
        visit_stamp: vec![0; cell_count],
        visit_generation: 0,
        dfs_stack: Vec::new(),
    };
    for i in 0..cell_count {
        let x = i as i32 % cols;
        let y = i as i32 / cols;
        let inc = [
            if y > 0 {
                v_index(cols, h_count, x, y - 1)
            } else {
                -1
            },
            if y < rows - 1 {
                v_index(cols, h_count, x, y)
            } else {
                -1
            },
            if x > 0 { h_index(cols, x - 1, y) } else { -1 },
            if x < cols - 1 {
                h_index(cols, x, y)
            } else {
                -1
            },
        ];
        let nei = [
            if y > 0 { i as i32 - cols } else { -1 },
            if y < rows - 1 {
                i as i32 + cols
            } else {
                -1
            },
            if x > 0 { i as i32 - 1 } else { -1 },
            if x < cols - 1 { i as i32 + 1 } else { -1 },
        ];
        e.incident[i * 4..i * 4 + 4].copy_from_slice(&inc);
        e.neighbours[i * 4..i * 4 + 4].copy_from_slice(&nei);
        e.blank_count[i] = inc.iter().filter(|&&v| v < 0).count() as i8;
    }
    for y in 0..rows {
        for x in 0..cols - 1 {
            let edge = h_index(cols, x, y) as usize;
            e.edge_cells[edge * 2] = y * cols + x;
            e.edge_cells[edge * 2 + 1] = y * cols + x + 1;
        }
    }
    for y in 0..rows - 1 {
        for x in 0..cols {
            let edge = v_index(cols, h_count, x, y) as usize;
            e.edge_cells[edge * 2] = y * cols + x;
            e.edge_cells[edge * 2 + 1] = (y + 1) * cols + x;
        }
    }
    for i in 0..cell_count {
        let cell = board.cell[i];
        if cell.qnum != -1 {
            set_cell(&mut e, i as i32, CELL_BLOCKED);
        }
        if (1..=4).contains(&cell.qdir) && cell.qnum >= 0 {
            let delta = DIRS[cell.qdir as usize];
            let mut x = i as i32 % cols + delta.x;
            let mut y = i as i32 / cols + delta.y;
            let mut ray = Vec::new();
            while x >= 0 && x < cols && y >= 0 && y < rows {
                ray.push(y * cols + x);
                x += delta.x;
                y += delta.y;
            }
            e.clues.push(Clue {
                count: cell.qnum,
                ray,
            });
        }
    }
    e.in_clue_queue = vec![0; e.clues.len()];
    let mut counts = vec![0; cell_count];
    for clue in &e.clues {
        for &cell in &clue.ray {
            counts[cell as usize] += 1;
        }
    }
    let mut running = 0;
    for (i, count) in counts.iter().enumerate() {
        e.clue_of_cell_start[i] = running;
        running += count;
    }
    e.clue_of_cell_start[cell_count] = running;
    // Grid lines, for the parity rule. A horizontal cut between rows y and y+1 is crossed
    // by the vertical edges of row y; a vertical cut between columns x and x+1 by the
    // horizontal edges of column x.
    for y in 0..rows - 1 {
        let mut cut = Vec::with_capacity(cols as usize);
        for x in 0..cols {
            cut.push(v_index(cols, h_count, x, y));
        }
        e.cuts.push(cut);
    }
    for x in 0..cols - 1 {
        let mut cut = Vec::with_capacity(rows as usize);
        for y in 0..rows {
            cut.push(h_index(cols, x, y));
        }
        e.cuts.push(cut);
    }

    e.clue_of_cell_data = vec![0; running as usize];
    let mut cursor = e.clue_of_cell_start[..cell_count].to_vec();
    for (ci, clue) in e.clues.iter().enumerate() {
        for &cell in &clue.ray {
            let at = cursor[cell as usize] as usize;
            e.clue_of_cell_data[at] = ci as i32;
            cursor[cell as usize] += 1;
        }
    }
    e.trail.clear();
    for i in 0..cell_count {
        enqueue_cell(&mut e, i as i32);
    }
    for i in 0..e.clues.len() {
        enqueue_clue(&mut e, i as i32);
    }
    e
}

fn enqueue_cell(e: &mut Engine, i: i32) {
    if i >= 0 && e.in_cell_queue[i as usize] == 0 {
        e.in_cell_queue[i as usize] = 1;
        e.cell_queue.push(i);
    }
}
fn enqueue_clue(e: &mut Engine, c: i32) {
    if e.in_clue_queue[c as usize] == 0 {
        e.in_clue_queue[c as usize] = 1;
        e.clue_queue.push(c);
    }
}
fn enqueue_clues_of(e: &mut Engine, i: i32) {
    let start = e.clue_of_cell_start[i as usize] as usize;
    let end = e.clue_of_cell_start[i as usize + 1] as usize;
    for k in start..end {
        let clue = e.clue_of_cell_data[k];
        enqueue_clue(e, clue);
    }
}

pub fn mark(e: &Engine) -> Mark {
    Mark {
        trail: e.trail.len(),
        unknown_cells: e.unknown_cells,
        line_cells: e.line_cells,
        contradiction: e.contradiction,
        loop_closed: e.loop_closed,
        loop_root: e.loop_root,
    }
}
pub fn remark(e: &Engine, saved: &mut Mark) {
    *saved = mark(e);
}
pub fn undo(e: &mut Engine, saved: &Mark) {
    let mut i = e.trail.len();
    while i > saved.trail {
        i -= 3;
        let kind = e.trail[i];
        let index = e.trail[i + 1] as usize;
        let value = e.trail[i + 2];
        match kind {
            TRAIL_CELL => e.cell[index] = value as i8,
            TRAIL_EDGE => e.edge[index] = value as i8,
            TRAIL_LINE_COUNT => e.line_count[index] = value as i8,
            TRAIL_BLANK_COUNT => e.blank_count[index] = value as i8,
            TRAIL_PARENT => e.parent[index] = value,
            _ => e.size[index] = value,
        }
    }
    e.trail.truncate(saved.trail);
    e.unknown_cells = saved.unknown_cells;
    e.line_cells = saved.line_cells;
    e.contradiction = saved.contradiction;
    e.loop_closed = saved.loop_closed;
    e.loop_root = saved.loop_root;
}
fn find(e: &Engine, a: i32) -> i32 {
    let mut root = a;
    while e.parent[root as usize] != root {
        root = e.parent[root as usize];
    }
    root
}
fn unite(e: &mut Engine, a: i32, b: i32) {
    let ra = find(e, a);
    let rb = find(e, b);
    if ra == rb {
        e.loop_closed = true;
        e.loop_root = ra;
        return;
    }
    let (large, small) = if e.size[ra as usize] < e.size[rb as usize] {
        (rb, ra)
    } else {
        (ra, rb)
    };
    e.trail
        .extend([TRAIL_PARENT, small, e.parent[small as usize]]);
    e.trail
        .extend([TRAIL_SIZE, large, e.size[large as usize]]);
    e.parent[small as usize] = large;
    e.size[large as usize] += e.size[small as usize];
}

pub fn set_edge(e: &mut Engine, edge: i32, value: i8) {
    if e.contradiction || edge < 0 {
        return;
    }
    let at = edge as usize;
    let current = e.edge[at];
    if current == value {
        return;
    }
    if current != EDGE_UNKNOWN {
        e.contradiction = true;
        return;
    }
    e.trail.extend([TRAIL_EDGE, edge, current as i32]);
    e.edge[at] = value;
    let a = e.edge_cells[at * 2];
    let b = e.edge_cells[at * 2 + 1];
    enqueue_cell(e, a);
    enqueue_cell(e, b);
    if value == EDGE_LINE {
        e.trail
            .extend([TRAIL_LINE_COUNT, a, e.line_count[a as usize] as i32]);
        e.trail
            .extend([TRAIL_LINE_COUNT, b, e.line_count[b as usize] as i32]);
        e.line_count[a as usize] += 1;
        e.line_count[b as usize] += 1;
        set_cell(e, a, CELL_LINE);
        set_cell(e, b, CELL_LINE);
        if !e.contradiction {
            unite(e, a, b);
        }
    } else {
        e.trail.extend([
            TRAIL_BLANK_COUNT,
            a,
            e.blank_count[a as usize] as i32,
        ]);
        e.trail.extend([
            TRAIL_BLANK_COUNT,
            b,
            e.blank_count[b as usize] as i32,
        ]);
        e.blank_count[a as usize] += 1;
        e.blank_count[b as usize] += 1;
    }
}

pub fn set_cell(e: &mut Engine, cell: i32, value: i8) {
    if e.contradiction || cell < 0 {
        return;
    }
    let at = cell as usize;
    let current = e.cell[at];
    if current == value {
        return;
    }
    if current != CELL_UNKNOWN {
        e.contradiction = true;
        return;
    }
    e.trail.extend([TRAIL_CELL, cell, current as i32]);
    e.cell[at] = value;
    e.unknown_cells -= 1;
    enqueue_cell(e, cell);
    enqueue_clues_of(e, cell);
    if value == CELL_BLACK || value == CELL_BLOCKED {
        for d in 0..4 {
            set_edge(e, e.incident[at * 4 + d], EDGE_BLANK);
        }
    }
    if value == CELL_BLACK {
        for d in 0..4 {
            let other = e.neighbours[at * 4 + d];
            if other < 0 {
                continue;
            }
            if e.cell[other as usize] == CELL_BLACK {
                e.contradiction = true;
                return;
            }
            if e.cell[other as usize] == CELL_UNKNOWN {
                set_cell(e, other, CELL_LINE);
                if e.contradiction {
                    return;
                }
            }
        }
    } else if value == CELL_LINE {
        e.line_cells += 1;
    }
}

fn propagate_cell(e: &mut Engine, cell: i32) {
    let at = cell as usize;
    let state = e.cell[at];
    if state == CELL_BLACK || state == CELL_BLOCKED {
        return;
    }
    let available = 4 - e.blank_count[at];
    let lines = e.line_count[at];
    if state == CELL_LINE {
        if lines > 2 || available < 2 {
            e.contradiction = true;
        } else if lines == 2 {
            for d in 0..4 {
                let edge = e.incident[at * 4 + d];
                if edge >= 0 && e.edge[edge as usize] == EDGE_UNKNOWN {
                    set_edge(e, edge, EDGE_BLANK);
                }
            }
        } else if available == 2 {
            for d in 0..4 {
                let edge = e.incident[at * 4 + d];
                if edge >= 0 && e.edge[edge as usize] == EDGE_UNKNOWN {
                    set_edge(e, edge, EDGE_LINE);
                }
            }
        }
    } else if lines > 0 {
        set_cell(e, cell, CELL_LINE);
    } else if available < 2 {
        set_cell(e, cell, CELL_BLACK);
    }
}

fn propagate_clue(e: &mut Engine, clue_index: i32) {
    let clue = e.clues[clue_index as usize].clone();
    let mut known = 0;
    let mut capacity = 0;
    let mut run = 0;
    for &cell in &clue.ray {
        match e.cell[cell as usize] {
            CELL_BLACK => {
                known += 1;
                capacity += (run + 1) >> 1;
                run = 0;
            }
            CELL_UNKNOWN => run += 1,
            _ => {
                capacity += (run + 1) >> 1;
                run = 0;
            }
        }
    }
    capacity += (run + 1) >> 1;
    if known > clue.count || known + capacity < clue.count {
        e.contradiction = true;
        return;
    }
    if known == clue.count {
        for cell in clue.ray {
            if e.cell[cell as usize] == CELL_UNKNOWN {
                set_cell(e, cell, CELL_LINE);
                if e.contradiction {
                    return;
                }
            }
        }
    } else if known + capacity == clue.count {
        e.forced.clear();
        let mut start: i32 = -1;
        for k in 0..=clue.ray.len() {
            let in_run = k < clue.ray.len() && e.cell[clue.ray[k] as usize] == CELL_UNKNOWN;
            if in_run && start < 0 {
                start = k as i32;
            } else if !in_run && start >= 0 {
                let length = k as i32 - start;
                if length % 2 == 1 {
                    for offset in (0..length).step_by(2) {
                        e.forced.push(clue.ray[(start + offset) as usize]);
                    }
                }
                start = -1;
            }
        }
        let forced = e.forced.clone();
        for cell in forced {
            set_cell(e, cell, CELL_BLACK);
            if e.contradiction {
                return;
            }
        }
    }
}

fn drain(e: &mut Engine) {
    e.cell_queue.clear();
    e.in_cell_queue.fill(0);
    e.clue_queue.clear();
    e.in_clue_queue.fill(0);
}

/// The finished loop is one connected component, so every cell already committed to the
/// loop has to stay mutually reachable through cells that can still carry it. Two line
/// fragments walled off from each other by black and blocked cells can never be joined,
/// and noticing that here prunes the search far earlier than waiting for a loop to close.
///
/// Returns false on contradiction. Traversal crosses any edge that is not blank, into any
/// cell that is Line or still Unknown.
fn check_connectivity(e: &mut Engine) -> bool {
    if e.line_cells == 0 {
        return true;
    }
    let mut start = -1i32;
    for i in 0..e.cell_count {
        if e.cell[i] == CELL_LINE {
            start = i as i32;
            break;
        }
    }
    if start < 0 {
        return true;
    }

    e.visit_generation += 1;
    let stamp = e.visit_generation;
    let mut stack = std::mem::take(&mut e.dfs_stack);
    stack.clear();
    stack.push(start);
    e.visit_stamp[start as usize] = stamp;
    let mut reached = 1i32;

    while let Some(i) = stack.pop() {
        for d in 0..4 {
            let edge = e.incident[i as usize * 4 + d];
            if edge < 0 || e.edge[edge as usize] == EDGE_BLANK {
                continue;
            }
            let j = e.neighbours[i as usize * 4 + d];
            if j < 0 || e.visit_stamp[j as usize] == stamp {
                continue;
            }
            let state = e.cell[j as usize];
            if state != CELL_LINE && state != CELL_UNKNOWN {
                continue;
            }
            e.visit_stamp[j as usize] = stamp;
            if state == CELL_LINE {
                reached += 1;
            }
            stack.push(j);
        }
    }

    e.dfs_stack = stack;
    reached == e.line_cells
}

/// The parity rule: a closed loop crosses any grid line an even number of times.
///
/// For each cut, count the edges already committed to the line. If none are left open the
/// count must be even, and if exactly one is open its state is decided outright. It is a
/// cheap sweep and it is what a solver of this puzzle notices first, which is why the
/// engine without it left roughly half of a finished board undecided.
/// Small-loop ban: an edge whose two ends already belong to the same line fragment would
/// close that fragment into a loop, which is only ever allowed for the final loop. As long
/// as line cells exist outside the fragment, the edge cannot be drawn.
///
/// The engine could already detect a premature closure, but only after the edge had been
/// committed; refusing it up front prunes the branch before the search enters it. Worth
/// between 1.1x and 2.5x on generation depending on the board.
fn propagate_small_loop_ban(e: &mut Engine) {
    for edge in 0..e.edge_count {
        if e.edge[edge] != EDGE_UNKNOWN {
            continue;
        }
        let a = e.edge_cells[edge * 2];
        let b = e.edge_cells[edge * 2 + 1];
        if e.cell[a as usize] != CELL_LINE || e.cell[b as usize] != CELL_LINE {
            continue;
        }
        let root = find(e, a);
        if root != find(e, b) {
            continue;
        }
        if e.size[root as usize] == e.line_cells {
            continue;
        }
        set_edge(e, edge as i32, EDGE_BLANK);
        if e.contradiction {
            return;
        }
    }
}

fn propagate_parity(e: &mut Engine) {
    for cut_index in 0..e.cuts.len() {
        let mut lines = 0;
        let mut unknown = -1;
        let mut unknown_count = 0;
        for k in 0..e.cuts[cut_index].len() {
            let edge = e.cuts[cut_index][k];
            let state = e.edge[edge as usize];
            if state == EDGE_LINE {
                lines += 1;
            } else if state == EDGE_UNKNOWN {
                unknown = edge;
                unknown_count += 1;
                if unknown_count > 1 {
                    break;
                }
            }
        }
        if unknown_count == 0 {
            if lines % 2 == 1 {
                e.contradiction = true;
                return;
            }
        } else if unknown_count == 1 {
            let value = if lines % 2 == 1 { EDGE_LINE } else { EDGE_BLANK };
            set_edge(e, unknown, value);
            if e.contradiction {
                return;
            }
        }
    }
}

pub fn propagate_engine(e: &mut Engine) -> bool {
    loop {
        while !e.cell_queue.is_empty() || !e.clue_queue.is_empty() {
            while let Some(cell) = e.cell_queue.pop() {
                e.in_cell_queue[cell as usize] = 0;
                propagate_cell(e, cell);
                if e.contradiction {
                    drain(e);
                    return false;
                }
            }
            while let Some(clue) = e.clue_queue.pop() {
                e.in_clue_queue[clue as usize] = 0;
                propagate_clue(e, clue);
                if e.contradiction {
                    drain(e);
                    return false;
                }
                if !e.cell_queue.is_empty() {
                    break;
                }
            }
        }
        // Rectangle parity — the even-crossings argument applied to every rectangle
        // anchored at the top-left corner — was tried here and is out: sound, raises
        // coverage, but made 12x12 generation slower for the same success rate.
        let before_rules = e.trail.len();
        propagate_parity(e);
        if e.contradiction {
            drain(e);
            return false;
        }
        propagate_small_loop_ban(e);
        if e.contradiction {
            drain(e);
            return false;
        }
        if e.trail.len() != before_rules || !e.cell_queue.is_empty() {
            continue;
        }

        if !e.loop_closed {
            if !check_connectivity(e) {
                e.contradiction = true;
                drain(e);
                return false;
            }
            return true;
        }
        let before = e.unknown_cells;
        for i in 0..e.cell_count {
            if e.cell[i] == CELL_UNKNOWN {
                set_cell(e, i as i32, CELL_BLACK);
                if e.contradiction {
                    drain(e);
                    return false;
                }
            }
        }
        let root = find(e, e.loop_root);
        if e.size[root as usize] != e.line_cells {
            e.contradiction = true;
            drain(e);
            return false;
        }
        if before == e.unknown_cells && e.cell_queue.is_empty() {
            if !check_connectivity(e) {
                e.contradiction = true;
                drain(e);
                return false;
            }
            return true;
        }
    }
}

pub fn is_solved(e: &Engine) -> bool {
    if e.contradiction || e.unknown_cells > 0 || e.line_cells == 0 {
        return false;
    }
    for i in 0..e.cell_count {
        if e.cell[i] == CELL_LINE && e.line_count[i] != 2 {
            return false;
        }
    }
    let Some(first) = (0..e.cell_count).find(|&i| e.cell[i] == CELL_LINE) else {
        return false;
    };
    let root = find(e, first as i32);
    if e.size[root as usize] != e.line_cells {
        return false;
    }
    for clue in &e.clues {
        let count = clue
            .ray
            .iter()
            .filter(|&&cell| e.cell[cell as usize] == CELL_BLACK)
            .count() as i32;
        if count != clue.count {
            return false;
        }
    }
    true
}

pub fn to_solution(e: &Engine) -> Solution {
    let mut solution = Solution::default();
    for i in 0..e.cell_count {
        if e.cell[i] == CELL_BLACK {
            solution.blacks.insert(to_id(Position {
                x: i as i32 % e.cols,
                y: i as i32 / e.cols,
            }));
        }
    }
    for edge in 0..e.edge_count {
        if e.edge[edge] != EDGE_LINE {
            continue;
        }
        let cell = e.edge_cells[edge * 2];
        let id = to_id(Position {
            x: cell % e.cols,
            y: cell / e.cols,
        });
        if edge < e.h_count {
            solution.horizontal.insert(id);
        } else {
            solution.vertical.insert(id);
        }
    }
    solution
}

