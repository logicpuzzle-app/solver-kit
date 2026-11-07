//! puzz.link URL の読み書き。
//!
//! pid は `akari`(pzprjs 上の内部名は `lightup`)。方式は pzprjs の `decode4Cell`。
//!
//! - `0`〜`4` … そのマスは数字つきのかべ
//! - `5`〜`9` … 数字つきのかべ + 白マス 1 つ
//! - `a`〜`e` … 数字つきのかべ + 白マス 2 つ
//! - `g`〜`z` … 白マスを `値 - 16 + 1` 個
//! - `.`     … 数字のないかべ
//!
//! 数字と空白詰めを 1 文字にまとめてあるのが `decode4Cell` の要点で、
//! 数独の `decodeNumber16` とは別方式。ここを取り違えると 1 マスずつずれる。

use crate::board::{Board, OPEN, WALL};

fn base36(c: char) -> Option<i32> {
    c.to_digit(36).map(|v| v as i32)
}

/// `akari/W/H/<本体>` または puzz.link の URL 全体を読む。
pub fn decode_url(source: &str) -> Result<Board, String> {
    let body = source
        .rsplit_once("akari/")
        .map(|(_, rest)| rest)
        .ok_or_else(|| format!("akari の URL ではありません: {source}"))?;
    let mut parts = body.split('/');
    let cols: i32 = parts
        .next()
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| "幅が読めません".to_string())?;
    let rows: i32 = parts
        .next()
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| "高さが読めません".to_string())?;
    let text = parts.next().unwrap_or("");
    decode_cells(cols, rows, text)
}

fn decode_cells(cols: i32, rows: i32, text: &str) -> Result<Board, String> {
    let count = (cols * rows) as usize;
    let mut cells = vec![OPEN; count];
    let mut at = 0usize;
    for ch in text.chars() {
        if at >= count {
            break;
        }
        match ch {
            '0'..='4' => {
                cells[at] = base36(ch).unwrap();
            }
            '5'..='9' => {
                cells[at] = base36(ch).unwrap() - 5;
                at += 1; // うしろに白マス 1 つ
            }
            'a'..='e' => {
                cells[at] = base36(ch).unwrap() - 10;
                at += 2; // うしろに白マス 2 つ
            }
            'g'..='z' => {
                at += (base36(ch).unwrap() - 16) as usize;
            }
            '.' => {
                cells[at] = WALL;
            }
            _ => return Err(format!("読めない文字です: {ch}")),
        }
        at += 1;
    }
    Board::new(cols, rows, cells)
}

/// `akari/W/H/<本体>` の形に戻す。
pub fn encode_code(board: &Board) -> String {
    let mut out = String::new();
    let mut run = 0usize; // まだ書き出していない白マスの数
    let count = board.cell_count();

    let flush = |out: &mut String, run: &mut usize| {
        while *run > 0 {
            let take = (*run).min(20);
            out.push(char::from_digit((take - 1 + 16) as u32, 36).unwrap());
            *run -= take;
        }
    };

    let mut index = 0usize;
    while index < count {
        let value = board.cells[index];
        if value == OPEN {
            run += 1;
            index += 1;
            continue;
        }
        flush(&mut out, &mut run);
        if value == WALL {
            out.push('.');
            index += 1;
            continue;
        }
        // 数字。うしろに続く白マスを 2 つまで同じ文字に畳める。
        let following = (1..=2)
            .take_while(|&step| {
                index + step < count && board.cells[index + step] == OPEN
            })
            .count();
        let code = value + 5 * following as i32;
        out.push(char::from_digit(code as u32, 36).unwrap());
        index += 1 + following;
    }
    format!("akari/{}/{}/{}", board.cols, board.rows, out)
}

pub fn encode_url(board: &Board) -> String {
    format!("https://puzz.link/p?{}", encode_code(board))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// cspuz の `problem_for_tests`(semiexp 氏の出題)。
    /// 手で 1 文字ずつ追って照合した唯一の正典。
    const CSPUZ_URL: &str = "https://puzz.link/p?akari/10/10/hcscl.h.idn.i.cgcndg.h.ncs.h";

    fn expected() -> Vec<i32> {
        let o = OPEN;
        let w = WALL;
        #[rustfmt::skip]
        let rows = vec![
            o, o, 2, o, o, o, o, o, o, o,
            o, o, o, o, o, o, o, o, 2, o,
            o, o, o, o, o, o, o, w, o, o,
            w, o, o, o, 3, o, o, o, o, o,
            o, o, o, o, o, w, o, o, o, w,
            2, o, o, o, 2, o, o, o, o, o,
            o, o, o, o, o, 3, o, o, o, w,
            o, o, w, o, o, o, o, o, o, o,
            o, 2, o, o, o, o, o, o, o, o,
            o, o, o, o, o, o, o, w, o, o,
        ];
        rows
    }

    #[test]
    fn decodes_the_cspuz_fixture() {
        let board = decode_url(CSPUZ_URL).unwrap();
        assert_eq!(board.cols, 10);
        assert_eq!(board.rows, 10);
        assert_eq!(board.cells, expected());
    }

    #[test]
    fn encoding_round_trips() {
        let board = decode_url(CSPUZ_URL).unwrap();
        let again = decode_url(&encode_url(&board)).unwrap();
        assert_eq!(board, again);
    }

    #[test]
    fn a_long_run_of_open_cells_round_trips() {
        // 白マス 30 連続は 1 文字に収まらないので 2 文字に割れる
        let board = Board::new(30, 1, vec![OPEN; 30]).unwrap();
        assert_eq!(decode_url(&encode_url(&board)).unwrap(), board);
    }

    #[test]
    fn a_number_at_the_very_end_round_trips() {
        let board = Board::new(3, 1, vec![OPEN, OPEN, 0]).unwrap();
        assert_eq!(decode_url(&encode_url(&board)).unwrap(), board);
    }
}
