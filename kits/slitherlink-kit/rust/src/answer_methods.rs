use std::collections::HashMap;

use crate::answer_model::AnswerModel;
use crate::board::{Board, EdgeId};
use crate::engine::EdgeState;
use crate::status::Status;

#[derive(Clone, Debug)]
pub struct TraceEntry {
    pub edge: EdgeId,
    pub state: EdgeState,
    pub reason: &'static str,
}

#[derive(Clone, Debug, Default)]
pub struct Recorder {
    pub entries: Vec<TraceEntry>,
    pub counts: HashMap<&'static str, i32>,
}

impl Recorder {
    pub fn add(&mut self, edge: EdgeId, state: EdgeState, reason: &'static str) {
        self.entries.push(TraceEntry {
            edge,
            state,
            reason,
        });
        *self.counts.entry(reason).or_insert(0) += 1;
    }
}

pub struct AnswerMethods<'a> {
    pub board: &'a Board,
    pub answer: &'a mut AnswerModel,
    pub recorder: Option<&'a mut Recorder>,
}

impl<'a> AnswerMethods<'a> {
    pub fn new(
        board: &'a Board,
        answer: &'a mut AnswerModel,
        recorder: Option<&'a mut Recorder>,
    ) -> Self {
        Self {
            board,
            answer,
            recorder,
        }
    }

    pub fn edge(&self, edge: EdgeId) -> EdgeState {
        self.answer.edge(edge)
    }

    pub fn set_edge(
        &mut self,
        edge: EdgeId,
        state: EdgeState,
        reason: &'static str,
    ) -> Status {
        match self.answer.set_edge(self.board, edge, state) {
            Ok(false) => Status::Stopped,
            Ok(true) => {
                if let Some(recorder) = &mut self.recorder {
                    recorder.add(edge, state, reason);
                }
                Status::Advanced
            }
            Err(_) => Status::Broken,
        }
    }

    pub fn set_line(&mut self, edge: EdgeId, reason: &'static str) -> Status {
        self.set_edge(edge, EdgeState::Line, reason)
    }

    pub fn set_cross(&mut self, edge: EdgeId, reason: &'static str) -> Status {
        self.set_edge(edge, EdgeState::Cross, reason)
    }

    pub fn set_many(
        &mut self,
        edges: impl IntoIterator<Item = EdgeId>,
        state: EdgeState,
        reason: &'static str,
    ) -> Status {
        let mut result = Status::Stopped;
        for edge in edges {
            result = merge_status(result, self.set_edge(edge, state, reason));
            if result == Status::Broken {
                break;
            }
        }
        result
    }
}

pub fn merge_status(left: Status, right: Status) -> Status {
    match (left, right) {
        (Status::Broken, _) | (_, Status::Broken) => Status::Broken,
        (Status::Advanced, _) | (_, Status::Advanced) => Status::Advanced,
        _ => Status::Stopped,
    }
}
