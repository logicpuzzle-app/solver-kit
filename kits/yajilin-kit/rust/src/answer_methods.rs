use std::collections::HashMap;

use crate::answer_model::{AnswerModel, LINE_BLANK, LINE_LINE};
use crate::board::{to_id, Board};
use crate::ordered::OrderedSet;
use crate::position::{around, Position};
use crate::reasons::{BLACK_FROM_TWO_CHOICE, WHITE_AROUND_BLACK};

#[derive(Clone, Debug)]
pub struct TraceEntry {
    pub kind: &'static str,
    pub cells: Vec<Position>,
    pub reason: &'static str,
}

#[derive(Clone, Debug, Default)]
pub struct Recorder {
    pub entries: Vec<TraceEntry>,
    pub counts: HashMap<&'static str, i32>,
}

impl Recorder {
    pub fn add(&mut self, kind: &'static str, cells: Vec<Position>, reason: &'static str) {
        self.entries.push(TraceEntry { kind, cells, reason });
        *self.counts.entry(reason).or_insert(0) += 1;
    }
}

pub struct AnswerMethods<'a> {
    pub board: &'a Board,
    pub answer: &'a mut AnswerModel,
    pub black_candidates_horizontal: OrderedSet,
    pub black_candidates_vertical: OrderedSet,
    pub new_blacks: OrderedSet,
    pub new_whites: OrderedSet,
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
            black_candidates_horizontal: OrderedSet::new(),
            black_candidates_vertical: OrderedSet::new(),
            new_blacks: OrderedSet::new(),
            new_whites: OrderedSet::new(),
            recorder,
        }
    }

    pub fn add_black_cell(&mut self, pos: Position, reason: &'static str) -> bool {
        let id = to_id(pos);
        if self.answer.black_cells.contains(id) {
            return false;
        }
        self.answer.black_cells.insert(id);
        self.new_blacks.insert(id);
        if let Some(recorder) = &mut self.recorder {
            recorder.add("black", vec![pos], reason);
        }
        // This is the recursive callback performed by addWhiteAroundSingleBlack.
        for (next, _) in around(pos) {
            if !self.forbidden(next) {
                self.add_white_cell(next, WHITE_AROUND_BLACK);
            }
        }
        self.black_candidates_horizontal.remove(id);
        self.black_candidates_horizontal.remove(id - 1);
        self.black_candidates_vertical.remove(id);
        self.black_candidates_vertical.remove(id - 65536);
        true
    }

    pub fn add_white_cell(&mut self, pos: Position, reason: &'static str) -> bool {
        let id = to_id(pos);
        if self.answer.white_cells.contains(id)
            || self.answer.edge.contains_key(id)
            || self.answer.inner_line.contains(id)
        {
            return false;
        }
        self.answer.white_cells.insert(id);
        self.new_whites.insert(id);
        if let Some(recorder) = &mut self.recorder {
            recorder.add("white", vec![pos], reason);
        }
        if self.black_candidates_horizontal.remove(id) {
            self.add_black_cell(
                Position {
                    x: pos.x + 1,
                    y: pos.y,
                },
                BLACK_FROM_TWO_CHOICE,
            );
        }
        if self.black_candidates_horizontal.remove(id - 1) {
            self.add_black_cell(
                Position {
                    x: pos.x - 1,
                    y: pos.y,
                },
                BLACK_FROM_TWO_CHOICE,
            );
        }
        if self.black_candidates_vertical.remove(id) {
            self.add_black_cell(
                Position {
                    x: pos.x,
                    y: pos.y + 1,
                },
                BLACK_FROM_TWO_CHOICE,
            );
        }
        if self.black_candidates_vertical.remove(id - 65536) {
            self.add_black_cell(
                Position {
                    x: pos.x,
                    y: pos.y - 1,
                },
                BLACK_FROM_TWO_CHOICE,
            );
        }
        true
    }

    pub fn add_line(&mut self, line: &[Position], reason: &'static str) -> bool {
        if line.len() == 2 && self.answer.is_line_connection(line[0], line[1]) {
            return false;
        }
        self.answer.add_line(line);
        if let Some(recorder) = &mut self.recorder {
            recorder.add("line", line.to_vec(), reason);
        }
        true
    }

    pub fn forbidden(&self, pos: Position) -> bool {
        if !self.board.in_board(pos) {
            return true;
        }
        let id = to_id(pos);
        self.answer.black_cells.contains(id)
            || self.board.cell[(pos.y * self.board.cols + pos.x) as usize].qnum != -1
            || self.answer.inner_line.contains(id)
    }

    pub fn edge_around(&self, pos: Position) -> Vec<(Position, Position)> {
        around(pos)
            .into_iter()
            .filter(|(next, _)| {
                !self.forbidden(*next)
                    && self.answer.get_line_state(pos, *next).unwrap_or(LINE_BLANK)
                        == LINE_BLANK
            })
            .collect()
    }

    pub fn has_black_cell(&self, pos: Position) -> bool {
        self.answer.black_cells.contains(to_id(pos))
    }
    pub fn has_white_cell(&self, pos: Position) -> bool {
        self.answer.white_cells.contains(to_id(pos))
    }
    pub fn has_line(&self, pos: Position) -> bool {
        self.answer.inner_line.contains(to_id(pos))
    }
    pub fn is_line_edge(&self, pos: Position) -> bool {
        self.answer.edge.contains_key(to_id(pos))
    }
    pub fn is_line_connection(&self, a: Position, b: Position) -> bool {
        self.answer.get_line_state(a, b) == Some(LINE_LINE)
    }
    pub fn set_line_bar(&mut self, a: Position, b: Position) {
        self.answer.set_line_bar(a, b);
    }
    pub fn get_line_state(&self, a: Position, b: Position) -> Option<i8> {
        self.answer.get_line_state(a, b)
    }
    pub fn get_edge_id(&self, pos: Position) -> Option<i64> {
        self.answer.edge.get(to_id(pos)).copied()
    }
    pub fn is_single_line(&self) -> bool {
        self.answer.is_single_line()
    }
    pub fn is_same_line(&mut self, a: Position, b: Position) -> bool {
        self.answer.is_same_line(a, b)
    }
    pub fn has_small_loop(&self) -> bool {
        self.answer.has_loop
            && (!self.answer.edge.is_empty() || !self.answer.white_cells.is_empty())
    }
}

