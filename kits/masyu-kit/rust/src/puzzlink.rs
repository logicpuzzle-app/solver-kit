//! puzz.link URL の読み書き。
//!
//! 本体は 3 進 3 桁(空=0/白=1/黒=2、先頭マスが最上位桁)を base27 の
//! 1 文字にしたもの。長さは ceil(cols*rows/3) 文字ちょうどで、空白圧縮はない。
//! (pzprjs variety-common/Encode.js の decodeCircle / encodeCircle と、
//! cspuz の MultiDigit::new(3, 3) は同じもの。)
//!
//! variety 名は入力では mashu / masyu / pearl を受理し、出力は pzprjs に
//! 合わせて mashu。pflag `f`(全マス通過バリアント)は非対応。

use crate::board::Board;

const VARIETIES: [&str; 3] = ["mashu", "masyu", "pearl"];

pub fn decode_url(url: &str) -> Result<Board, String> {
    let query = url.rsplit('?').next().unwrap_or(url);
    let parts: Vec<&str> = query.split('/').collect();
    let start = parts
        .iter()
        .position(|p| VARIETIES.contains(p))
        .ok_or_else(|| format!("ましゅの URL ではない: {}", url))?;
    let rest = &parts[start + 1..];
    if rest.first() == Some(&"f") {
        return Err("全マス通過バリアント(pflag f)は非対応".into());
    }
    if rest.len() < 3 {
        return Err(format!("URL の形式が不正: {}", url));
    }
    let cols: usize = rest[0]
        .parse()
        .map_err(|_| format!("幅が読めない: {}", rest[0]))?;
    let rows: usize = rest[1]
        .parse()
        .map_err(|_| format!("高さが読めない: {}", rest[1]))?;
    let body = rest[2];

    let cell_count = cols
        .checked_mul(rows)
        .ok_or_else(|| "盤面が大きすぎる".to_string())?;
    let expected = (cell_count + 2) / 3;

    // pzprjs は `pos = min(期待長, 実長)` で読む。短い本体は残りを空マスとし、
    // 余った文字(puzsq には `.0` などが付いた URL が 138 件ある)は無視する。
    let mut cells = Vec::with_capacity(cell_count);
    for ch in body.chars().take(expected) {
        let value = ch
            .to_digit(27)
            .ok_or_else(|| format!("本体に不正な文字: {}", ch))?;
        for weight in [9, 3, 1] {
            if cells.len() < cell_count {
                cells.push((value / weight % 3) as i32);
            }
        }
    }
    cells.resize(cell_count, 0);
    Board::new(cols, rows, cells)
}

pub fn encode_code(board: &Board) -> String {
    let mut body = String::new();
    let mut value: u32 = 0;
    let mut packed = 0;
    for &cell in &board.cells {
        value = value * 3 + cell as u32;
        packed += 1;
        if packed == 3 {
            body.push(std::char::from_digit(value, 27).unwrap());
            value = 0;
            packed = 0;
        }
    }
    if packed > 0 {
        // 端数も上位桁詰め(pzprjs の tri = [9, 3, 1] と同じ)。
        for _ in packed..3 {
            value *= 3;
        }
        body.push(std::char::from_digit(value, 27).unwrap());
    }
    format!("mashu/{}/{}/{}", board.cols, board.rows, body)
}

pub fn encode_url(board: &Board) -> String {
    format!("https://puzz.link/p?{}", encode_code(board))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{BLACK, WHITE};

    #[test]
    fn roundtrip_of_a_small_board() {
        // pzprjs のテスト実例: 6x6。
        let board = decode_url("https://puzz.link/p?mashu/6/6/1063000i3000").unwrap();
        assert_eq!(board.cols, 6);
        assert_eq!(board.rows, 6);
        assert_eq!(encode_code(&board), "mashu/6/6/1063000i3000");
    }

    #[test]
    fn accepts_masyu_and_pearl_as_variety_names() {
        // cspuz のテストベクタ(10x10)。読み込みは masyu / pearl も受理し、
        // 書き出しは mashu で同じ本体に戻る。
        let body = "0600003i06b1300600000a30600i090330";
        let url = format!("https://puzz.link/p?masyu/10/10/{}", body);
        let board = decode_url(&url).unwrap();
        assert!(!board.pearls().is_empty());
        assert_eq!(encode_code(&board), format!("mashu/10/10/{}", body));
        let pearl = decode_url(&format!("https://puzz.link/p?pearl/10/10/{}", body));
        assert!(pearl.is_ok());
    }

    #[test]
    fn decodes_cell_values_in_big_endian_order() {
        // "1" = 001 → 3 マスめが白。 "i" = 18 = 200 → 1 マスめが黒。
        let board = decode_url("mashu/3/2/1i").unwrap();
        assert_eq!(board.cells, vec![0, 0, WHITE, BLACK, 0, 0]);
    }

    #[test]
    fn rejects_loop_full_and_garbage() {
        assert!(decode_url("mashu/f/6/6/1063000i3000").is_err());
        assert!(decode_url("yajilin/6/6/abc").is_err());
        assert!(decode_url("mashu/6/6/1063000i300z").is_err());
    }

    #[test]
    fn tolerates_short_bodies_and_trailing_junk() {
        // 短い本体は残りが空マス(pzprjs と同じ)。
        let short = decode_url("mashu/6/6/106").unwrap();
        assert_eq!(short.cells[..9], [0, 0, 1, 0, 0, 0, 0, 2, 0]);
        assert!(short.cells[9..].iter().all(|&c| c == 0));
        // puzsq には本体の後ろに `.0` が付いた URL がある。読み飛ばす。
        let junk = decode_url("mashu/6/6/1063000i3000.0").unwrap();
        assert_eq!(encode_code(&junk), "mashu/6/6/1063000i3000");
    }
}
