//! 手筋が盤面を触る唯一の窓口。確定の記録もここで行うので、
//! 手筋側が記録を書き忘れることがない。

use std::collections::HashMap;

use crate::answer_model::{AnswerModel, CellState};
use crate::board::Board;
use crate::status::Status;

#[derive(Clone, Debug)]
pub struct TraceEntry {
    pub index: usize,
    pub state: CellState,
    pub reason: &'static str,
}

/// `entries` は解説用、`counts` は難易度用の二重帳簿。
#[derive(Clone, Debug, Default)]
pub struct Recorder {
    pub entries: Vec<TraceEntry>,
    pub counts: HashMap<&'static str, i32>,
}

impl Recorder {
    pub fn add(&mut self, index: usize, state: CellState, reason: &'static str) {
        self.entries.push(TraceEntry {
            index,
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

    /// 既に同じなら Stopped、逆の色なら Broken。
    pub fn set(&mut self, index: usize, state: CellState, reason: &'static str) -> Status {
        match self.answer.set(index, state) {
            Ok(true) => {
                if let Some(recorder) = &mut self.recorder {
                    recorder.add(index, state, reason);
                }
                Status::Advanced
            }
            Ok(false) => Status::Stopped,
            Err(_) => Status::Broken,
        }
    }

    pub fn set_black(&mut self, index: usize, reason: &'static str) -> Status {
        self.set(index, CellState::Black, reason)
    }

    pub fn set_white(&mut self, index: usize, reason: &'static str) -> Status {
        self.set(index, CellState::White, reason)
    }

    pub fn set_many(
        &mut self,
        indices: impl IntoIterator<Item = usize>,
        state: CellState,
        reason: &'static str,
    ) -> Status {
        let mut result = Status::Stopped;
        for index in indices {
            result = merge_status(result, self.set(index, state, reason));
            if result == Status::Broken {
                return result;
            }
        }
        result
    }
}

/// Broken > Advanced > Stopped の優先度で畳み込む。
pub fn merge_status(a: Status, b: Status) -> Status {
    match (a, b) {
        (Status::Broken, _) | (_, Status::Broken) => Status::Broken,
        (Status::Advanced, _) | (_, Status::Advanced) => Status::Advanced,
        _ => Status::Stopped,
    }
}
