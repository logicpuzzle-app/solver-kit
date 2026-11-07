use crate::board::Board;

pub fn decode_url(source: &str) -> Result<Board, String> {
    let trimmed = source.trim();
    let start = trimmed
        .find("slither/")
        .ok_or_else(|| "slither の puzz.link コードではありません".to_string())?;
    let code = &trimmed[start..];
    let mut parts = code.split('/');
    if parts.next() != Some("slither") {
        return Err("slither の puzz.link コードではありません".into());
    }
    let cols: usize = parts
        .next()
        .ok_or_else(|| "列数がありません".to_string())?
        .parse()
        .map_err(|_| "列数が不正です".to_string())?;
    let rows: usize = parts
        .next()
        .ok_or_else(|| "行数がありません".to_string())?
        .parse()
        .map_err(|_| "行数が不正です".to_string())?;
    let raw_body = parts
        .next()
        .ok_or_else(|| "問題本体がありません".to_string())?;
    let body = raw_body
        .split(['?', '#', '&'])
        .next()
        .expect("split は必ず一要素を返す");
    if let Some(flag) = parts.next() {
        let flag = flag
            .split(['?', '#', '&'])
            .next()
            .expect("split は必ず一要素を返す");
        if flag != "f" && !flag.is_empty() {
            return Err(format!("未知の末尾フラグです: {flag}"));
        }
    }
    decode_body(cols, rows, body)
}

fn decode_body(cols: usize, rows: usize, body: &str) -> Result<Board, String> {
    let len = cols
        .checked_mul(rows)
        .ok_or_else(|| "盤面サイズが大きすぎます".to_string())?;
    let mut clues = vec![-1; len];
    let mut cell = 0usize;
    for character in body.chars() {
        if cell >= len {
            break;
        }
        match character {
            '0'..='4' => {
                clues[cell] = character as i8 - b'0' as i8;
                cell += 1;
            }
            '5'..='9' => {
                clues[cell] = character as i8 - b'5' as i8;
                cell += 2;
            }
            'a'..='e' => {
                clues[cell] = character as i8 - b'a' as i8;
                cell += 3;
            }
            'g'..='z' => {
                let value = character
                    .to_digit(36)
                    .expect("英小文字は base36 に含まれる") as usize;
                cell += value - 15;
            }
            '.' => {
                clues[cell] = -2;
                cell += 1;
            }
            _ => return Err(format!("問題本体に不正な文字があります: {character}")),
        }
    }
    Board::new(cols, rows, clues)
}

pub fn encode_code(board: &Board) -> String {
    format!(
        "slither/{}/{}/{}",
        board.cols,
        board.rows,
        encode_body(board)
    )
}

pub fn encode_url(board: &Board) -> String {
    format!("https://puzz.link/p?{}", encode_code(board))
}

fn encode_body(board: &Board) -> String {
    let mut count = 0usize;
    let mut encoded = String::new();
    let mut cell = 0usize;
    while cell < board.clues.len() {
        let clue = board.clues[cell];
        let mut piece = None;
        if clue >= 0 {
            let value = clue as u32;
            if cell + 1 < board.clues.len() && board.clues[cell + 1] != -1 {
                piece = char::from_digit(value, 16);
            } else if cell + 2 < board.clues.len() && board.clues[cell + 2] != -1 {
                piece = char::from_digit(5 + value, 16);
                cell += 1;
            } else {
                piece = char::from_digit(10 + value, 16);
                cell += 2;
            }
        } else if clue == -2 {
            piece = Some('.');
        } else {
            count += 1;
        }

        if count == 0 {
            if let Some(character) = piece {
                encoded.push(character);
            }
        } else if piece.is_some() || count == 20 {
            encoded.push(
                char::from_digit((count + 15) as u32, 36)
                    .expect("空白ランは base36 一文字に収まる"),
            );
            if let Some(character) = piece {
                encoded.push(character);
            }
            count = 0;
        }
        cell += 1;
    }
    if count > 0 {
        encoded.push(
            char::from_digit((count + 15) as u32, 36)
                .expect("空白ランは base36 一文字に収まる"),
        );
    }
    encoded
}
