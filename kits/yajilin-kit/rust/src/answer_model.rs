use crate::board::{to_id, to_pos};
use crate::ordered::{OrderedMap, OrderedSet};
use crate::position::Position;
use crate::unionfind::UnionFind;

pub const LINE_NONE: i8 = -1;
pub const LINE_BLANK: i8 = 0;
pub const LINE_LINE: i8 = 1;
pub const LINE_BAR: i8 = 2;

#[derive(Clone, Debug, Default)]
pub struct AnswerModel {
    pub black_cells: OrderedSet,
    pub white_cells: OrderedSet,
    pub edge: OrderedMap<i64>,
    pub line_uf: UnionFind,
    pub inner_line: OrderedSet,
    pub horizontal: OrderedMap<i8>,
    pub vertical: OrderedMap<i8>,
    pub has_loop: bool,
}

impl AnswerModel {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn normalize(&mut self, new_line: &[Position]) {
        let new_end1 = to_id(new_line[0]);
        let new_end2 = to_id(new_line[new_line.len() - 1]);
        let prev_end1 = self.edge.get(new_end1).copied();
        let prev_end2 = self.edge.get(new_end2).copied();
        if prev_end1.is_some() && prev_end2.is_some() && new_end1 != prev_end2.unwrap() {
            for (i, pos) in new_line.iter().enumerate() {
                if i == 0 || i == new_line.len() - 1 {
                    self.edge.remove(to_id(*pos));
                }
                self.inner_line.insert(to_id(*pos));
                self.white_cells.remove(to_id(*pos));
            }
            self.edge.insert(prev_end1.unwrap(), prev_end2.unwrap());
            self.edge.insert(prev_end2.unwrap(), prev_end1.unwrap());
        } else if let Some(prev1) = prev_end1 {
            for (i, pos) in new_line.iter().enumerate() {
                if i != new_line.len() - 1 {
                    self.inner_line.insert(to_id(*pos));
                }
                self.white_cells.remove(to_id(*pos));
            }
            self.edge.remove(new_end1);
            self.edge.insert(new_end2, prev1);
            self.edge.insert(prev1, new_end2);
            if prev_end2.is_some() {
                self.edge.remove(new_end2);
                self.inner_line.insert(new_end2);
                self.has_loop = true;
            }
        } else if let Some(prev2) = prev_end2 {
            for (i, pos) in new_line.iter().enumerate() {
                if i != 0 {
                    self.inner_line.insert(to_id(*pos));
                }
                self.white_cells.remove(to_id(*pos));
            }
            self.edge.insert(new_end1, prev2);
            self.edge.insert(prev2, new_end1);
            self.edge.remove(new_end2);
        } else {
            for (i, pos) in new_line.iter().enumerate() {
                if i != 0 && i != new_line.len() - 1 {
                    self.inner_line.insert(to_id(*pos));
                }
                self.white_cells.remove(to_id(*pos));
            }
            self.edge.insert(new_end1, new_end2);
            self.edge.insert(new_end2, new_end1);
        }
    }

    pub fn add_line(&mut self, line: &[Position]) {
        for pair in line.windows(2) {
            let prev = pair[0];
            let cur = pair[1];
            self.line_uf.connect(to_id(prev), to_id(cur));
            if prev.x == cur.x {
                let upper = if prev.y < cur.y { prev } else { cur };
                self.vertical.insert(to_id(upper), LINE_LINE);
            }
            if prev.y == cur.y {
                let left = if prev.x < cur.x { prev } else { cur };
                self.horizontal.insert(to_id(left), LINE_LINE);
            }
        }
        self.normalize(line);
    }

    pub fn get_line_state(&self, pos1: Position, pos2: Position) -> Option<i8> {
        if pos1.x == pos2.x {
            let upper = if pos1.y < pos2.y { pos1 } else { pos2 };
            return self.vertical.get(to_id(upper)).copied();
        }
        if pos1.y == pos2.y {
            let left = if pos1.x < pos2.x { pos1 } else { pos2 };
            return self.horizontal.get(to_id(left)).copied();
        }
        Some(LINE_NONE)
    }

    pub fn set_line_bar(&mut self, pos1: Position, pos2: Position) {
        if pos1.x == pos2.x {
            let upper = if pos1.y < pos2.y { pos1 } else { pos2 };
            self.vertical.insert(to_id(upper), LINE_BAR);
        }
        if pos1.y == pos2.y {
            let left = if pos1.x < pos2.x { pos1 } else { pos2 };
            self.horizontal.insert(to_id(left), LINE_BAR);
        }
    }

    pub fn is_line_connection(&self, pos1: Position, pos2: Position) -> bool {
        self.get_line_state(pos1, pos2) == Some(LINE_LINE)
    }

    pub fn is_same_line(&mut self, pos1: Position, pos2: Position) -> bool {
        self.line_uf.is_union(to_id(pos1), to_id(pos2))
    }

    pub fn is_single_line(&self) -> bool {
        self.edge.len() <= 2 && self.white_cells.len() <= 2 && self.inner_line.len() >= 2
    }

    pub fn clone_for_trial(&self) -> Self {
        let mut result = self.clone();
        result.has_loop = false;
        result
    }

    pub fn black_positions(&self) -> Vec<Position> {
        self.black_cells.iter().map(to_pos).collect()
    }
    pub fn white_positions(&self) -> Vec<Position> {
        self.white_cells.iter().map(to_pos).collect()
    }
    pub fn edge_positions(&self) -> Vec<Position> {
        self.edge.iter().map(|(id, _)| to_pos(id)).collect()
    }
}

