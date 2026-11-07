use crate::position::Position;

#[derive(Clone, Copy, Debug)]
pub struct Cell {
    pub qdir: i32,
    pub qnum: i32,
}

#[derive(Clone, Debug)]
pub struct Board {
    pub cell: Vec<Cell>,
    pub cols: i32,
    pub rows: i32,
}

impl Board {
    pub fn in_board(&self, pos: Position) -> bool {
        pos.x >= 0 && pos.x < self.cols && pos.y >= 0 && pos.y < self.rows
    }
    pub fn at(&self, pos: Position) -> Cell {
        self.cell[(pos.y * self.cols + pos.x) as usize]
    }
}

pub fn to_id(pos: Position) -> i64 {
    ((pos.y as i64) << 16) | (pos.x as i64 & 0xffff)
}

pub fn to_pos(id: i64) -> Position {
    Position {
        x: (id & 0xff) as i32,
        y: (id >> 16) as i32,
    }
}

pub fn create_board(cols: i32, rows: i32) -> Board {
    Board {
        cell: vec![Cell { qdir: -1, qnum: -1 }; (cols * rows) as usize],
        cols,
        rows,
    }
}

