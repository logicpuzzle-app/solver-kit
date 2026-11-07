use crate::answer_methods::AnswerMethods;
use crate::position::around;
use crate::reasons::WHITE_AROUND_BLACK;
use crate::status::Status;

pub fn add_white_around_black(answer: &mut AnswerMethods<'_>) -> Status {
    let blacks = answer.answer.black_positions();
    let mut advanced = false;
    for black in blacks {
        for (pos, _) in around(black) {
            if !answer.forbidden(pos) {
                advanced |= answer.add_white_cell(pos, WHITE_AROUND_BLACK);
            }
        }
    }
    if advanced {
        Status::Advanced
    } else {
        Status::Stopped
    }
}

