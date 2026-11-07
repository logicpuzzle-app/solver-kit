use crate::answer_methods::AnswerMethods;
use crate::status::Status;

use super::closed_line_number_theory::closed_line_number_theory;
use super::connection_map::create_connection_map;

pub fn line_number_theory(answer: &mut AnswerMethods<'_>) -> Status {
    let connection = create_connection_map(answer);
    closed_line_number_theory(answer, connection)
}

