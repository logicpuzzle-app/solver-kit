from __future__ import annotations

from ..answer_methods import AnswerMethods
from ..board import Board
from ..status import Status
from .closed_line_number_theory import closed_line_number_theory
from .connection_map import create_connection_map


def line_number_theory(board: Board, answer: AnswerMethods) -> Status:
    return closed_line_number_theory(board, answer, create_connection_map(board, answer))
