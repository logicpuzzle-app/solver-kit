//! 照らし手の場合分け(段階 5)。カタログ E「ビーム」「回廊」の一般形。
//!
//! まだ照らされていない白マス u は、必ず C(u)(u を照らせる場所)のどれかに
//! 置かれた照明で照らされる。そこで **C(u) の各マスを「ここが照明だ」と仮定して**
//! 安い手筋で押し込み、成り立たない場合を捨て、
//! 生き残った場合すべてに共通するマスを確定させる。
//!
//! カタログの「ビーム」(かべが縦に連なると照明の置き方が 2 択に絞られ連鎖する)も
//! 「回廊」(数字が組み合わさって白マスの並びが決まる)も、形は違うが理屈は同じで
//! 「照らし手が数通りしかない → どの場合でも同じところが決まる」に尽きる。
//! 形を覚えて当てはめるより、場合分けを直接回す方が短く、取りこぼしもない。
//!
//! 仮置きとの違いは**場合分けの単位**。仮置きは全マスを黒白で試すが、こちらは
//! 「このマスを照らすのは誰か」という意味のある少数の場合だけを見る。
//! 人が実際にやる読みに近く、そのぶん安い。
//!
//! 場合の集合は u を照らす候補の全体なので、少なくとも 1 つは成り立つ
//! (網羅している)。だから共通部分を取ってよい。全滅したら矛盾。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::{AnswerModel, CellState};
use crate::board::Board;
use crate::reasons::SOURCE_CASES;
use crate::status::Status;
use crate::techniques::clue::clue;
use crate::techniques::clue_cases::survives;
use crate::techniques::lamp_ray::lamp_ray;
use crate::techniques::only_source::only_source;

/// 場合分けする照らし手の数の上限。これを超える広い場所は、まだ絞れていないので触らない。
///
/// 5 → 12 に上げると、仮置きに頼らず解ける問題が 584/646 → 623/646 に増え、
/// **実行時間は変わらない**(112 秒 → 108 秒。仮置きに落ちる問題が減るぶん相殺される)。
///
/// 2〜3 通りの読みと 12 通りの読みを別の段階に分けることも試したが、
/// 一致率は 62.2% → 61.9% と下がった。両者の申告★の分布はほとんど同じで
/// (★1〜5 で 1/22/57/20/1 と 1/22/50/25/1)、**人は場合分けの広さを
/// 難しさとして区別していない**。分けない。
const MAX_CASES: usize = 12;

/// 1 巡で場合分けを試すマスの数の上限。
///
/// 照らし手が少ない順に並べてから上から試し、1 つでも確定したら戻る。
/// 上限を切っても取り逃がすだけで嘘はつかないし、確定が出ればソルバーが
/// 安い手筋から回し直すので、次の巡でまた上位から試される。
///
/// 25x20 の盤面では未照射マスが数百あり、全部に 12 通りの場合分けを回すと
/// 1 問で 90 秒を超えた。絞れているマスほど確定が出やすいので、上位だけ見れば足りる。
const MAX_TARGETS: usize = 64;

/// 安い手筋だけで動かなくなるまで押し込む。矛盾したら None。
fn settle(board: &Board, trial: &mut AnswerModel) -> Option<()> {
    loop {
        let before = trial.unknown_count();
        let status = {
            let mut methods = AnswerMethods::new(board, trial, None);
            let a = clue(&mut methods);
            let b = lamp_ray(&mut methods);
            let c = only_source(&mut methods);
            [a, b, c]
                .into_iter()
                .fold(Status::Stopped, crate::answer_methods::merge_status)
        };
        if status == Status::Broken {
            return None;
        }
        if trial.unknown_count() == before {
            return Some(());
        }
    }
}

pub fn source_cases(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let count = board.cell_count();
    let lit = answer.answer.lit(board);

    // 照らし手が少ないマスから見る。絞れているほど確定が出やすい。
    let mut targets: Vec<(usize, Vec<usize>)> = Vec::new();
    for index in 0..count {
        if !board.is_open(index) || lit[index] {
            continue;
        }
        let candidates: Vec<usize> = board
            .sight(index)
            .into_iter()
            .filter(|&&c| answer.answer.is_unknown(c))
            .copied()
            .collect();
        if candidates.len() >= 2 && candidates.len() <= MAX_CASES {
            targets.push((index, candidates));
        }
    }
    targets.sort_by_key(|(_, candidates)| candidates.len());
    targets.truncate(MAX_TARGETS);

    for (_, candidates) in targets {
        let mut always_lamp = vec![true; count];
        let mut always_empty = vec![true; count];
        let mut found = 0;
        for &source in &candidates {
            let mut trial = answer.answer.clone_for_trial();
            if trial.set(source, CellState::Lamp).is_err() {
                continue;
            }
            if settle(board, &mut trial).is_none() || !survives(board, &trial) {
                continue;
            }
            found += 1;
            for cell in 0..count {
                match trial.state(cell) {
                    CellState::Lamp => always_empty[cell] = false,
                    CellState::Empty => always_lamp[cell] = false,
                    CellState::Unknown => {
                        always_lamp[cell] = false;
                        always_empty[cell] = false;
                    }
                }
            }
        }
        if found == 0 {
            return Status::Broken; // 誰にも照らせない
        }

        let forced: Vec<(usize, CellState)> = (0..count)
            .filter(|&cell| answer.answer.is_unknown(cell))
            .filter_map(|cell| {
                if always_lamp[cell] {
                    Some((cell, CellState::Lamp))
                } else if always_empty[cell] {
                    Some((cell, CellState::Empty))
                } else {
                    None
                }
            })
            .collect();
        if forced.is_empty() {
            continue;
        }
        // 1 つでも決まったら戻る。ソルバーが安い手筋から回し直すので、
        // ここで全部のマスを見続けるより速く、記録も素直になる。
        let mut result = Status::Stopped;
        for (index, state) in forced {
            result = merge_status(result, answer.set(index, state, SOURCE_CASES));
            if result == Status::Broken {
                return result;
            }
        }
        return result;
    }
    Status::Stopped
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::{Board, OPEN, WALL};

    #[test]
    fn every_case_agreeing_decides_the_cell() {
        // 1x4: [白][白][かべ][白]
        // マス 3 は自分しか照らせないので only_source の領分。
        // マス 0 を照らせるのは 0 と 1 の 2 通り。どちらの場合でも
        // マス 3 は照明になる(自分しか照らせないため)。
        let board = Board::new(4, 1, vec![OPEN, OPEN, WALL, OPEN]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        let status = source_cases(&mut methods);
        assert_ne!(status, Status::Broken);
        if status == Status::Advanced {
            assert!(model.is_lamp(3));
        }
    }

    #[test]
    fn a_wide_open_board_is_left_alone() {
        // 照らし手が多すぎるマスばかりなので手を出さない
        let board = Board::new(6, 6, vec![OPEN; 36]).unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(source_cases(&mut methods), Status::Stopped);
    }

    #[test]
    fn it_never_contradicts_a_real_puzzle() {
        let board = crate::puzzlink::decode_url(
            "https://puzz.link/p?akari/10/10/hcscl.h.idn.i.cgcndg.h.ncs.h",
        )
        .unwrap();
        let mut model = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_ne!(source_cases(&mut methods), Status::Broken);
    }
}
