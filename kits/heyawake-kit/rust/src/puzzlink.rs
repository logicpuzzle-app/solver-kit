//! puzz.link URL の読み書き。
//!
//! 境界は縦境界、横境界の順に、行優先の 5 ビットを base32 1 文字へ詰める。
//! 数字は部屋の左上出現順で、`g`〜`z` は数字なしを 1〜20 部屋ぶん圧縮する。

use crate::board::Board;

fn base32(ch: char) -> Option<u32> {
    ch.to_digit(32)
}

fn decode_border_part(text: &str, count: usize) -> Result<(Vec<bool>, &str), String> {
    let chars = count.div_ceil(5);
    if text.len() < chars || !text.is_char_boundary(chars) {
        return Err("境界部が途中で終わっています".into());
    }
    let (encoded, rest) = text.split_at(chars);
    let mut borders = Vec::with_capacity(count);
    for ch in encoded.chars() {
        let value =
            base32(ch).ok_or_else(|| format!("境界部の文字が読めません: {ch}"))?;
        for bit in [16, 8, 4, 2, 1] {
            if borders.len() < count {
                borders.push(value & bit != 0);
            }
        }
    }
    Ok((borders, rest))
}

fn decode_room_clues(text: &str, count: usize) -> Result<Vec<Option<i32>>, String> {
    let mut clues = vec![None; count];
    let chars: Vec<char> = text.chars().collect();
    let mut at = 0usize;
    let mut i = 0usize;
    while i < chars.len() && at < count {
        let ch = chars[i];
        match ch {
            '0'..='9' | 'a'..='f' => {
                clues[at] = Some(ch.to_digit(16).unwrap() as i32);
                at += 1;
                i += 1;
            }
            '-' => {
                if i + 2 >= chars.len() {
                    return Err("2 桁の部屋数字が途中で終わっています".into());
                }
                let hi = chars[i + 1]
                    .to_digit(16)
                    .ok_or_else(|| "2 桁の部屋数字が読めません".to_string())?;
                let lo = chars[i + 2]
                    .to_digit(16)
                    .ok_or_else(|| "2 桁の部屋数字が読めません".to_string())?;
                clues[at] = Some(((hi << 4) | lo) as i32);
                at += 1;
                i += 3;
            }
            '+' => {
                if i + 3 >= chars.len() {
                    return Err("3 桁の部屋数字が途中で終わっています".into());
                }
                let a = chars[i + 1]
                    .to_digit(16)
                    .ok_or_else(|| "3 桁の部屋数字が読めません".to_string())?;
                let b = chars[i + 2]
                    .to_digit(16)
                    .ok_or_else(|| "3 桁の部屋数字が読めません".to_string())?;
                let c = chars[i + 3]
                    .to_digit(16)
                    .ok_or_else(|| "3 桁の部屋数字が読めません".to_string())?;
                clues[at] = Some(((a << 8) | (b << 4) | c) as i32);
                at += 1;
                i += 4;
            }
            '.' => {
                // cspuz の Dict(Some(-1), ".") と同じく、圧縮された None と区別する。
                clues[at] = Some(-1);
                at += 1;
                i += 1;
            }
            'g'..='z' => {
                let skip = ch.to_digit(36).unwrap() as usize - 15;
                if at + skip > count {
                    return Err("数字なし部屋の圧縮が部屋数を超えています".into());
                }
                at += skip;
                i += 1;
            }
            _ => return Err(format!("数字部の文字が読めません: {ch}")),
        }
    }
    if i != chars.len() {
        return Err("数字部が部屋数より長すぎます".into());
    }
    Ok(clues)
}

fn room_count(
    cols: i32,
    rows: i32,
    vertical_borders: &[bool],
    horizontal_borders: &[bool],
) -> usize {
    let count = (cols * rows) as usize;
    let mut seen = vec![false; count];
    let mut rooms = 0;
    for start in 0..count {
        if seen[start] {
            continue;
        }
        rooms += 1;
        seen[start] = true;
        let mut stack = vec![start];
        while let Some(index) = stack.pop() {
            let x = index as i32 % cols;
            let y = index as i32 / cols;
            let mut visit = |nx: i32, ny: i32, open: bool| {
                if open {
                    let next = (ny * cols + nx) as usize;
                    if !seen[next] {
                        seen[next] = true;
                        stack.push(next);
                    }
                }
            };
            visit(
                x - 1,
                y,
                x > 0 && !vertical_borders[(y * (cols - 1) + x - 1) as usize],
            );
            visit(
                x + 1,
                y,
                x + 1 < cols && !vertical_borders[(y * (cols - 1) + x) as usize],
            );
            visit(
                x,
                y - 1,
                y > 0 && !horizontal_borders[((y - 1) * cols + x) as usize],
            );
            visit(
                x,
                y + 1,
                y + 1 < rows && !horizontal_borders[(y * cols + x) as usize],
            );
        }
    }
    rooms
}

/// `heyawake/W/H/<境界部><数字部>` または puzz.link の URL 全体を読む。
pub fn decode_url(source: &str) -> Result<Board, String> {
    let body = source
        .rsplit_once("heyawake/")
        .map(|(_, rest)| rest)
        .ok_or_else(|| format!("heyawake の URL ではありません: {source}"))?;
    let mut parts = body.split('/');
    let cols: i32 = parts
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| "幅が読めません".to_string())?;
    let rows: i32 = parts
        .next()
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| "高さが読めません".to_string())?;
    if cols <= 0 || rows <= 0 {
        return Err("盤面サイズは正でなければなりません".into());
    }
    let text = parts.next().unwrap_or("");
    if parts.next().is_some() {
        return Err("URL の問題部に余分な区切りがあります".into());
    }
    let vertical_count = (rows * (cols - 1)) as usize;
    let horizontal_count = ((rows - 1) * cols) as usize;
    let (vertical, rest) = decode_border_part(text, vertical_count)?;
    let (horizontal, number_text) = decode_border_part(rest, horizontal_count)?;

    let clues = decode_room_clues(
        number_text,
        room_count(cols, rows, &vertical, &horizontal),
    )?;
    Board::new(cols, rows, vertical, horizontal, clues)
}

fn encode_border_part(borders: &[bool]) -> String {
    let mut out = String::new();
    for chunk in borders.chunks(5) {
        let mut value = 0u32;
        for (at, &border) in chunk.iter().enumerate() {
            if border {
                value |= [16, 8, 4, 2, 1][at];
            }
        }
        out.push(char::from_digit(value, 32).unwrap());
    }
    out
}

fn encode_room_clues(board: &Board) -> String {
    let mut out = String::new();
    let mut empty = 0usize;
    let flush = |out: &mut String, empty: &mut usize| {
        while *empty > 0 {
            let take = (*empty).min(20);
            out.push(char::from_digit((15 + take) as u32, 36).unwrap());
            *empty -= take;
        }
    };
    for room in &board.rooms {
        match room.clue {
            None => empty += 1,
            Some(value) => {
                flush(&mut out, &mut empty);
                match value {
                    -1 => out.push('.'),
                    0..=15 => out.push(char::from_digit(value as u32, 16).unwrap()),
                    16..=255 => out.push_str(&format!("-{value:02x}")),
                    256..=4095 => out.push_str(&format!("+{value:03x}")),
                    _ => unreachable!("Board::new が範囲を検査する"),
                }
            }
        }
    }
    flush(&mut out, &mut empty);
    out
}

pub fn encode_code(board: &Board) -> String {
    format!(
        "heyawake/{}/{}/{}{}{}",
        board.cols,
        board.rows,
        encode_border_part(&board.vertical_borders),
        encode_border_part(&board.horizontal_borders),
        encode_room_clues(board)
    )
}

pub fn encode_url(board: &Board) -> String {
    format!("https://puzz.link/p?{}", encode_code(board))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CSPUZ_URL: &str = "https://puzz.link/p?heyawake/6/6/aa66aapv0fu0g2i3k";

    #[test]
    fn decodes_rooms_and_clues_in_top_left_order() {
        let board = decode_url(CSPUZ_URL).unwrap();
        assert_eq!(board.cols, 6);
        assert_eq!(board.rows, 6);
        assert_eq!(board.rooms.len(), 11);
        assert_eq!(
            board.rooms.iter().map(|room| room.clue).collect::<Vec<_>>(),
            vec![
                None,
                Some(2),
                None,
                None,
                None,
                Some(3),
                None,
                None,
                None,
                None,
                None
            ]
        );
    }

    #[test]
    fn the_cspuz_url_round_trips_byte_for_byte() {
        let board = decode_url(CSPUZ_URL).unwrap();
        assert_eq!(encode_url(&board), CSPUZ_URL);
    }

    #[test]
    fn explicit_empty_and_large_hex_numbers_round_trip() {
        let board = Board::new(
            4,
            1,
            vec![true, true, true],
            vec![],
            vec![Some(-1), Some(15), Some(16), Some(4095)],
        )
        .unwrap();
        assert_eq!(decode_url(&encode_url(&board)).unwrap(), board);
    }
}
