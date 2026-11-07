from __future__ import annotations

from dataclasses import dataclass, field

from . import answer_model as model
from .board import Board, to_id
from .position import Position, around, dirs as _DIRS

_DIR_UP = _DIRS[1]
_DIR_DOWN = _DIRS[2]
_DIR_LEFT = _DIRS[3]
_DIR_RIGHT = _DIRS[4]


@dataclass(slots=True)
class TraceEntry:
    kind: str
    cells: list[Position]
    reason: str


@dataclass(slots=True)
class Recorder:
    entries: list[TraceEntry] = field(default_factory=list)
    counts: dict[str, int] = field(default_factory=dict)

    def add(self, entry: TraceEntry) -> None:
        self.entries.append(entry)
        self.counts[entry.reason] = self.counts.get(entry.reason, 0) + 1


def create_recorder() -> Recorder:
    return Recorder()


class AnswerMethods:
    def __init__(self, board: Board, answer: model.AnswerModel, recorder: Recorder | None):
        self.board = board
        self.answer = answer
        self.recorder = recorder
        self.black_candidates_horizontal: dict[int, None] = {}
        self.black_candidates_vertical: dict[int, None] = {}
        self.new_blacks: dict[int, None] = {}
        self.new_whites: dict[int, None] = {}

    def add_black_cell(self, _answer_methods: "AnswerMethods", pos: Position, reason: str) -> bool:
        from .techniques.add_white_around_single_black import add_white_around_single_black

        pos_id = to_id(pos)
        if pos_id in self.answer.black_cells:
            return False
        model.add_black_cell(self.answer.black_cells, pos)
        self.new_blacks[pos_id] = None
        if self.recorder:
            self.recorder.add(TraceEntry("black", [pos], reason))
        add_white_around_single_black(self, pos)
        self.black_candidates_horizontal.pop(pos_id, None)
        self.black_candidates_horizontal.pop(pos_id - 1, None)
        self.black_candidates_vertical.pop(pos_id, None)
        self.black_candidates_vertical.pop(pos_id - 65536, None)
        return True

    def add_white_cell(self, _answer_methods: "AnswerMethods", pos: Position, reason: str) -> bool:
        pos_id = to_id(pos)
        if pos_id in self.answer.white_cells or model.is_line_edge(self.answer, pos):
            return False
        if pos_id in self.answer.inner_line:
            return False
        model.add_white_cell(self.answer.white_cells, pos)
        self.new_whites[pos_id] = None
        if self.recorder:
            self.recorder.add(TraceEntry("white", [pos], reason))
        if pos_id in self.black_candidates_horizontal:
            del self.black_candidates_horizontal[pos_id]
            self.add_black_cell(self, Position(pos.x + 1, pos.y), "2択の黒が確定")
        if pos_id - 1 in self.black_candidates_horizontal:
            del self.black_candidates_horizontal[pos_id - 1]
            self.add_black_cell(self, Position(pos.x - 1, pos.y), "2択の黒が確定")
        if pos_id in self.black_candidates_vertical:
            del self.black_candidates_vertical[pos_id]
            self.add_black_cell(self, Position(pos.x, pos.y + 1), "2択の黒が確定")
        if pos_id - 65536 in self.black_candidates_vertical:
            del self.black_candidates_vertical[pos_id - 65536]
            self.add_black_cell(self, Position(pos.x, pos.y - 1), "2択の黒が確定")
        return True

    def add_line(self, line: list[Position], reason: str) -> bool:
        if len(line) == 2 and model.is_line_connection(self.answer, line[0], line[1]):
            return False
        model.add_line(self.answer, line)
        if self.recorder:
            self.recorder.add(TraceEntry("line", line, reason))
        return True

    def is_single_line(self) -> bool:
        return model.is_single_line(self.answer)

    def is_same_line(self, p1: Position, p2: Position) -> bool:
        return model.is_same_line(self.answer, p1, p2)

    def is_line_edge(self, pos: Position) -> bool:
        return ((pos.y << 16) | pos.x) in self.answer.edge

    def has_black_cell(self, pos: Position) -> bool:
        return ((pos.y << 16) | pos.x) in self.answer.black_cells

    def has_white_cell(self, pos: Position) -> bool:
        return ((pos.y << 16) | pos.x) in self.answer.white_cells

    def has_line(self, pos: Position) -> bool:
        return ((pos.y << 16) | pos.x) in self.answer.inner_line

    def get_edge_id(self, pos: Position) -> int | None:
        return model.get_edge_id(self.answer, pos)

    def get_black_cells(self) -> list[Position]:
        return model.get_black_cells(self.answer.black_cells)

    def get_white_cells(self) -> list[Position]:
        return model.get_white_cells(self.answer.white_cells)

    def get_all_edge(self) -> list[Position]:
        return model.get_all_edge(self.answer)

    def get_line_state(self, p1: Position, p2: Position) -> model.LineState | None:
        return model.get_line_state(self.answer, p1, p2)

    def forbidden(self, pos: Position) -> bool:
        # to_id and in_board are inlined: this runs several million times per puzzle and
        # the call overhead dominated the profile.
        x = pos.x
        y = pos.y
        board = self.board
        cols = board.cols
        if x < 0 or x >= cols or y < 0 or y >= board.rows:
            return True
        pos_id = (y << 16) | x
        answer = self.answer
        return (
            pos_id in answer.black_cells
            or board.cell[y * cols + x].qnum != -1
            or pos_id in answer.inner_line
        )

    def edge_around(self, pos: Position) -> list[tuple[Position, Position]]:
        """Neighbours the line may still be extended into, in dir order 1,2,3,4.

        Written out rather than composed from around() + get_line_state() + forbidden():
        it is the single hottest function in the solver, and the loop below avoids four
        Position allocations, four tuples and a dozen calls per invocation. The order of
        the results and the meaning of the test are unchanged — note that only one of the
        two coordinates ever differs, so the shared edge is the upper cell for a vertical
        step and the left cell for a horizontal one.
        """
        x = pos.x
        y = pos.y
        board = self.board
        cols = board.cols
        rows = board.rows
        cells = board.cell
        answer = self.answer
        blacks = answer.black_cells
        inner = answer.inner_line
        vertical = answer.vertical
        horizontal = answer.horizontal
        pos_id = (y << 16) | x

        result: list[tuple[Position, Position]] = []

        # Unrolled over the four directions in order 1,2,3,4. Each block is the same
        # test: the shared edge must be unset, and the neighbour must be on the board,
        # not black, not a clue and not already carrying the line.
        if y > 0:
            neighbour_id = pos_id - 65536
            if not vertical.get(neighbour_id):
                if (
                    neighbour_id not in blacks
                    and cells[(y - 1) * cols + x].qnum == -1
                    and neighbour_id not in inner
                ):
                    result.append((Position(x, y - 1), _DIR_UP))
        if y < rows - 1:
            if not vertical.get(pos_id):
                neighbour_id = pos_id + 65536
                if (
                    neighbour_id not in blacks
                    and cells[(y + 1) * cols + x].qnum == -1
                    and neighbour_id not in inner
                ):
                    result.append((Position(x, y + 1), _DIR_DOWN))
        if x > 0:
            neighbour_id = pos_id - 1
            if not horizontal.get(neighbour_id):
                if (
                    neighbour_id not in blacks
                    and cells[y * cols + x - 1].qnum == -1
                    and neighbour_id not in inner
                ):
                    result.append((Position(x - 1, y), _DIR_LEFT))
        if x < cols - 1:
            if not horizontal.get(pos_id):
                neighbour_id = pos_id + 1
                if (
                    neighbour_id not in blacks
                    and cells[y * cols + x + 1].qnum == -1
                    and neighbour_id not in inner
                ):
                    result.append((Position(x + 1, y), _DIR_RIGHT))
        return result

    def has_small_loop(self) -> bool:
        return self.answer.has_loop and (len(self.answer.edge) > 0 or len(self.answer.white_cells) > 0)

    def is_line_connection(self, p1: Position, p2: Position) -> bool:
        return model.is_line_connection(self.answer, p1, p2)

    def set_line_bar(self, p1: Position, p2: Position) -> None:
        model.set_line_bar(self.answer, p1, p2)


def create_answer_methods(
    board: Board, answer: model.AnswerModel, recorder: Recorder | None
) -> AnswerMethods:
    return AnswerMethods(board, answer, recorder)
