from __future__ import annotations

import re

from .board import Board, create_board

BASE36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def parse_url(value: str) -> tuple[str, int, int, str]:
    text = value.strip()
    if "?" in text:
        text = text.split("?", 1)[1]
    parts = [part for part in text.split("/") if part]
    if len(parts) < 4:
        raise ValueError(f"not a yajilin puzzle url: {value}")
    puzzle_type = parts[0]
    if puzzle_type != "yajilin":
        raise ValueError(f"unsupported puzzle type: {puzzle_type}")
    index = 1
    while index < len(parts) and not re.fullmatch(r"\d+", parts[index]):
        index += 1
    try:
        cols, rows = int(parts[index]), int(parts[index + 1])
    except (ValueError, IndexError):
        raise ValueError(f"not a yajilin puzzle url: {value}") from None
    return puzzle_type, cols, rows, "/".join(parts[index + 2:])


def decode_body(body: str, board: Board) -> None:
    c = 0
    i = 0
    while i < len(body):
        if c >= len(board.cell):
            break
        char = body[i]
        cell = board.cell[c]
        if char == "+":
            cell.qdir, cell.qnum = 0, -3
        elif "0" <= char <= "4":
            cell.qdir = int(char, 16)
            char1 = body[i + 1] if i + 1 < len(body) else ""
            cell.qnum = int(char1, 16) if char1 != "." else -2
            i += 1
        elif "5" <= char <= "9":
            cell.qdir = int(char, 16) - 5
            cell.qnum = int(body[i + 1:i + 3], 16)
            i += 2
        elif char == "-":
            cell.qdir = int(body[i + 1:i + 2], 16)
            cell.qnum = int(body[i + 2:i + 5], 16)
            i += 4
        elif "a" <= char <= "z":
            c += int(char, 36) - 10
        c += 1
        i += 1


def decode_url(value: str) -> Board:
    _, cols, rows, body = parse_url(value)
    board = create_board(cols, rows)
    decode_body(body, board)
    return board


def encode_body(board: Board) -> str:
    output = ""
    count = 0
    for cell in board.cell:
        pstr = ""
        direction, qnum = cell.qdir, cell.qnum
        if qnum == -2:
            pstr = f"{direction}."
        elif qnum == -3:
            pstr = "+"
        elif 0 <= qnum < 16:
            pstr = f"{direction}{qnum:x}"
        elif 16 <= qnum < 256:
            pstr = f"{direction + 5}{qnum:x}"
        elif 256 <= qnum < 4096:
            pstr = f"-{direction}{qnum:x}"
        else:
            count += 1
        if count == 0:
            output += pstr
        elif pstr or count == 26:
            output += BASE36[count + 9] + pstr
            count = 0
    if count > 0:
        output += BASE36[count + 9]
    return output


def encode_code(board: Board) -> str:
    return f"yajilin/{board.cols}/{board.rows}/{encode_body(board)}"


def encode_url(board: Board) -> str:
    return f"https://puzz.link/p?{encode_code(board)}"
