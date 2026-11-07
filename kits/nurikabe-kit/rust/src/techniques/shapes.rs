//! シマの形の全列挙(カタログ B の強化版)。
//!
//! 数字 n のシマが取りうる形(n マスの連結集合)をすべて数え上げ、
//! - すべての形に含まれるマスは白
//! - どのシマのどの形にも含まれないマスはかべ
//! - 形が 1 つもないシマがあれば矛盾
//!
//! `reachable` の「距離で切る」より強い。形の数が増えすぎる大きなシマは
//! 打ち切って諦める(その場合そのシマは判定に寄与しない)。
//!
//! へやわけの `roomCandSolve` と同じ発想。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::answer_model::AnswerModel;
use crate::board::{Board, UNKNOWN_CLUE};
use crate::reasons::{SHAPE_ALWAYS_WHITE, SHAPE_NEVER_BLACK};
use crate::status::Status;

/// 1 つのシマにつき数え上げる形の上限。超えたら諦める。
const SHAPE_LIMIT: usize = 2_000;

/// 列挙に入る前の足切り。到達可能なマスがシマの大きさよりずっと多いと形が爆発するので、
/// その場合は最初から諦める(他の手筋に任せる)。
const SLACK_LIMIT: usize = 7;

/// 既に確定している自分のシマから、あと伸ばせる距離まで辿ったマス数。列挙量の目安。
///
/// 起点を数字マスではなく確定済みのシマ全体にするのが要点。終盤の大きなシマは
/// ほとんど確定していて残り 1〜2 マスしかないのに、数字から距離 size-1 で数えると
/// 盤面の半分を数えてしまい、いつまでも列挙に入れない。
fn free_area(
    board: &Board,
    answer: &AnswerModel,
    clue_index: usize,
    own: &[usize],
    remaining: usize,
) -> usize {
    let mut seen = vec![false; board.cell_count()];
    let mut queue = std::collections::VecDeque::new();
    for &index in own {
        seen[index] = true;
        queue.push_back((index, 0usize));
    }
    let size = remaining + 1;
    let mut count = 0usize;
    while let Some((index, d)) = queue.pop_front() {
        count += 1;
        if d + 1 >= size {
            continue;
        }
        for n in board.neighbours(index) {
            if !seen[n] && usable(board, answer, clue_index, n) {
                seen[n] = true;
                queue.push_back((n, d + 1));
            }
        }
    }
    count
}

/// そのシマが使えるマスか。他の数字マスとその隣は使えない。
fn usable(board: &Board, answer: &AnswerModel, clue_index: usize, index: usize) -> bool {
    if answer.is_black(index) {
        return false;
    }
    let (x, y) = board.position(index);
    if board.is_clue(x, y) && index != clue_index {
        return false;
    }
    for n in board.neighbours(index) {
        let (nx, ny) = board.position(n);
        if board.is_clue(nx, ny) && n != clue_index {
            return false;
        }
    }
    true
}

/// clue_index を含む size マスの連結集合をすべて列挙し、
/// (どの形にも入るマス, いずれかの形に入るマス) を返す。打ち切ったら None。
///
/// 各集合をちょうど 1 回だけ数えるため、候補を固定順のリストで持ち、
/// 先頭から「入れる / 永久に入れない」を決めていく。
fn enumerate(
    board: &Board,
    answer: &AnswerModel,
    clue_index: usize,
    size: usize,
    required: &[usize],
) -> Option<(Vec<bool>, Vec<bool>)> {
    let count = board.cell_count();
    let mut always = vec![true; count];
    let mut ever = vec![false; count];
    let mut found = 0usize;

    struct Ctx<'a> {
        board: &'a Board,
        answer: &'a AnswerModel,
        clue_index: usize,
        size: usize,
        required: &'a [usize],
        found: &'a mut usize,
        always: &'a mut Vec<bool>,
        ever: &'a mut Vec<bool>,
    }

    /// `candidates[at..]` を順に見て、入れる/入れないを決める。
    /// `in_shape` が現在の集合、`chosen` はその大きさ。
    fn walk(
        ctx: &mut Ctx<'_>,
        in_shape: &mut Vec<bool>,
        chosen: usize,
        candidates: &mut Vec<usize>,
        at: usize,
        excluded: &mut Vec<bool>,
    ) -> bool {
        if chosen == ctx.size {
            if ctx.required.iter().any(|&r| !in_shape[r]) {
                return true; // 確定済みの白マスを含まない形は無効
            }
            if !placeable(ctx.board, ctx.answer, in_shape) {
                return true; // まわりをかべで囲えない形は無効
            }
            *ctx.found += 1;
            if *ctx.found > SHAPE_LIMIT {
                return false;
            }
            for i in 0..in_shape.len() {
                if in_shape[i] {
                    ctx.ever[i] = true;
                } else {
                    ctx.always[i] = false;
                }
            }
            return true;
        }
        // 候補は探索中に増えるので、残数による枝刈りはできない。
        if at >= candidates.len() {
            return true;
        }
        let next = candidates[at];

        // (1) 入れる
        in_shape[next] = true;
        let added = {
            let mut added = Vec::new();
            for n in ctx.board.neighbours(next) {
                if !in_shape[n]
                    && !excluded[n]
                    && !candidates.contains(&n)
                    && usable(ctx.board, ctx.answer, ctx.clue_index, n)
                {
                    candidates.push(n);
                    added.push(n);
                }
            }
            added
        };
        let ok = walk(ctx, in_shape, chosen + 1, candidates, at + 1, excluded);
        for _ in &added {
            candidates.pop();
        }
        in_shape[next] = false;
        if !ok {
            return false;
        }

        // (2) 永久に入れない
        excluded[next] = true;
        let ok = walk(ctx, in_shape, chosen, candidates, at + 1, excluded);
        excluded[next] = false;
        ok
    }

    let mut in_shape = vec![false; count];
    in_shape[clue_index] = true;
    let mut candidates: Vec<usize> = board
        .neighbours(clue_index)
        .into_iter()
        .filter(|&n| usable(board, answer, clue_index, n))
        .collect();
    candidates.sort_unstable();
    let mut excluded = vec![false; count];
    let mut ctx = Ctx {
        board,
        answer,
        clue_index,
        size,
        required,
        found: &mut found,
        always: &mut always,
        ever: &mut ever,
    };
    let ok = walk(
        &mut ctx,
        &mut in_shape,
        1,
        &mut candidates,
        0,
        &mut excluded,
    );
    if !ok || found == 0 {
        return None;
    }
    Some((always, ever))
}

/// その形にしたとき、まわりをかべで囲えるか。
///
/// シマが決まると輪郭は必ずかべになる。そのかべが
/// - 既に白と決まっているマスを踏む
/// - まわりが全部シマ or 白で、かべ本体と合流できない
/// - 2x2 のかべを作る
/// のいずれかなら、その形はありえない。
///
/// シマの形そのものは正しくても外側が破綻する形を落とせるので、
/// 「最後の 1 マスがどちらか」を決めるのはたいていこの検査。
fn placeable(board: &Board, answer: &AnswerModel, in_shape: &[bool]) -> bool {
    let count = board.cell_count();
    let mut border = vec![false; count];
    for index in 0..count {
        if !in_shape[index] {
            continue;
        }
        for n in board.neighbours(index) {
            if !in_shape[n] {
                if answer.is_white(n) {
                    return false; // 白と決まっているマスをかべにはできない
                }
                border[n] = true;
            }
        }
    }
    let wall = |i: usize| border[i] || answer.is_black(i);
    for index in 0..count {
        if !border[index] {
            continue;
        }
        // 合流先が 1 つもないかべは作れない
        let stranded = board
            .neighbours(index)
            .into_iter()
            .all(|n| in_shape[n] || answer.is_white(n));
        if stranded {
            return false;
        }
    }
    // 2x2 のかべ禁止
    for y in 0..board.rows.saturating_sub(1) {
        for x in 0..board.cols.saturating_sub(1) {
            let corners = [
                board.index(x, y),
                board.index(x + 1, y),
                board.index(x, y + 1),
                board.index(x + 1, y + 1),
            ];
            if corners.iter().all(|&i| wall(i)) {
                return false;
            }
        }
    }
    true
}

pub fn shapes(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let count = board.cell_count();
    let mut ever_any = vec![false; count];
    let mut usable_clue = false;

    /// そのシマに既に確定している白マス。
    fn own_white(board: &Board, answer: &AnswerModel, clue_index: usize) -> Vec<usize> {
        let mut seen = vec![false; board.cell_count()];
        let mut stack = vec![clue_index];
        let mut out = Vec::new();
        seen[clue_index] = true;
        while let Some(index) = stack.pop() {
            out.push(index);
            for n in board.neighbours(index) {
                if !seen[n] && answer.is_white(n) {
                    seen[n] = true;
                    stack.push(n);
                }
            }
        }
        out
    }
    let mut result = Status::Stopped;

    let mut all_clues_bounded = true;
    for (clue_index, size) in board.clue_cells() {
        if size == UNKNOWN_CLUE || size <= 0 {
            // サイズ不明のシマはどこにでも伸びうるので、かべ判定には使えない
            all_clues_bounded = false;
            continue;
        }
        // このシマに既に属している白マスは、どの形にも必ず含まれる
        let required = own_white(board, answer.answer, clue_index);
        if required.len() > size as usize {
            return Status::Broken;
        }
        // 形が爆発しそうなシマは列挙しない
        let remaining = size as usize - required.len();
        if free_area(board, answer.answer, clue_index, &required, remaining)
            > size as usize + SLACK_LIMIT
        {
            all_clues_bounded = false;
            continue;
        }
        match enumerate(board, answer.answer, clue_index, size as usize, &required) {
            None => {
                // 打ち切り or 形なし。かべ判定には使えない
                all_clues_bounded = false;
            }
            Some((always, ever)) => {
                usable_clue = true;
                for i in 0..count {
                    if ever[i] {
                        ever_any[i] = true;
                    }
                    if always[i] && answer.answer.is_unknown(i) {
                        result = merge_status(result, answer.set_white(i, SHAPE_ALWAYS_WHITE));
                        if result == Status::Broken {
                            return result;
                        }
                    }
                }
            }
        }
    }

    if all_clues_bounded && usable_clue {
        for i in 0..count {
            if !ever_any[i] && answer.answer.is_unknown(i) {
                result = merge_status(result, answer.set_black(i, SHAPE_NEVER_BLACK));
                if result == Status::Broken {
                    return result;
                }
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::NO_CLUE;

    #[test]
    fn a_straight_corridor_forces_the_whole_island() {
        // 1x3、左端が 3 → 形は 1 通りしかない
        let board = Board::new(3, 1, vec![3, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        assert_eq!(shapes(&mut methods), Status::Advanced);
        assert!(answer.is_white(1) && answer.is_white(2));
    }

    #[test]
    fn cells_no_shape_can_use_become_wall() {
        // 1x5、左端が 2 → (2)(3)(4) はどの形にも入らない
        let board = Board::new(5, 1, vec![2, NO_CLUE, NO_CLUE, NO_CLUE, NO_CLUE]).unwrap();
        let mut answer = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        shapes(&mut methods);
        for i in 2..5 {
            assert!(answer.is_black(i), "マス {i} はどの形にも入らない");
        }
    }

    #[test]
    fn an_l_shaped_choice_decides_only_the_common_cell() {
        // 3x3 の角に 2 のシマ → 右か下の 2 通り。共通部分は自分だけ
        let mut clues = vec![NO_CLUE; 9];
        clues[0] = 2;
        let board = Board::new(3, 3, clues).unwrap();
        let mut answer = AnswerModel::new(&board);
        let mut methods = AnswerMethods::new(&board, &mut answer, None);
        shapes(&mut methods);
        assert!(answer.is_unknown(1) && answer.is_unknown(3), "2 通りあるので未確定");
        assert!(answer.is_black(4), "斜めはどの形にも入らない");
    }
}
