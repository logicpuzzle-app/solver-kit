//! puzz.link の URL / コードとの相互変換。
//!
//! ぬりかべは数独と同じ Number16 形式(16 進 1 桁 + `-`/`+` の多桁 + `g`〜`z` の空白詰め)。
//! 正典は `pzprjs/src/variety-common/Encode.js` の `decodeNumber16` / `encodeNumber16`。

use crate::board::{Board, NO_CLUE, UNKNOWN_CLUE};

/// `https://puzz.link/p?nurikabe/W/H/body` または `nurikabe/W/H/body` を読む。
pub fn decode_url(source: &str) -> Result<Board, String> {
    let trimmed = source.trim();
    let start = trimmed
        .find("nurikabe/")
        .ok_or_else(|| "nurikabe の puzz.link コードではありません".to_string())?;
    let mut parts = trimmed[start..].split('/');
    parts.next(); // "nurikabe"
    let cols: i32 = parts
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "幅が読めません".to_string())?;
    let rows: i32 = parts
        .next()
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| "高さが読めません".to_string())?;
    let body: String = parts.collect::<Vec<_>>().join("/");
    let clues = decode_body(&body, (cols * rows) as usize)?;
    Board::new(cols, rows, clues)
}

/// Number16 のデコード。読み切れなかった残りは数字なしとして埋める。
pub fn decode_body(body: &str, cell_count: usize) -> Result<Vec<i32>, String> {
    let chars: Vec<char> = body.chars().collect();
    let mut clues = vec![NO_CLUE; cell_count];
    let mut cell = 0usize;
    let mut i = 0usize;
    let hex = |slice: &[char]| -> Result<i32, String> {
        let text: String = slice.iter().collect();
        i32::from_str_radix(&text, 16).map_err(|_| format!("不正なエンコード: {text}"))
    };
    while i < chars.len() && cell < cell_count {
        let c = chars[i];
        if c.is_ascii_hexdigit() {
            clues[cell] = c.to_digit(16).unwrap() as i32;
            i += 1;
            cell += 1;
        } else if c == '-' {
            if i + 3 > chars.len() {
                return Err("エンコードが途中で切れています".into());
            }
            clues[cell] = hex(&chars[i + 1..i + 3])?;
            i += 3;
            cell += 1;
        } else if c == '+' {
            if i + 4 > chars.len() {
                return Err("エンコードが途中で切れています".into());
            }
            clues[cell] = hex(&chars[i + 1..i + 4])?;
            i += 4;
            cell += 1;
        } else if c == '.' {
            clues[cell] = UNKNOWN_CLUE;
            i += 1;
            cell += 1;
        } else if ('g'..='z').contains(&c) {
            cell += c.to_digit(36).unwrap() as usize - 15;
            i += 1;
        } else {
            i += 1;
        }
    }
    Ok(clues)
}

/// Number16 のエンコード。`decode_body` と往復する。
pub fn encode_body(board: &Board) -> String {
    let mut out = String::new();
    let mut run = 0usize;
    let flush = |out: &mut String, run: &mut usize| {
        while *run > 0 {
            let take = (*run).min(20);
            out.push(char::from_u32('g' as u32 + take as u32 - 1).unwrap());
            *run -= take;
        }
    };
    for &clue in &board.clues {
        match clue {
            NO_CLUE => run += 1,
            UNKNOWN_CLUE => {
                flush(&mut out, &mut run);
                out.push('.');
            }
            n if (0..16).contains(&n) => {
                flush(&mut out, &mut run);
                out.push(char::from_digit(n as u32, 16).unwrap());
            }
            n if n < 256 => {
                flush(&mut out, &mut run);
                out.push('-');
                out.push_str(&format!("{n:02x}"));
            }
            n => {
                flush(&mut out, &mut run);
                out.push('+');
                out.push_str(&format!("{n:03x}"));
            }
        }
    }
    flush(&mut out, &mut run);
    out
}

pub fn encode_code(board: &Board) -> String {
    format!(
        "nurikabe/{}/{}/{}",
        board.cols,
        board.rows,
        encode_body(board)
    )
}

pub fn encode_url(board: &Board) -> String {
    format!("https://puzz.link/p?{}", encode_code(board))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// cspuz のテストに使われている実在の問題。
    /// 期待値は `cspuz_rs_puzzles/src/puzzles/nurikabe.rs` の `problem_for_tests`:
    /// (行1,列1)=8、(行2,列4)=8、(行3,列2)=9。
    const SAMPLE: &str = "https://puzz.link/p?nurikabe/6/6/m8n8i9u";

    #[test]
    fn decodes_a_published_problem() {
        let board = decode_url(SAMPLE).expect("デコードできる");
        assert_eq!((board.cols, board.rows), (6, 6));
        assert_eq!(board.clue(1, 1), 8);
        assert_eq!(board.clue(4, 2), 8);
        assert_eq!(board.clue(2, 3), 9);
        assert_eq!(board.clue_cells().len(), 3);
    }

    #[test]
    fn round_trips_the_canonical_code() {
        let board = decode_url(SAMPLE).unwrap();
        assert_eq!(encode_code(&board), "nurikabe/6/6/m8n8i9u");
    }

    #[test]
    fn handles_question_marks_and_wide_numbers() {
        let board = Board::new(3, 1, vec![UNKNOWN_CLUE, 20, NO_CLUE]).unwrap();
        let code = encode_body(&board);
        assert_eq!(decode_body(&code, 3).unwrap(), board.clues);
    }
}
