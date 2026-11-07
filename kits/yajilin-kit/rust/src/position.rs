#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

pub const DIRS: [Position; 5] = [
    Position { x: 0, y: 0 },
    Position { x: 0, y: -1 },
    Position { x: 0, y: 1 },
    Position { x: -1, y: 0 },
    Position { x: 1, y: 0 },
];

pub const DIR_LIST: [Position; 4] = [DIRS[1], DIRS[2], DIRS[3], DIRS[4]];

pub fn around(pos: Position) -> [(Position, Position); 4] {
    DIR_LIST.map(|dir| {
        (
            Position {
                x: pos.x + dir.x,
                y: pos.y + dir.y,
            },
            dir,
        )
    })
}

pub fn add(a: Position, b: Position) -> Position {
    Position {
        x: a.x + b.x,
        y: a.y + b.y,
    }
}

