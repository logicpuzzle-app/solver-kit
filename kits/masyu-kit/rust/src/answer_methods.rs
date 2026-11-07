//! 手筋が盤面を確定する唯一の窓口。確定の記録もここで行う。

use crate::answer_model::{AnswerModel, EdgeState};
use crate::board::Board;
use crate::status::Status;

pub struct TraceEntry {
    pub edge: usize,
    pub state: EdgeState,
    pub reason: &'static str,
}

/// 解説用(entries)と難易度用(counts)の二重帳簿。
#[derive(Default)]
pub struct Recorder {
    pub entries: Vec<TraceEntry>,
    pub counts: std::collections::HashMap<&'static str, i32>,
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
        AnswerMethods {
            board,
            answer,
            recorder,
        }
    }

    pub fn set(&mut self, edge: usize, state: EdgeState, reason: &'static str) -> Status {
        match self.answer.set(self.board, edge, state) {
            Ok(true) => {
                if let Some(recorder) = self.recorder.as_deref_mut() {
                    recorder.entries.push(TraceEntry {
                        edge,
                        state,
                        reason,
                    });
                    *recorder.counts.entry(reason).or_insert(0) += 1;
                }
                Status::Advanced
            }
            Ok(false) => Status::Stopped,
            Err(_) => Status::Broken,
        }
    }

    pub fn set_line(&mut self, edge: usize, reason: &'static str) -> Status {
        self.set(edge, EdgeState::Line, reason)
    }

    pub fn set_bar(&mut self, edge: usize, reason: &'static str) -> Status {
        self.set(edge, EdgeState::Bar, reason)
    }
}

/// Broken > Advanced > Stopped の優先で合成する。
pub fn merge_status(a: Status, b: Status) -> Status {
    match (a, b) {
        (Status::Broken, _) | (_, Status::Broken) => Status::Broken,
        (Status::Advanced, _) | (_, Status::Advanced) => Status::Advanced,
        _ => Status::Stopped,
    }
}
