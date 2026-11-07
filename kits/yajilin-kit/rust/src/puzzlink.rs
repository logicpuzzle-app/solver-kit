use crate::board::{create_board, Board};

pub fn decode_url(input: &str) -> Result<Board, String> {
    let mut text = input.trim();
    if let Some(at) = text.find('?') {
        text = &text[at + 1..];
    }
    let parts: Vec<_> = text.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() < 4 || parts[0] != "yajilin" {
        return Err(format!("not a yajilin puzzle url: {input}"));
    }
    let mut index = 1;
    while index < parts.len() && !parts[index].chars().all(|c| c.is_ascii_digit()) {
        index += 1;
    }
    let cols: i32 = parts
        .get(index)
        .ok_or_else(|| format!("not a yajilin puzzle url: {input}"))?
        .parse()
        .map_err(|_| format!("not a yajilin puzzle url: {input}"))?;
    let rows: i32 = parts
        .get(index + 1)
        .ok_or_else(|| format!("not a yajilin puzzle url: {input}"))?
        .parse()
        .map_err(|_| format!("not a yajilin puzzle url: {input}"))?;
    let body = parts[index + 2..].join("/");
    let mut board = create_board(cols, rows);
    decode_body(&body, &mut board);
    Ok(board)
}

fn hex(text: &str) -> i32 {
    i32::from_str_radix(text, 16).unwrap_or(0)
}

pub fn decode_body(body: &str, board: &mut Board) {
    let chars: Vec<char> = body.chars().collect();
    let mut cell = 0usize;
    let mut i = 0;
    while i < chars.len() && cell < board.cell.len() {
        let c = chars[i];
        if c == '+' {
            board.cell[cell].qdir = 0;
            board.cell[cell].qnum = -3;
        } else if ('0'..='4').contains(&c) {
            board.cell[cell].qdir = c.to_digit(16).unwrap() as i32;
            i += 1;
            board.cell[cell].qnum = if chars.get(i) == Some(&'.') {
                -2
            } else {
                chars.get(i).and_then(|c| c.to_digit(16)).unwrap_or(0) as i32
            };
        } else if ('5'..='9').contains(&c) {
            board.cell[cell].qdir = c.to_digit(16).unwrap() as i32 - 5;
            let text: String = chars.iter().skip(i + 1).take(2).collect();
            board.cell[cell].qnum = hex(&text);
            i += 2;
        } else if c == '-' {
            board.cell[cell].qdir = chars
                .get(i + 1)
                .and_then(|c| c.to_digit(16))
                .unwrap_or(0) as i32;
            let text: String = chars.iter().skip(i + 2).take(3).collect();
            board.cell[cell].qnum = hex(&text);
            i += 4;
        } else if c.is_ascii_lowercase() {
            cell += c.to_digit(36).unwrap() as usize - 10;
        }
        cell += 1;
        i += 1;
    }
}

pub fn encode_body(board: &Board) -> String {
    const BASE36: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut result = String::new();
    let mut count = 0usize;
    for cell in &board.cell {
        let part = if cell.qnum == -2 {
            format!("{}.", cell.qdir)
        } else if cell.qnum == -3 {
            "+".to_string()
        } else if (0..16).contains(&cell.qnum) {
            format!("{}{:x}", cell.qdir, cell.qnum)
        } else if (16..256).contains(&cell.qnum) {
            format!("{}{:x}", cell.qdir + 5, cell.qnum)
        } else if (256..4096).contains(&cell.qnum) {
            format!("-{}{:x}", cell.qdir, cell.qnum)
        } else {
            count += 1;
            String::new()
        };
        if count == 0 {
            result.push_str(&part);
        } else if !part.is_empty() || count == 26 {
            result.push(BASE36[count + 9] as char);
            result.push_str(&part);
            count = 0;
        }
    }
    if count > 0 {
        result.push(BASE36[count + 9] as char);
    }
    result
}

pub fn encode_code(board: &Board) -> String {
    format!(
        "yajilin/{}/{}/{}",
        board.cols,
        board.rows,
        encode_body(board)
    )
}
pub fn encode_url(board: &Board) -> String {
    format!("https://puzz.link/p?{}", encode_code(board))
}

