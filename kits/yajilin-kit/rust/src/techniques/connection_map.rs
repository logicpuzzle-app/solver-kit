use crate::answer_methods::AnswerMethods;
use crate::board::{to_id, to_pos};
use crate::ordered::OrderedMap;
use crate::position::Position;

pub struct ConnectionMap {
    pub map: OrderedMap<usize>,
    pub cells: Vec<Vec<Position>>,
    pub area_count: usize,
}

fn dfs(
    answer: &AnswerMethods<'_>,
    map: &mut OrderedMap<usize>,
    pos: Position,
    id: usize,
) {
    map.insert(to_id(pos), id);
    for (next, _) in answer.edge_around(pos) {
        if answer.is_line_edge(next)
            || answer.forbidden(next)
            || map.contains_key(to_id(next))
        {
            continue;
        }
        dfs(answer, map, next, id);
    }
}

pub fn create_connection_map(answer: &AnswerMethods<'_>) -> ConnectionMap {
    let board = answer.board;
    let mut map = OrderedMap::new();
    let mut area_count = 0;
    for i in 0..board.cell.len() {
        let pos = Position {
            x: i as i32 % board.cols,
            y: i as i32 / board.cols,
        };
        if answer.forbidden(pos)
            || answer.is_line_edge(pos)
            || map.contains_key(to_id(pos))
        {
            continue;
        }
        dfs(answer, &mut map, pos, area_count);
        area_count += 1;
    }
    let mut cells = vec![Vec::new(); area_count];
    for (key, id) in map.iter() {
        cells[*id].push(to_pos(key));
    }
    ConnectionMap {
        map,
        cells,
        area_count,
    }
}

