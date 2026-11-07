use crate::board::Board;
use crate::engine::EdgeState;

pub fn parse_problem_text(text: &str) -> Result<Board, String> {
    let lines: Vec<_> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    if lines.is_empty() {
        return Err("問題テキストが空です".into());
    }

    let header: Vec<_> = lines[0].split_whitespace().collect();
    let (cols, rows, body_start) = if header.first() == Some(&"slither") {
        let cols = parse_size(header.get(1), "列数")?;
        let rows = parse_size(header.get(2), "行数")?;
        (cols, rows, 1)
    } else if header.len() == 2
        && header[0].chars().all(|character| character.is_ascii_digit())
        && header[1].chars().all(|character| character.is_ascii_digit())
    {
        (
            parse_size(header.first(), "列数")?,
            parse_size(header.get(1), "行数")?,
            1,
        )
    } else {
        let rows = lines.len();
        let cols = split_row(lines[0]).len();
        (cols, rows, 0)
    };
    let body = &lines[body_start..];
    if body.len() != rows {
        return Err(format!("行数は {rows} のはずですが {} 行あります", body.len()));
    }

    let mut clues = Vec::with_capacity(cols * rows);
    for (y, line) in body.iter().enumerate() {
        let cells = split_row(line);
        if cells.len() != cols {
            return Err(format!(
                "{} 行目は {cols} セルのはずですが {} セルあります",
                y + 1,
                cells.len()
            ));
        }
        for cell in cells {
            let clue = match cell.as_str() {
                "." => -1,
                "0" => 0,
                "1" => 1,
                "2" => 2,
                "3" => 3,
                _ => {
                    return Err(format!(
                        "{} 行目に不正なセルがあります: {cell}",
                        y + 1
                    ))
                }
            };
            clues.push(clue);
        }
    }
    Board::new(cols, rows, clues)
}

fn parse_size(value: Option<&&str>, name: &str) -> Result<usize, String> {
    value
        .ok_or_else(|| format!("{name}がありません"))?
        .parse()
        .map_err(|_| format!("{name}が不正です"))
}

fn split_row(line: &str) -> Vec<String> {
    let tokens: Vec<_> = line.split_whitespace().collect();
    if tokens.len() > 1 {
        tokens.into_iter().map(str::to_string).collect()
    } else {
        line.chars().map(|character| character.to_string()).collect()
    }
}

pub fn format_problem_text(board: &Board) -> String {
    let mut result = format!("slither {} {}\n", board.cols, board.rows);
    for y in 0..board.rows {
        for x in 0..board.cols {
            result.push(match board.clue(x, y) {
                -1 => '.',
                -2 => '?',
                clue => char::from_digit(clue as u32, 10).expect("ヒントは一桁"),
            });
        }
        result.push('\n');
    }
    result
}

pub fn format_board(board: &Board, edges: &[EdgeState]) -> String {
    let mut lines = Vec::with_capacity(board.rows * 2 + 1);
    for y in 0..=board.rows {
        let mut horizontal = String::new();
        for x in 0..=board.cols {
            horizontal.push('●');
            if x < board.cols {
                horizontal.push(edge_character(edges, board.h_id(x, y), '━'));
            }
        }
        lines.push(horizontal);
        if y < board.rows {
            let mut cells = String::new();
            for x in 0..=board.cols {
                cells.push(edge_character(edges, board.v_id(x, y), '┃'));
                if x < board.cols {
                    cells.push(match board.clue(x, y) {
                        -1 => ' ',
                        -2 => '?',
                        clue => char::from_digit(clue as u32, 10).expect("ヒントは一桁"),
                    });
                }
            }
            lines.push(cells);
        }
    }
    format!("{}\n", lines.join("\n"))
}

fn edge_character(edges: &[EdgeState], edge: usize, line: char) -> char {
    match edges.get(edge).copied().unwrap_or(EdgeState::Unknown) {
        EdgeState::Unknown => ' ',
        EdgeState::Line => line,
        EdgeState::Cross => '×',
    }
}

pub fn format_solution_summary(board: &Board, edges: &[EdgeState]) -> String {
    let mut horizontal = Vec::new();
    let mut vertical = Vec::new();
    for (edge, &state) in edges.iter().enumerate() {
        if state != EdgeState::Line {
            continue;
        }
        if edge < board.horizontal_edge_count() {
            let x = edge % board.cols;
            let y = edge / board.cols;
            horizontal.push(format!("{},{}", x + 1, y + 1));
        } else {
            let offset = edge - board.horizontal_edge_count();
            let x = offset % (board.cols + 1);
            let y = offset / (board.cols + 1);
            vertical.push(format!("{},{}", x + 1, y + 1));
        }
    }
    format!(
        "HLINE {}\nVLINE {}\n",
        horizontal.join(" "),
        vertical.join(" ")
    )
}
