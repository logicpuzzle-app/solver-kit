use crate::board::{create_board, to_id, Board};
use crate::position::Position;
use crate::solution::Solution;

pub fn parse_problem_text(text: &str) -> Result<Board, String> {
    let lines: Vec<_> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    if lines.is_empty() {
        return Err("empty problem".into());
    }
    let mut header: Vec<_> = lines[0].split_whitespace().collect();
    if header.first() == Some(&"yajilin") {
        header.remove(0);
    }
    let cols: i32 = header
        .first()
        .ok_or_else(|| format!("invalid size header: {}", lines[0]))?
        .parse()
        .map_err(|_| format!("invalid size header: {}", lines[0]))?;
    let rows: i32 = header
        .get(1)
        .ok_or_else(|| format!("invalid size header: {}", lines[0]))?
        .parse()
        .map_err(|_| format!("invalid size header: {}", lines[0]))?;
    let body = &lines[1..];
    if body.len() != rows as usize {
        return Err(format!("expected {} rows, found {}", rows, body.len()));
    }
    let mut board = create_board(cols, rows);
    for (y, line) in body.iter().enumerate() {
        let tokens: Vec<_> = line.split_whitespace().collect();
        if tokens.len() != cols as usize {
            return Err(format!(
                "row {}: expected {} cells, found {}",
                y + 1,
                cols,
                tokens.len()
            ));
        }
        for (x, token) in tokens.iter().enumerate() {
            let cell = &mut board.cell[y * cols as usize + x];
            match *token {
                "." => {}
                "+" => {
                    cell.qdir = 0;
                    cell.qnum = -3;
                }
                _ => {
                    let first = token.chars().next().unwrap();
                    cell.qdir = match first {
                        '^' => 1,
                        'v' => 2,
                        '<' => 3,
                        '>' => 4,
                        _ => {
                            return Err(format!(
                                "row {}, cell {}: unknown token {}",
                                y + 1,
                                x + 1,
                                token
                            ))
                        }
                    };
                    let rest = &token[first.len_utf8()..];
                    if rest.is_empty() || rest == "?" {
                        cell.qnum = -2;
                    } else {
                        cell.qnum = rest.parse().map_err(|_| {
                            format!("row {}, cell {}: invalid clue {}", y + 1, x + 1, token)
                        })?;
                        if cell.qnum < 0 {
                            return Err(format!(
                                "row {}, cell {}: invalid clue {}",
                                y + 1,
                                x + 1,
                                token
                            ));
                        }
                    }
                }
            }
        }
    }
    Ok(board)
}

pub fn format_problem_text(board: &Board) -> String {
    let mut lines = vec![format!("yajilin {} {}", board.cols, board.rows)];
    for y in 0..board.rows {
        let mut tokens = Vec::new();
        for x in 0..board.cols {
            let cell = board.cell[(y * board.cols + x) as usize];
            let token = match cell.qnum {
                -1 => ".".to_string(),
                -3 => "+".to_string(),
                _ => {
                    let dir = match cell.qdir {
                        1 => "^",
                        2 => "v",
                        3 => "<",
                        4 => ">",
                        _ => "*",
                    };
                    if cell.qnum == -2 {
                        format!("{dir}?")
                    } else {
                        format!("{dir}{}", cell.qnum)
                    }
                }
            };
            tokens.push(token);
        }
        lines.push(tokens.join(" "));
    }
    format!("{}\n", lines.join("\n"))
}

fn loop_char(up: bool, down: bool, left: bool, right: bool) -> char {
    if up && down {
        '|'
    } else if left && right {
        '-'
    } else if up && right {
        'L'
    } else if up && left {
        'J'
    } else if down && right {
        'r'
    } else if down && left {
        '7'
    } else if up || down {
        '|'
    } else if left || right {
        '-'
    } else {
        'o'
    }
}

pub fn format_answer_grid(board: &Board, solution: &Solution) -> String {
    let mut lines = Vec::new();
    for y in 0..board.rows {
        let mut row = String::new();
        for x in 0..board.cols {
            let pos = Position { x, y };
            let id = to_id(pos);
            let cell = board.cell[(y * board.cols + x) as usize];
            if solution.blacks.contains(&id) {
                row.push('#');
            } else if cell.qnum != -1 {
                row.push(if cell.qnum == -3 {
                    '+'
                } else {
                    match cell.qdir {
                        1 => '^',
                        2 => 'v',
                        3 => '<',
                        4 => '>',
                        _ => '*',
                    }
                });
            } else {
                let up = solution.vertical.contains(&to_id(Position { x, y: y - 1 }));
                let down = solution.vertical.contains(&id);
                let left = solution.horizontal.contains(&to_id(Position { x: x - 1, y }));
                let right = solution.horizontal.contains(&id);
                row.push(if up || down || left || right {
                    loop_char(up, down, left, right)
                } else {
                    '.'
                });
            }
            if x < board.cols - 1 {
                row.push(if solution.horizontal.contains(&id) {
                    '-'
                } else {
                    ' '
                });
            }
        }
        lines.push(row);
        if y < board.rows - 1 {
            let mut between = String::new();
            for x in 0..board.cols {
                between.push(
                    if solution.vertical.contains(&to_id(Position { x, y })) {
                        '|'
                    } else {
                        ' '
                    },
                );
                if x < board.cols - 1 {
                    between.push(' ');
                }
            }
            lines.push(between);
        }
    }
    format!("{}\n", lines.join("\n"))
}

fn positions_of(values: &std::collections::HashSet<i64>) -> String {
    let mut ids: Vec<_> = values.iter().copied().collect();
    ids.sort();
    ids.into_iter()
        .map(|id| format!("{},{}", (id & 0xff) + 1, (id >> 16) + 1))
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn format_solution_summary(solution: &Solution) -> String {
    let mut result = String::new();
    for (name, values) in [
        ("BLACK", &solution.blacks),
        ("HLINE", &solution.horizontal),
        ("VLINE", &solution.vertical),
    ] {
        let positions = positions_of(values);
        result.push_str(name);
        if !positions.is_empty() {
            result.push(' ');
            result.push_str(&positions);
        }
        result.push('\n');
    }
    result
}

