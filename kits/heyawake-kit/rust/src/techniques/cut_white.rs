//! 分断禁(段階 4)。
//!
//! そこを黒にすると、残りの白どうしが(未確定をすべて白にしたとしても)つながらなく
//! なるマスは白。カタログの寸断の黒・二重アース禁・ループ禁は、どれも
//! 「黒のナナメ連なりが白の通り道を塞ぐ」の言い換えで、この将来連結の判定 1 つで拾える
//! (ナナメの黒の壁はタテヨコの白経路を実際に遮断するため)。
//!
//! 1 マスずつ黒を置いてみる BFS は 1 巡 O(N^2) になるので、確定黒以外のマスで
//! DFS 木を作り lowlink で関節点を一括に出す。u を外して切り離される側と残る側の
//! 両方に確定白があるときだけ、u は白と確定する。

use crate::answer_methods::{merge_status, AnswerMethods};
use crate::reasons::CUT_WHITE;
use crate::status::Status;

pub fn cut_white(answer: &mut AnswerMethods<'_>) -> Status {
    let board = answer.board;
    let count = board.cell_count();

    let passable: Vec<bool> = (0..count)
        .map(|index| !answer.answer.is_black(index))
        .collect();
    let whites_total = (0..count)
        .filter(|&index| answer.answer.is_white(index))
        .count() as i32;
    if whites_total == 0 {
        return Status::Stopped;
    }

    let mut order = vec![usize::MAX; count];
    let mut low = vec![0usize; count];
    // white_below[u] = DFS 部分木に入っている確定白の数。ポップ時に親へ足し込む。
    let mut white_below = vec![0i32; count];
    let mut cut = vec![false; count];
    let mut next_order = 0usize;
    let mut components_with_white = 0;

    for root in 0..count {
        if !passable[root] || order[root] != usize::MAX {
            continue;
        }
        // (マス, DFS 親, 何番目の隣まで見たか)。反復版 DFS。
        let mut stack: Vec<(usize, usize, usize)> = vec![(root, usize::MAX, 0)];
        let mut root_subtrees_with_white = 0;
        let mut root_children = 0;
        while let Some(&mut (index, parent, ref mut at)) = stack.last_mut() {
            if *at == 0 {
                order[index] = next_order;
                low[index] = next_order;
                next_order += 1;
                white_below[index] = i32::from(answer.answer.is_white(index));
            }
            if *at < board.neighbours(index).len() {
                let next = board.neighbours(index)[*at];
                *at += 1;
                if !passable[next] || next == parent {
                    continue;
                }
                if order[next] == usize::MAX {
                    stack.push((next, index, 0));
                } else {
                    low[index] = low[index].min(order[next]);
                }
                continue;
            }
            stack.pop();
            if let Some(&mut (up, _, _)) = stack.last_mut() {
                if up == root {
                    // 根を外すと DFS の子部分木どうしは切れる(子間に辺はない)。
                    root_children += 1;
                    if white_below[index] > 0 {
                        root_subtrees_with_white += 1;
                    }
                } else if low[index] >= order[up]
                    && white_below[index] > 0
                    && white_below[index] < whites_total
                {
                    // up を外すと index の部分木が切り離され、そちらにも残りにも白がある。
                    // up 自身が白かは関係ない(白確定なら黒にできないのは自明で、
                    // この手筋を使うのは未確定マスだけ)。
                    cut[up] = true;
                }
                low[up] = low[up].min(low[index]);
                white_below[up] += white_below[index];
            }
        }
        let _ = root_children;
        if root_subtrees_with_white >= 2 {
            cut[root] = true;
        }
        if white_below[root] > 0 {
            components_with_white += 1;
        }
    }

    // 白がすでに別々の成分に割れているなら、どう塗っても直せない。
    if components_with_white >= 2 {
        return Status::Broken;
    }

    let mut result = Status::Stopped;
    for index in 0..count {
        if !cut[index] || !answer.answer.is_unknown(index) {
            continue;
        }
        result = merge_status(result, answer.set_white(index, CUT_WHITE));
        if result == Status::Broken {
            return result;
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::answer_model::{AnswerModel, CellState};
    use crate::board::Board;

    /// 白 2 つの間の 1 マスは黒にできない。
    #[test]
    fn keeps_the_only_path_between_whites() {
        let board = Board::new(3, 1, vec![false, false], vec![], vec![None]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(0, CellState::White).unwrap();
        model.set(2, CellState::White).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(cut_white(&mut methods), Status::Advanced);
        assert!(model.is_white(1));
    }

    /// ナナメの黒の壁を閉じる位置は白(二重アース禁の形)。
    #[test]
    fn refuses_to_close_a_diagonal_wall() {
        // 3×3 の全マス 1 部屋。(1,0) が黒のとき (0,1) を黒にすると
        // 角の白 (0,0) が切り離されるので、(0,1) は白。
        let board = Board::new(3, 3, vec![false; 6], vec![false; 6], vec![None]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(board.index(1, 0), CellState::Black).unwrap();
        model.set(board.index(0, 0), CellState::White).unwrap();
        model.set(board.index(2, 2), CellState::White).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(cut_white(&mut methods), Status::Advanced);
        assert!(model.is_white(board.index(0, 1)));
    }

    /// 切り離される側に白がなければ黒の余地を残す。
    #[test]
    fn allows_cutting_off_a_whiteless_corner() {
        // (1,0) が黒。(0,1) を黒にすると (0,0) が切り離されるが、
        // (0,0) は未確定なので分断にはならない。
        let board = Board::new(3, 3, vec![false; 6], vec![false; 6], vec![None]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(board.index(1, 0), CellState::Black).unwrap();
        model.set(board.index(2, 2), CellState::White).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(cut_white(&mut methods), Status::Stopped);
        assert!(model.is_unknown(board.index(0, 1)));
    }

    /// 白がすでに割れていたら矛盾。
    #[test]
    fn split_whites_are_broken() {
        let board = Board::new(3, 1, vec![false, false], vec![], vec![None]).unwrap();
        let mut model = AnswerModel::new(&board);
        model.set(0, CellState::White).unwrap();
        model.set(1, CellState::Black).unwrap();
        model.set(2, CellState::White).unwrap();
        let mut methods = AnswerMethods::new(&board, &mut model, None);
        assert_eq!(cut_white(&mut methods), Status::Broken);
    }
}
