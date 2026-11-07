// 移植元: SlitherSolver.Field.connectWhiteSolve

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::engine::EdgeState;
use crate::reasons::CONNECT_LINE;
use crate::status::Status;

struct BridgeState {
    next_order: usize,
    order: Vec<usize>,
    low: Vec<usize>,
    line_vertex: Vec<bool>,
    total_line_vertices: usize,
    forced: Vec<usize>,
}

fn find_bridges(
    answer: &AnswerMethods<'_>,
    start: usize,
    state: &mut BridgeState,
) {
    let vertex_count = answer.board.vertex_count();
    let mut parent_vertex = vec![usize::MAX; vertex_count];
    let mut parent_edge = vec![usize::MAX; vertex_count];
    let mut subtree_line_vertices = vec![0usize; vertex_count];
    let mut stack = Vec::new();

    state.order[start] = state.next_order;
    state.low[start] = state.next_order;
    state.next_order += 1;
    subtree_line_vertices[start] = usize::from(state.line_vertex[start]);
    stack.push((start, 0usize));

    while let Some((vertex, edge_index)) = stack.pop() {
        let position = answer.board.vertex_position(vertex);
        let edges = answer.board.vertex_edges(position.x, position.y);
        if edge_index < edges.len() {
            stack.push((vertex, edge_index + 1));
            let edge = edges[edge_index];
            if edge == parent_edge[vertex]
                || answer.edge(edge) == EdgeState::Cross
            {
                continue;
            }
            let (left, right) = answer.board.edge_endpoints(edge);
            let next = if left == vertex { right } else { left };
            if state.order[next] == usize::MAX {
                parent_vertex[next] = vertex;
                parent_edge[next] = edge;
                state.order[next] = state.next_order;
                state.low[next] = state.next_order;
                state.next_order += 1;
                subtree_line_vertices[next] =
                    usize::from(state.line_vertex[next]);
                stack.push((next, 0));
            } else {
                state.low[vertex] =
                    state.low[vertex].min(state.order[next]);
            }
            continue;
        }

        let parent = parent_vertex[vertex];
        if parent != usize::MAX {
            subtree_line_vertices[parent] += subtree_line_vertices[vertex];
            state.low[parent] = state.low[parent].min(state.low[vertex]);
            let edge = parent_edge[vertex];
            if state.low[vertex] > state.order[parent]
                && answer.edge(edge) == EdgeState::Unknown
                && subtree_line_vertices[vertex] > 0
                && subtree_line_vertices[vertex] < state.total_line_vertices
            {
                state.forced.push(edge);
            }
        }
    }
}

pub fn connect_line(answer: &mut AnswerMethods<'_>) -> Status {
    let mut line_vertex = vec![false; answer.board.vertex_count()];
    let mut start = None;
    for (edge, &edge_state) in answer.answer.edges().iter().enumerate() {
        if edge_state != EdgeState::Line {
            continue;
        }
        let (left, right) = answer.board.edge_endpoints(edge);
        line_vertex[left] = true;
        line_vertex[right] = true;
        start.get_or_insert(left);
    }
    let Some(start) = start else {
        return Status::Stopped;
    };
    if answer.answer.line_component_count(answer.board) < 2 {
        return Status::Stopped;
    }

    let total_line_vertices = line_vertex.iter().filter(|&&used| used).count();
    let mut bridge_state = BridgeState {
        next_order: 0,
        order: vec![usize::MAX; answer.board.vertex_count()],
        low: vec![usize::MAX; answer.board.vertex_count()],
        line_vertex,
        total_line_vertices,
        forced: Vec::new(),
    };
    // 再帰DFSは細長い大盤面や仮置き中の経路でOSスタックを使い切るため、
    // 明示スタックで同じTarjan法の帰りがけ処理を行う。
    find_bridges(answer, start, &mut bridge_state);
    if bridge_state
        .line_vertex
        .iter()
        .enumerate()
        .any(|(vertex, &used)| used && bridge_state.order[vertex] == usize::MAX)
    {
        return Status::Broken;
    }

    // 従来は未確定辺ID順に一本ずつ除外していた。同じ集合をTarjan法で
    // 一度に求めた後に並べ、確定順まで変えずに反復BFSを避ける。
    bridge_state.forced.sort_unstable();
    let mut result = Status::Stopped;
    for edge in bridge_state.forced {
        result = merge_status(result, answer.set_line(edge, CONNECT_LINE));
        if result == Status::Broken {
            return result;
        }
    }
    result
}
