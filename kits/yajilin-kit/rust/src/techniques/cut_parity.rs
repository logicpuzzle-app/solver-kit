//! カットの偶奇。ループは閉路なので、盤面を縦または横の直線で 2 つに分けたとき、
//! その境界を横切る線分の本数は必ず偶数になる。さらにヤジリンの線は黒マス以外の
//! すべての白マスを通る一本のループなので、カットの両側に「必ず通るマス」があるなら
//! 横断は 2 本以上でもある。
//!
//! この 2 つを合わせると、横断本数 C の取りうる値は
//!   偶数 かつ max(確定線数, 両側に必通マスがあれば 2) ≤ C ≤ 確定線数+未確定数
//! に絞られる。取りうる C が一意で、それが上限(全部線)や下限(全部線禁)に一致する
//! 場合だけ、未確定辺をまとめて確定できる。取りうる C が無ければ矛盾している。
//!
//! 「必ず通るマス」の判定は健全側に倒す: 白確定マス・線の乗ったマスのほか、
//! ヒントでない隣接 2 マス(黒は隣接できないので少なくとも一方は白=必通)があれば十分。
//! 一般の閉領域まで広げると領域の列挙が爆発するので、直線カットに限定する。
//! 変則盤面の盤外マスやヒントマスは線を持てないので、自然に「横断不能」側に落ちる。

use crate::answer_methods::AnswerMethods;
use crate::answer_model::{LINE_BAR, LINE_BLANK, LINE_LINE};
use crate::position::Position;
use crate::reasons::CUT_PARITY_LINE;
use crate::status::Status;

/// 指定範囲(半開区間)の帯に「ループが必ず通るマス」があるか。
fn strip_must_be_visited(
    answer: &AnswerMethods<'_>,
    vertical: bool,
    from: i32,
    to: i32,
) -> bool {
    let board = answer.board;
    for t in from..to {
        for u in 0..(if vertical { board.rows } else { board.cols }) {
            let pos = if vertical {
                Position { x: t, y: u }
            } else {
                Position { x: u, y: t }
            };
            if !board.in_board(pos) {
                continue;
            }
            if board.cell[(pos.y * board.cols + pos.x) as usize].qnum != -1 {
                continue;
            }
            if answer.has_white_cell(pos) || answer.has_line(pos) || answer.is_line_edge(pos)
            {
                return true;
            }
            // ヒントでない隣接ペア: 黒は隣接できないので、少なくとも一方は白=必通
            for next in [
                Position { x: pos.x + 1, y: pos.y },
                Position { x: pos.x, y: pos.y + 1 },
            ] {
                let in_strip = if vertical {
                    next.x < to
                } else {
                    next.y < to
                };
                if in_strip
                    && board.in_board(next)
                    && board.cell[(next.y * board.cols + next.x) as usize].qnum == -1
                {
                    return true;
                }
            }
        }
    }
    false
}

pub fn cut_parity(answer: &mut AnswerMethods<'_>) -> Status {
    let cols = answer.board.cols;
    let rows = answer.board.rows;
    let mut advanced = false;
    for vertical in [true, false] {
        let cuts = if vertical { cols } else { rows };
        let len = if vertical { rows } else { cols };
        for c in 1..cuts {
            let mut lines = 0;
            let mut unknowns: Vec<(Position, Position)> = Vec::new();
            for t in 0..len {
                let (a, b) = if vertical {
                    (Position { x: c - 1, y: t }, Position { x: c, y: t })
                } else {
                    (Position { x: t, y: c - 1 }, Position { x: t, y: c })
                };
                let state = answer.get_line_state(a, b).unwrap_or(LINE_BLANK);
                if state == LINE_LINE {
                    lines += 1;
                } else if state == LINE_BAR || answer.forbidden(a) || answer.forbidden(b) {
                    // この辺は横断できない
                } else {
                    unknowns.push((a, b));
                }
            }
            let both_visited = strip_must_be_visited(answer, vertical, 0, c)
                && strip_must_be_visited(answer, vertical, c, cuts);
            let low = if both_visited { lines.max(2) } else { lines };
            let high = lines + unknowns.len() as i32;
            // 取りうる横断本数(偶数)の最小と最大
            let c_min = if low % 2 == 0 { low } else { low + 1 };
            let c_max = if high % 2 == 0 { high } else { high - 1 };
            if c_min > c_max {
                return Status::Broken;
            }
            if unknowns.is_empty() || c_min != c_max {
                continue;
            }
            if c_max == high {
                // 未確定辺はすべて線
                for (a, b) in unknowns {
                    if answer.add_line(&[a, b], CUT_PARITY_LINE) {
                        advanced = true;
                    }
                }
            } else if c_min == lines {
                // 未確定辺はすべて線禁
                for (a, b) in unknowns {
                    answer.set_line_bar(a, b);
                    advanced = true;
                }
            }
        }
    }
    if advanced {
        Status::Advanced
    } else {
        Status::Stopped
    }
}
