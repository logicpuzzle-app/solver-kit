use crate::board::{Board, EdgeId};
use crate::engine::EdgeState;
use crate::unionfind::RollbackUnionFind;

/// 手筋ソルバー専用の状態。完全制約エンジンとは状態も伝播も共有しない。
#[derive(Clone, Debug)]
pub struct AnswerModel {
    edges: Vec<EdgeState>,
    line_uf: RollbackUnionFind,
    cycles: usize,
}

impl AnswerModel {
    pub fn new(board: &Board) -> Self {
        Self {
            edges: vec![EdgeState::Unknown; board.edge_count()],
            line_uf: RollbackUnionFind::new(board.vertex_count()),
            cycles: 0,
        }
    }

    pub fn edges(&self) -> &[EdgeState] {
        &self.edges
    }

    pub fn edge(&self, edge: EdgeId) -> EdgeState {
        self.edges[edge]
    }

    pub fn set_edge(
        &mut self,
        board: &Board,
        edge: EdgeId,
        state: EdgeState,
    ) -> Result<bool, String> {
        if edge >= self.edges.len() {
            return Err(format!("辺 ID {edge} は盤外です"));
        }
        if state == EdgeState::Unknown {
            return Err("未確定へ戻すことはできません".into());
        }
        match self.edges[edge] {
            current if current == state => return Ok(false),
            EdgeState::Unknown => {}
            current => {
                return Err(format!(
                    "辺 {edge} を {current:?} と {state:?} の両方に確定しました"
                ));
            }
        }
        self.edges[edge] = state;
        if state == EdgeState::Line {
            let (left, right) = board.edge_endpoints(edge);
            if self.line_uf.same(left, right) {
                self.cycles += 1;
            } else {
                self.line_uf.unite(left, right);
            }
        }
        Ok(true)
    }

    pub fn line_connected(&self, board: &Board, left: EdgeId, right: EdgeId) -> bool {
        let (left_vertex, _) = board.edge_endpoints(left);
        let (right_vertex, _) = board.edge_endpoints(right);
        self.line_uf.same(left_vertex, right_vertex)
    }

    pub fn endpoints_connected(&self, board: &Board, edge: EdgeId) -> bool {
        let (left, right) = board.edge_endpoints(edge);
        self.line_uf.same(left, right)
    }

    pub fn line_component_count(&self, board: &Board) -> usize {
        let mut roots = Vec::new();
        for (edge, &state) in self.edges.iter().enumerate() {
            if state != EdgeState::Line {
                continue;
            }
            let (vertex, _) = board.edge_endpoints(edge);
            let root = self.line_uf.root(vertex);
            if !roots.contains(&root) {
                roots.push(root);
            }
        }
        roots.len()
    }

    pub fn cycles(&self) -> usize {
        self.cycles
    }

    pub fn clone_for_trial(&self) -> Self {
        self.clone()
    }
}
