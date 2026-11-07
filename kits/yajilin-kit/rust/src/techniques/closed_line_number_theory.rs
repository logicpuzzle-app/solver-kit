use std::collections::HashSet;

use crate::answer_methods::AnswerMethods;
use crate::board::to_id;
use crate::position::Position;
use crate::reasons::{INVISIBLE_WALL_BY_COUNT, INVISIBLE_WALL_BY_GLOBAL_SMALL_LOOP};
use crate::status::Status;

use super::connection_map::ConnectionMap;

fn unique(values: impl IntoIterator<Item = usize>) -> Vec<usize> {
    let mut result = Vec::new();
    for value in values {
        if !result.contains(&value) {
            result.push(value);
        }
    }
    result
}

pub fn closed_line_number_theory(
    answer: &mut AnswerMethods<'_>,
    mut connection: ConnectionMap,
) -> Status {
    let count = connection.area_count;
    let mut inner: Vec<Vec<Position>> = vec![Vec::new(); count];
    let mut boundary: Vec<Vec<Position>> = vec![Vec::new(); count];
    let mut adjacent: Vec<Vec<Position>> = vec![Vec::new(); count];
    let mut edges = answer.answer.edge_positions();
    let mut edge_count = edges.len();
    loop {
        let mut remaining = Vec::new();
        for pos in edges {
            let around_ids: Vec<Option<usize>> = answer
                .edge_around(pos)
                .into_iter()
                .map(|(next, _)| connection.map.get(to_id(next)).copied())
                .collect();
            if around_ids.iter().any(Option::is_none) {
                remaining.push(pos);
                continue;
            }
            let ids = unique(around_ids.into_iter().flatten());
            if ids.len() == 1 {
                inner[ids[0]].push(pos);
                connection.map.insert(to_id(pos), ids[0]);
            } else {
                for id in ids {
                    boundary[id].push(pos);
                }
            }
        }
        edges = remaining;
        if edges.is_empty() {
            break;
        }
        if edges.len() == edge_count {
            for &pos in &edges {
                let ids = unique(
                    answer
                        .edge_around(pos)
                        .into_iter()
                        .filter_map(|(next, _)| connection.map.get(to_id(next)).copied()),
                );
                if ids.len() == 1 {
                    adjacent[ids[0]].push(pos);
                } else {
                    for id in ids {
                        boundary[id].push(pos);
                    }
                }
            }
            break;
        }
        edge_count = edges.len();
    }

    for id in 0..count {
        for pos in adjacent[id].clone() {
            let all_known = answer
                .edge_around(pos)
                .into_iter()
                .filter(|(next, _)| !connection.map.contains_key(to_id(*next)))
                .all(|(next, _)| adjacent[id].contains(&next) || boundary[id].contains(&next));
            if all_known {
                inner[id].push(pos);
                connection.map.insert(to_id(pos), id);
            } else {
                boundary[id].push(pos);
            }
        }
    }

    for i in 0..count {
        if connection.cells[i].len() == 1
            && !answer.has_white_cell(connection.cells[i][0])
        {
            continue;
        }
        if boundary[i].is_empty() {
            if count >= 2 && inner[i].is_empty() {
                return Status::Broken;
            }
            if inner[i].len() % 2 == 1 {
                return Status::Broken;
            }
            let partners: HashSet<Option<i64>> =
                inner[i].iter().map(|&p| answer.get_edge_id(p)).collect();
            if count >= 2 && partners.len() == inner[i].len() / 2 {
                return Status::Broken;
            }
        }
        if boundary[i].len() == 1 {
            let pos = boundary[i][0];
            let next: Vec<_> = if inner[i].len() % 2 == 0 {
                answer
                    .edge_around(pos)
                    .into_iter()
                    .filter(|(p, _)| connection.map.get(to_id(*p)).copied() != Some(i))
                    .collect()
            } else {
                answer
                    .edge_around(pos)
                    .into_iter()
                    .filter(|(p, _)| connection.map.get(to_id(*p)).copied() == Some(i))
                    .collect()
            };
            if next.len() == 1
                && answer.add_line(&[pos, next[0].0], INVISIBLE_WALL_BY_COUNT)
            {
                return Status::Advanced;
            }
        }
        if boundary[i].len() == 2 && inner[i].len() % 2 == 0 {
            let partners: HashSet<Option<i64>> =
                inner[i].iter().map(|&p| answer.get_edge_id(p)).collect();
            if partners.len() == inner[i].len() / 2 {
                for pos in boundary[i].clone() {
                    let next: Vec<_> = answer
                        .edge_around(pos)
                        .into_iter()
                        .filter(|(p, _)| connection.map.get(to_id(*p)).copied() == Some(i))
                        .collect();
                    if next.len() == 1
                        && answer.add_line(
                            &[pos, next[0].0],
                            INVISIBLE_WALL_BY_GLOBAL_SMALL_LOOP,
                        )
                    {
                        return Status::Advanced;
                    }
                }
            }
        }
    }
    Status::Stopped
}

