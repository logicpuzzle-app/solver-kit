//! 白のまとまりの行き先(カタログ C)。
//!
//! 数字を含まない白の連結ブロックは、いつか必ずどれかの数字につながらなければならない。
//! そこで各ブロックについて「どの数字なら引き取れるか」を調べ、
//! - 引き取れる数字が 1 つもなければ矛盾
//! - あるマスをかべにすると、どの数字からも引き取れなくなる → そのマスは白
//!
//! `reachable` は数字から外向きに届く範囲を見るだけなので、この向きの推論はできない。
//! `shapes` は数字マスを起点に形を数え上げるので、白ブロックが遠いと列挙が爆発して諦める。
//! 人間が「この白は 6 につなぐしかなくて、道はここしかない」と読むのがこの手筋。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::AnswerModel;
use crate::board::{Board, UNKNOWN_CLUE};
use crate::reasons::WHITE_LINK;
use crate::status::Status;
use std::collections::VecDeque;

/// そのシマが使えるマスか。他の数字マスとその隣は、シマ同士がくっつくので使えない。
fn usable(board: &Board, answer: &AnswerModel, clue_index: usize, index: usize) -> bool {
    if answer.is_black(index) {
        return false;
    }
    let (x, y) = board.position(index);
    if board.is_clue(x, y) && index != clue_index {
        return false;
    }
    board.neighbours(index).into_iter().all(|n| {
        let (nx, ny) = board.position(n);
        !board.is_clue(nx, ny) || n == clue_index
    })
}

/// index を含む白の連結成分。
fn white_group(board: &Board, answer: &AnswerModel, index: usize) -> Vec<usize> {
    let mut seen = vec![false; board.cell_count()];
    let mut stack = vec![index];
    let mut out = Vec::new();
    seen[index] = true;
    while let Some(i) = stack.pop() {
        out.push(i);
        for n in board.neighbours(i) {
            if !seen[n] && answer.is_white(n) {
                seen[n] = true;
                stack.push(n);
            }
        }
    }
    out
}

/// 数字 clue から白ブロック group まで、あと何マス足せばつながるか。
/// `blocked` のマスはかべとみなす。つなげないなら None。
///
/// 返すのは「新しく白にする必要のあるマス数」。visited には通れた範囲を残す。
///
/// 途中に別の(数字を持たない)白ブロックがあれば通り抜けてよい。そのブロックは
/// まるごとシマに入るので本当はもっと費用がかかるが、ここでは 1 マスとだけ数える。
/// 費用を少なめに見積もる分には、確定を取り逃すだけで嘘はつかない。
fn link_cost(
    board: &Board,
    answer: &AnswerModel,
    clue_index: usize,
    own: &[usize],
    has_clue: &[bool],
    in_group: &[bool],
    blocked: Option<usize>,
    visited: &mut Vec<bool>,
) -> Option<usize> {
    let count = board.cell_count();
    let mut distance = vec![usize::MAX; count];
    let mut queue = VecDeque::new();
    for &index in own {
        distance[index] = 0;
        queue.push_back(index);
    }
    while let Some(index) = queue.pop_front() {
        for n in board.neighbours(index) {
            if in_group[n] {
                return Some(distance[index]); // group に接した。間に挟んだマス数がそのまま費用
            }
            if distance[n] != usize::MAX
                || Some(n) == blocked
                || has_clue[n]
                || answer.is_black(n)
                || !usable(board, answer, clue_index, n)
            {
                continue;
            }
            distance[n] = distance[index] + 1;
            visited[n] = true;
            queue.push_back(n);
        }
    }
    None
}

/// 数字 clue が白ブロック group を引き取れるか。引き取れるなら通れた範囲を visited に足す。
fn can_claim(
    board: &Board,
    answer: &AnswerModel,
    clue_index: usize,
    size: i32,
    own: &[usize],
    group: &[usize],
    has_clue: &[bool],
    in_group: &[bool],
    blocked: Option<usize>,
    visited: &mut Vec<bool>,
) -> bool {
    // ブロック自体がこのシマに使えなければ論外
    if group.iter().any(|&g| !usable(board, answer, clue_index, g)) {
        return false;
    }
    match link_cost(
        board, answer, clue_index, own, has_clue, in_group, blocked, visited,
    ) {
        None => false,
        Some(cost) => {
            if size == UNKNOWN_CLUE {
                return true;
            }
            own.len() + group.len() + cost <= size as usize
        }
    }
}

pub fn white_link(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let count = board.cell_count();
    let clues = board.clue_cells();
    if clues.is_empty() {
        return Status::Stopped;
    }

    // 各数字の、いま確定しているシマ
    let owns: Vec<Vec<usize>> = clues
        .iter()
        .map(|&(index, _)| white_group(board, answer.answer, index))
        .collect();
    let mut has_clue = vec![false; count];
    for own in &owns {
        for &index in own {
            has_clue[index] = true;
        }
    }

    // 判定はすべて「手をつける前の盤面」で行い、書き込みは最後にまとめて行う。
    // 途中で白を足すと owns / has_clue が古くなり、同じシマを二重に数えて
    // 「どこにもつながらない」と誤判定してしまう。
    let mut forced = Vec::new();
    let mut done = vec![false; count];
    for start in 0..count {
        if !answer.answer.is_white(start) || has_clue[start] || done[start] {
            continue;
        }
        let group = white_group(board, answer.answer, start);
        let mut in_group = vec![false; count];
        for &index in &group {
            in_group[index] = true;
            done[index] = true;
        }

        // このブロックを引き取れる数字と、そのとき通れるマスを集める
        let mut options = Vec::new();
        let mut region = vec![false; count];
        for (i, &(clue_index, size)) in clues.iter().enumerate() {
            if can_claim(
                board,
                answer.answer,
                clue_index,
                size,
                &owns[i],
                &group,
                &has_clue,
                &in_group,
                None,
                &mut region,
            ) {
                options.push(i);
            }
        }
        if options.is_empty() {
            return Status::Broken; // どの数字にもつながらない白がある
        }

        // 通り道の候補を 1 マスずつかべにしてみて、全滅するならそのマスは白
        for target in 0..count {
            if !region[target] || !answer.answer.is_unknown(target) {
                continue;
            }
            let mut scratch = vec![false; count];
            let survives = options.iter().any(|&i| {
                let (clue_index, size) = clues[i];
                can_claim(
                    board,
                    answer.answer,
                    clue_index,
                    size,
                    &owns[i],
                    &group,
                    &has_clue,
                    &in_group,
                    Some(target),
                    &mut scratch,
                )
            });
            if !survives {
                forced.push(target);
            }
        }
    }

    let mut result = Status::Stopped;
    for index in forced {
        result = merge_status(result, answer.set_white(index, WHITE_LINK));
        if result == Status::Broken {
            return result;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::CellState;
    use crate::board::{Board, NO_CLUE};

    #[test]
    fn the_only_corridor_to_a_stray_white_is_forced() {
        // 1x5: [4][.][.][白][.]
        // 4 のシマは 0..3 を占めるしかないので、間の 2 マスが白に決まる
        let board = Board::new(5, 1, vec![4, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(3, CellState::White).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(white_link(&mut methods), Status::Advanced);
        assert!(answer.is_white(1) && answer.is_white(2));
    }

    #[test]
    fn two_routes_of_equal_cost_decide_nothing() {
        // 3x3 の中央が白、左上が 3 → L 字の 2 通りがあるので確定しない
        let mut clues = vec![NO_CLUE; 9];
        clues[0] = 3;
        let board = Board::new(3, 3, clues).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(4, CellState::White).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        white_link(&mut methods);
        assert!(answer.is_unknown(1) && answer.is_unknown(3));
    }

    #[test]
    fn a_white_no_clue_can_reach_is_a_contradiction() {
        // 1x5: [2][.][.][.][白] — 2 では届かない
        let board = Board::new(5, 1, vec![2, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        answer.set(4, CellState::White).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(white_link(&mut methods), Status::Broken);
    }
}
