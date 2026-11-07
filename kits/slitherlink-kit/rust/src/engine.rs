use std::collections::VecDeque;
use std::fmt;

use crate::board::{Board, EdgeId, SmallIds, VertexId};
use crate::ordered::{OrderedIdSet, OrderedWorklist};
use crate::unionfind::RollbackUnionFind;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EdgeState {
    Unknown,
    Line,
    Cross,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contradiction {
    message: String,
}

impl Contradiction {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for Contradiction {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for Contradiction {}

#[derive(Clone, Copy, Debug)]
pub struct EngineCheckpoint {
    edge_trail: usize,
    union_find: usize,
    cycles: usize,
}

pub struct ConstraintEngine<'a> {
    board: &'a Board,
    edges: Vec<EdgeState>,
    edge_trail: Vec<(EdgeId, EdgeState)>,
    cell_line_counts: Vec<u8>,
    cell_unknown_counts: Vec<u8>,
    vertex_line_counts: Vec<u8>,
    vertex_unknown_counts: Vec<u8>,
    vertex_edge_counts: Vec<u8>,
    vertex_edges: Vec<SmallIds<4>>,
    edge_cells: Vec<SmallIds<2>>,
    endpoint_vertices: [OrderedIdSet; 4],
    edge_clue_scores: Vec<u8>,
    unknown_edges: OrderedIdSet,
    line_edges: OrderedIdSet,
    union_find: RollbackUnionFind,
    cycles: usize,
    worklist: OrderedWorklist,
    visit_marks: Vec<u32>,
    visit_epoch: u32,
    visit_queue: VecDeque<VertexId>,
}

impl<'a> ConstraintEngine<'a> {
    pub fn new(board: &'a Board) -> Self {
        let item_count = board.clues.len() + board.vertex_count() + board.edge_count() + 1;
        let vertex_edges: Vec<_> = (0..board.vertex_count())
            .map(|vertex| {
                let position = board.vertex_position(vertex);
                board.vertex_edges(position.x, position.y)
            })
            .collect();
        let vertex_edge_counts: Vec<u8> =
            vertex_edges.iter().map(|edges| edges.len() as u8).collect();
        let edge_cells: Vec<_> = (0..board.edge_count())
            .map(|edge| board.edge_cells(edge))
            .collect();
        let edge_clue_scores: Vec<_> = (0..board.edge_count())
            .map(|edge| {
                edge_cells[edge]
                    .iter()
                    .copied()
                    .filter(|&cell| board.clues[cell] >= 0)
                    .count() as u8
            })
            .collect();
        let mut unknown_edges = OrderedIdSet::new(board.edge_count());
        for edge in 0..board.edge_count() {
            unknown_edges.insert(edge);
        }
        let mut engine = Self {
            board,
            edges: vec![EdgeState::Unknown; board.edge_count()],
            edge_trail: Vec::new(),
            cell_line_counts: vec![0; board.clues.len()],
            cell_unknown_counts: vec![4; board.clues.len()],
            vertex_line_counts: vec![0; board.vertex_count()],
            vertex_unknown_counts: vertex_edge_counts.clone(),
            vertex_edge_counts,
            vertex_edges,
            edge_cells,
            endpoint_vertices: std::array::from_fn(|_| {
                OrderedIdSet::new(board.vertex_count())
            }),
            edge_clue_scores,
            unknown_edges,
            line_edges: OrderedIdSet::new(board.edge_count()),
            union_find: RollbackUnionFind::new(board.vertex_count()),
            cycles: 0,
            worklist: OrderedWorklist::new(item_count),
            visit_marks: vec![0; board.vertex_count()],
            visit_epoch: 0,
            visit_queue: VecDeque::with_capacity(board.vertex_count()),
        };
        engine.enqueue_all();
        engine
    }

    pub fn edges(&self) -> &[EdgeState] {
        &self.edges
    }

    pub fn edge(&self, id: EdgeId) -> EdgeState {
        self.edges[id]
    }

    pub fn has_unknown_edges(&self) -> bool {
        !self.unknown_edges.is_empty()
    }

    pub fn endpoint_candidates(&self) -> Option<Vec<EdgeId>> {
        for unknown_count in 1..self.endpoint_vertices.len() {
            let Some(vertex) = self.endpoint_vertices[unknown_count].first()
            else {
                continue;
            };
            let candidates = self.vertex_edges[vertex]
                .iter()
                .copied()
                .filter(|&edge| self.edges[edge] == EdgeState::Unknown)
                .collect();
            return Some(candidates);
        }
        None
    }

    pub fn best_unknown_edge(&self) -> EdgeId {
        self.unknown_edges
            .iter()
            .map(|edge| {
                let (left, right) = self.board.edge_endpoints(edge);
                let score = self.vertex_edge_counts[left]
                    - self.vertex_unknown_counts[left]
                    + self.vertex_edge_counts[right]
                    - self.vertex_unknown_counts[right]
                    + self.edge_clue_scores[edge];
                (edge, score)
            })
            .fold(None, |best, candidate| match best {
                Some((_, best_score)) if candidate.1 <= best_score => best,
                _ => Some(candidate),
            })
            .expect("未確定辺が存在することを確認済み")
            .0
    }

    pub fn checkpoint(&self) -> EngineCheckpoint {
        EngineCheckpoint {
            edge_trail: self.edge_trail.len(),
            union_find: self.union_find.snapshot(),
            cycles: self.cycles,
        }
    }

    pub fn rollback(&mut self, checkpoint: EngineCheckpoint) {
        while self.edge_trail.len() > checkpoint.edge_trail {
            let (id, previous) = self.edge_trail.pop().expect("履歴の長さを確認済み");
            let current = self.edges[id];
            self.rollback_search_state(id, current);
            self.edges[id] = previous;
        }
        self.union_find.rollback(checkpoint.union_find);
        self.cycles = checkpoint.cycles;
        self.worklist.clear();
    }

    pub fn set_edge(
        &mut self,
        id: EdgeId,
        state: EdgeState,
    ) -> Result<bool, Contradiction> {
        if id >= self.edges.len() {
            return Err(Contradiction::new(format!("辺 ID {id} は盤外です")));
        }
        if state == EdgeState::Unknown {
            return Err(Contradiction::new("未確定への書き戻しはできません"));
        }
        match self.edges[id] {
            current if current == state => return Ok(false),
            EdgeState::Unknown => {}
            current => {
                return Err(Contradiction::new(format!(
                    "辺 {id} を {current:?} と {state:?} の両方に確定しました"
                )))
            }
        }

        self.edge_trail.push((id, EdgeState::Unknown));
        self.set_search_state(id, state);
        self.edges[id] = state;
        let mut closed_cycle = false;
        if state == EdgeState::Line {
            let (left, right) = self.board.edge_endpoints(id);
            if self.union_find.same(left, right) {
                self.cycles += 1;
                closed_cycle = true;
            } else {
                self.union_find.unite(left, right);
            }
        }
        self.enqueue_around_edge(id);
        if state == EdgeState::Line {
            self.enqueue_component_loop_edges(id);
        }

        if closed_cycle {
            if self.cycles != 1 || !self.closed_loop_is_valid() {
                return Err(Contradiction::new(format!(
                    "辺 {id} で未完成の閉路ができました"
                )));
            }
            // 閉路の外に線は置けないため、残辺は探索を待たずに除外できる。
            let unknown: Vec<_> = self
                .edges
                .iter()
                .enumerate()
                .filter_map(|(edge, &value)| (value == EdgeState::Unknown).then_some(edge))
                .collect();
            for edge in unknown {
                self.set_edge(edge, EdgeState::Cross)?;
            }
        }
        Ok(true)
    }

    fn remove_endpoint_vertex(&mut self, vertex: VertexId) {
        if self.vertex_line_counts[vertex] == 1 {
            let unknown = self.vertex_unknown_counts[vertex] as usize;
            if unknown > 0 {
                self.endpoint_vertices[unknown].remove(vertex);
            }
        }
    }

    fn insert_endpoint_vertex(&mut self, vertex: VertexId) {
        if self.vertex_line_counts[vertex] == 1 {
            let unknown = self.vertex_unknown_counts[vertex] as usize;
            if unknown > 0 {
                self.endpoint_vertices[unknown].insert(vertex);
            }
        }
    }

    fn set_search_state(&mut self, id: EdgeId, state: EdgeState) {
        let removed = self.unknown_edges.remove(id);
        debug_assert!(removed, "確定前の辺は未確定辺集合に含まれる");
        if state == EdgeState::Line {
            self.line_edges.insert(id);
        }

        for index in 0..self.edge_cells[id].len() {
            let cell = self.edge_cells[id][index];
            self.cell_unknown_counts[cell] -= 1;
            if state == EdgeState::Line {
                self.cell_line_counts[cell] += 1;
            }
        }

        let (left, right) = self.board.edge_endpoints(id);
        for vertex in [left, right] {
            self.remove_endpoint_vertex(vertex);
            self.vertex_unknown_counts[vertex] -= 1;
            if state == EdgeState::Line {
                self.vertex_line_counts[vertex] += 1;
            }
            self.insert_endpoint_vertex(vertex);
        }
    }

    fn rollback_search_state(&mut self, id: EdgeId, state: EdgeState) {
        // 履歴を逆順に戻すため、この時点で周囲は辺を確定する直前と同じである。
        // 頂点カウンタを逆更新してから、この辺を未確定集合へ戻す。
        if state == EdgeState::Line {
            self.line_edges.remove(id);
        }
        for index in 0..self.edge_cells[id].len() {
            let cell = self.edge_cells[id][index];
            self.cell_unknown_counts[cell] += 1;
            if state == EdgeState::Line {
                self.cell_line_counts[cell] -= 1;
            }
        }
        let (left, right) = self.board.edge_endpoints(id);
        for vertex in [left, right] {
            self.remove_endpoint_vertex(vertex);
            self.vertex_unknown_counts[vertex] += 1;
            if state == EdgeState::Line {
                self.vertex_line_counts[vertex] -= 1;
            }
            self.insert_endpoint_vertex(vertex);
        }
        self.unknown_edges.insert(id);
    }

    pub fn propagate(&mut self) -> Result<(), Contradiction> {
        while let Some(item) = self.worklist.pop_front() {
            let cell_count = self.board.clues.len();
            let vertex_base = cell_count;
            let loop_base = vertex_base + self.board.vertex_count();
            let connectivity_item = loop_base + self.board.edge_count();
            if item < vertex_base {
                self.check_cell(item)?;
            } else if item < loop_base {
                self.check_vertex(item - vertex_base)?;
            } else if item < connectivity_item {
                self.check_loop_edge(item - loop_base)?;
            } else {
                self.check_connectivity()?;
            }
        }
        Ok(())
    }

    fn enqueue_all(&mut self) {
        for cell in 0..self.board.clues.len() {
            self.enqueue_cell(cell);
        }
        for vertex in 0..self.board.vertex_count() {
            self.enqueue_vertex(vertex);
        }
        for edge in 0..self.board.edge_count() {
            self.enqueue_loop_edge(edge);
        }
        self.enqueue_connectivity();
    }

    fn enqueue_cell(&mut self, cell: usize) {
        self.worklist.insert(cell);
    }

    fn enqueue_vertex(&mut self, vertex: VertexId) {
        self.worklist
            .insert(self.board.clues.len() + vertex);
    }

    fn enqueue_loop_edge(&mut self, edge: EdgeId) {
        self.worklist
            .insert(self.board.clues.len() + self.board.vertex_count() + edge);
    }

    fn enqueue_connectivity(&mut self) {
        self.worklist.insert(
            self.board.clues.len() + self.board.vertex_count() + self.board.edge_count(),
        );
    }

    fn enqueue_around_edge(&mut self, id: EdgeId) {
        for index in 0..self.edge_cells[id].len() {
            let cell = self.edge_cells[id][index];
            self.enqueue_cell(cell);
        }
        let (left, right) = self.board.edge_endpoints(id);
        self.enqueue_vertex(left);
        self.enqueue_vertex(right);
        self.enqueue_loop_edge(id);
        self.enqueue_connectivity();
    }

    fn enqueue_component_loop_edges(&mut self, id: EdgeId) {
        let (start, _) = self.board.edge_endpoints(id);
        // union-find の成分リストは併合・rollback と同時に戻る。Line を
        // BFSでたどり直さず、同じ成分の頂点だけを直接列挙する。
        let mut member = Some(self.union_find.first_member(start));
        while let Some(vertex) = member {
            for index in 0..self.vertex_edges[vertex].len() {
                let edge = self.vertex_edges[vertex][index];
                if self.edges[edge] == EdgeState::Unknown {
                    self.enqueue_loop_edge(edge);
                }
            }
            member = self.union_find.next_member(vertex);
        }
    }

    fn start_visit(&mut self) -> u32 {
        self.visit_queue.clear();
        self.visit_epoch = self.visit_epoch.wrapping_add(1);
        if self.visit_epoch == 0 {
            // 世代番号が一周した時だけ印を消し、通常の探索では配列初期化を避ける。
            self.visit_marks.fill(0);
            self.visit_epoch = 1;
        }
        self.visit_epoch
    }

    fn check_cell(&mut self, cell: usize) -> Result<(), Contradiction> {
        let clue = self.board.clues[cell];
        if clue < 0 {
            return Ok(());
        }
        let position = self.board.cell_position(cell);
        let edges = self.board.cell_edges(position.x, position.y);
        let line_count = self.cell_line_counts[cell] as usize;
        let unknown_count = self.cell_unknown_counts[cell] as usize;
        let cross_count = 4 - line_count - unknown_count;
        let clue = clue as usize;
        if line_count > clue || cross_count > 4 - clue {
            return Err(Contradiction::new(format!(
                "セル ({},{}) の数字制約に矛盾しました",
                position.x + 1,
                position.y + 1
            )));
        }
        if line_count == clue {
            for edge in edges {
                if self.edges[edge] == EdgeState::Unknown {
                    self.set_edge(edge, EdgeState::Cross)?;
                }
            }
        } else if cross_count == 4 - clue {
            for edge in edges {
                if self.edges[edge] == EdgeState::Unknown {
                    self.set_edge(edge, EdgeState::Line)?;
                }
            }
        }
        Ok(())
    }

    fn check_vertex(&mut self, vertex: VertexId) -> Result<(), Contradiction> {
        let position = self.board.vertex_position(vertex);
        let line_count = self.vertex_line_counts[vertex] as usize;
        let unknown_count = self.vertex_unknown_counts[vertex] as usize;
        if line_count > 2 || (line_count == 1 && unknown_count == 0) {
            return Err(Contradiction::new(format!(
                "頂点 ({},{}) の次数制約に矛盾しました",
                position.x + 1,
                position.y + 1
            )));
        }
        if line_count == 2 {
            for index in 0..self.vertex_edges[vertex].len() {
                let edge = self.vertex_edges[vertex][index];
                if self.edges[edge] == EdgeState::Unknown {
                    self.set_edge(edge, EdgeState::Cross)?;
                }
            }
        } else if unknown_count == 1 {
            let edge = self.vertex_edges[vertex]
                .iter()
                .copied()
                .find(|&edge| self.edges[edge] == EdgeState::Unknown)
                .expect("未確定辺数を差分管理している");
            let state = if line_count == 1 {
                EdgeState::Line
            } else {
                EdgeState::Cross
            };
            // 線端なら延長し、線がなければ次数1を避けて頂点を使わない。
            self.set_edge(edge, state)?;
        }
        Ok(())
    }

    fn check_loop_edge(&mut self, edge: EdgeId) -> Result<(), Contradiction> {
        if self.edges[edge] != EdgeState::Unknown {
            return Ok(());
        }
        let (left, right) = self.board.edge_endpoints(edge);
        if self.union_find.same(left, right) && !self.closure_would_be_valid(edge) {
            self.set_edge(edge, EdgeState::Cross)?;
        }
        Ok(())
    }

    fn closure_would_be_valid(&self, closing_edge: EdgeId) -> bool {
        let (closing_left, _) = self.board.edge_endpoints(closing_edge);
        let component = self.union_find.root(closing_left);
        for edge in self.line_edges.iter() {
            let (left, _) = self.board.edge_endpoints(edge);
            if self.union_find.root(left) != component {
                return false;
            }
        }
        for cell in 0..self.board.clues.len() {
            let clue = self.board.clues[cell];
            if clue < 0 {
                continue;
            }
            let count = self.cell_line_counts[cell] as usize
                + usize::from(self.edge_cells[closing_edge].contains(&cell));
            if count != clue as usize {
                return false;
            }
        }
        self.vertices_valid_with(Some(closing_edge))
    }

    fn closed_loop_is_valid(&self) -> bool {
        if !self.vertices_valid_with(None) {
            return false;
        }
        for cell in 0..self.board.clues.len() {
            let clue = self.board.clues[cell];
            if clue < 0 {
                continue;
            }
            if self.cell_line_counts[cell] != clue as u8 {
                return false;
            }
        }
        true
    }

    fn vertices_valid_with(&self, additional_line: Option<EdgeId>) -> bool {
        let mut any_line = false;
        let additional_endpoints =
            additional_line.map(|edge| self.board.edge_endpoints(edge));
        for vertex in 0..self.board.vertex_count() {
            let count = self.vertex_line_counts[vertex] as usize
                + usize::from(
                    additional_endpoints
                        .is_some_and(|(left, right)| vertex == left || vertex == right),
                );
            any_line |= count > 0;
            if count != 0 && count != 2 {
                return false;
            }
        }
        any_line
    }

    fn check_connectivity(&mut self) -> Result<(), Contradiction> {
        let first_line = self.line_edges.first();
        let Some(first_line) = first_line else {
            return Ok(());
        };
        let (start, _) = self.board.edge_endpoints(first_line);
        let epoch = self.start_visit();
        self.visit_marks[start] = epoch;
        self.visit_queue.push_back(start);
        while let Some(vertex) = self.visit_queue.pop_front() {
            for index in 0..self.vertex_edges[vertex].len() {
                let edge = self.vertex_edges[vertex][index];
                if self.edges[edge] == EdgeState::Cross {
                    continue;
                }
                let (left, right) = self.board.edge_endpoints(edge);
                let next = if left == vertex { right } else { left };
                if self.visit_marks[next] != epoch {
                    self.visit_marks[next] = epoch;
                    self.visit_queue.push_back(next);
                }
            }
        }
        for edge in self.line_edges.iter() {
            let (left, right) = self.board.edge_endpoints(edge);
            if self.visit_marks[left] != epoch
                || self.visit_marks[right] != epoch
            {
                return Err(Contradiction::new(
                    "確定線の成分同士を接続できません",
                ));
            }
        }
        Ok(())
    }
}
