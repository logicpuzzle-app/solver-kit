use crate::answer_methods::AnswerMethods;
use crate::position::{around, Position};
use crate::reasons::WHITE_AROUND_BLACK;
use crate::status::Status;

pub fn add_white_around_single_black(
    answer: &mut AnswerMethods<'_>,
    black: Position,
) -> Status {
    let mut advanced = false;
    let mut broken = false;
    for (pos, _) in around(black) {
        if !answer.forbidden(pos) {
            advanced |= answer.add_white_cell(pos, WHITE_AROUND_BLACK);
        } else if answer.has_black_cell(pos) {
            broken = true;
        }
    }
    if broken {
        Status::Broken
    } else if advanced {
        Status::Advanced
    } else {
        Status::Stopped
    }
}

