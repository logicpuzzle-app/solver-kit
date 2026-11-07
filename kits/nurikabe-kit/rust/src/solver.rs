//! 手筋ソルバーのドライバ。
//!
//! 手筋はすべて健全な推論なので、順序は解を変えない。変わるのは「どの手筋で確定したか」
//! = 難易度の説明だけ。具体的な定石を先に置き、全盤走査が重いものを後ろに置く。

use crate::answer_methods::{AnswerMethods, Recorder};
use crate::answer_model::{AnswerModel, CellState};
use crate::reasons::{TRIAL_ANY_CASE, TRIAL_CONTRADICTION};
use crate::board::Board;
use crate::solution::validate_solution;
use crate::status::Status;
use crate::techniques::budget::budget;
use crate::techniques::clue_neighbours::clue_neighbours;
use crate::techniques::island::island;
use crate::techniques::island_cut::island_cut;
use crate::techniques::pool::pool;
use crate::techniques::reachable::reachable;
use crate::techniques::region_budget::region_budget;
use crate::techniques::region_depth::region_depth;
use crate::techniques::separate::separate;
use crate::techniques::shapes::shapes;
use crate::techniques::wall::wall;
use crate::techniques::wall_budget::wall_budget;
use crate::techniques::wall_cut::wall_cut;
use crate::techniques::wall_reach::wall_reach;
use crate::techniques::white_link::white_link;

type Technique = fn(&mut AnswerMethods<'_>) -> Status;

/// 仮置きの中で回す手筋。全盤走査が重いものは外す。
/// 仮置きは何百回も回るので、ここを軽くしないと実用速度が出ない。
const FAST_TECHNIQUES: [Technique; 9] = [
    clue_neighbours,
    separate,
    island,
    pool,
    wall,
    budget,
    region_budget,
    region_depth,
    wall_reach,
];

/// 手筋の段階。人間は「どこまでの読みが要る問題か」で難しさを言うので、
/// 読みの種類でまとめてある。`SolveOptions::tier` でここまでに絞れる。
///
/// 1. 数字のまわりの定石。目で見てすぐ分かるもの
/// 2. 数え上げ。どの数字が届くか、区画に何マス入るか
/// 3. 連結性。切ったらどうなるかを 1 マスずつ確かめる
/// 4. 列挙。シマの形を全部並べて共通部分を取る
pub const TIER_COUNT: u8 = 4;

fn techniques_for_tier(tier: u8) -> &'static [Technique] {
    const T1: [Technique; 5] = [clue_neighbours, separate, island, pool, wall];
    const T2: [Technique; 9] = [
        clue_neighbours,
        separate,
        island,
        pool,
        wall,
        budget,
        region_budget,
        reachable,
        wall_reach,
    ];
    const T3: [Technique; 13] = [
        clue_neighbours,
        separate,
        island,
        pool,
        wall,
        budget,
        region_budget,
        reachable,
        wall_reach,
        white_link,
        wall_cut,
        wall_budget,
        island_cut,
    ];
    match tier {
        1 => &T1,
        2 => &T2,
        3 => &T3,
        _ => &TECHNIQUES,
    }
}

/// 適用順。安いものから、重いものへ。
const TECHNIQUES: [Technique; 15] = [
    clue_neighbours,
    separate,
    island,
    pool,
    wall,
    budget,
    region_budget,
    region_depth,
    wall_reach,
    reachable,
    white_link,
    wall_cut,
    wall_budget,
    island_cut,
    shapes,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SolveStatus {
    /// 全マスが確定し、ルール検証も通った。
    Completed,
    /// 手が尽きた。
    Stopped,
    /// 矛盾が見つかった。
    Broken,
}

#[derive(Clone, Debug)]
pub struct SolveOptions {
    /// 0 なら無制限。
    pub max_passes: i32,
    /// 仮置き(先読み)を使わない。
    pub no_trial: bool,
    /// 使う手筋の段階(1..=TIER_COUNT)。既定は全部。
    pub tier: u8,
    /// 仮置きの入れ子の最大の深さ。1 段ずつ上げていき、進んだところで止める。
    ///
    /// 0 → 1 にしただけで完解率が 65.5% → 86.3% に跳ねた(★3 は 61% → 90%)。
    /// ★4/★5 が解けなかったのは手筋の欠落ではなく場合分けの深さだった。
    /// 人間も難問ではこれをやる(「ここが黒だとして…さらにここが白だとすると…」)。
    pub trial_depth: i32,
}

impl Default for SolveOptions {
    fn default() -> Self {
        Self {
            max_passes: 0,
            tier: TIER_COUNT,
            no_trial: false,
            trial_depth: 2,
        }
    }
}

/// 仮置きで測った手間。難易度スコアに使う。
#[derive(Clone, Copy, Debug, Default)]
pub struct TrialStats {
    /// 仮置きで確定させた回数。
    pub deductions: i32,
    /// 1 回の仮置きで最も深く伝播した手数。
    pub max_depth: i32,
    /// 入れ子の仮置きで確定させた回数(捨てた枝のぶんも含む努力量)。
    pub nested_deductions: i32,
    /// 浅い仮置き(入れ子なし)で進めなくなった時点の未確定マス数。
    ///
    /// `pure_unknown` の一段上。手筋 → 浅い仮置き → 深い仮置き と段階を上げるので、
    /// それぞれの段階でどこまで行けたかが、そのまま難易度の形になる。
    pub shallow_unknown: i32,
    /// 手筋だけで進めなくなった時点の未確定マス数(仮置きに入る前)。
    ///
    /// 較正で分かった、いちばん効く特徴。手筋の発火数は難易度ではなく盤面の広さで
    /// 決まってしまうが、これは申告★1〜5 で中央値 0 / 6 / 39 / 68 / 94 と分離する。
    /// 完解した問題では 0(仮置きなしで解けた)か、仮置きが要った量そのものになる。
    pub pure_unknown: i32,
}

/// 解くのに要った読みの段階。1〜4 は手筋の段階、5〜6 は仮置き、7 は解けなかった。
///
/// **難易度の主軸はこれ。** 人間は「どこまでの読みが要る問題か」で難しさを言う。
/// 手間の合計(発火数・仮置き回数)は、同じ段階の中で順序をつけるのに使う。
/// puzsq 1,226 問での CV 一致率は 手間だけ 54.4% → 段階×手間 56.1%。
pub const LEVEL_SHALLOW_TRIAL: u8 = 5;
/// 仮置きの入れ子。深さ 1 が段階 6、深さ 2 が段階 7 …と 1 段ずつ上がる。
pub const LEVEL_FIRST_NESTED: u8 = 6;
pub const fn level_for_depth(depth: i32) -> u8 {
    LEVEL_FIRST_NESTED + (depth as u8) - 1
}
/// 解けなかった問題。使う最大の深さの 1 つ上に置く。
pub fn level_unsolved(max_depth: i32) -> u8 {
    if max_depth <= 0 {
        LEVEL_SHALLOW_TRIAL + 1
    } else {
        level_for_depth(max_depth) + 1
    }
}

pub struct SolveOutcome {
    pub status: SolveStatus,
    /// 要った読みの段階(1..=7)。
    pub level: u8,
    pub answer: AnswerModel,
    pub recorder: Recorder,
    pub passes: i32,
    pub stats: TrialStats,
}

/// 仮置きした盤面を、手筋だけで収束するまで進める。Recorder は渡さない
/// (仮置きの中で発火した手筋は難易度に数えない)。
/// 入れ子の仮置きで、内側の候補を外側で置いたマスからどれだけ離れてよいか。
///
/// 外側で 1 マス置いた影響はその近くに出る。遠くのマスを試し直しても、外側の仮定と
/// 無関係な計算をやり直すだけになる。**絞っても嘘はつかない** — 見つかる確定が減るだけで、
/// 見つけた矛盾は矛盾のままだから。効果は計測で決める。
const NESTED_RADIUS: i32 = 10;

fn propagate_trial(
    board: &Board,
    answer: &mut AnswerModel,
    depth: i32,
    stats: &mut TrialStats,
    focus: Option<usize>,
) -> (Status, i32) {
    let mut steps = 0;
    loop {
        let before = answer.unknown_count();
        let status = {
            let mut methods = AnswerMethods::new(board, answer, None);
            run(&mut methods, &FAST_TECHNIQUES)
        };
        if status == Status::Broken {
            return (Status::Broken, steps);
        }
        if status == Status::Stopped || answer.unknown_count() == before {
            if depth > 0 && answer.unknown_count() > 0 {
                let mut nested = TrialStats::default();
                let status = try_solve(board, answer, &mut nested, depth - 1, focus);
                stats.nested_deductions += nested.deductions + nested.nested_deductions;
                match status {
                    Status::Broken => return (Status::Broken, steps),
                    Status::Advanced => {
                        steps += 1;
                        continue;
                    }
                    Status::Stopped => {}
                }
            }
            return (Status::Stopped, steps);
        }
        steps += 1;
    }
}

/// 未確定マスを 1 つずつ両方の色で試す。
/// 片方が矛盾すれば他方が確定、両方生き残っても一致する確定は取り込める。
fn try_solve(
    board: &Board,
    answer: &mut AnswerModel,
    stats: &mut TrialStats,
    depth: i32,
    focus: Option<usize>,
) -> Status {
    // 確定済みマスに接している未確定マスだけを試す。情報のない場所を試しても
    // 伝播が起きず、時間だけ食う。
    // 矛盾が出そうなマスから試す。
    //
    // 仮置きは「片方の色が矛盾すれば他方が確定」で、矛盾を見つけた時点で打ち切るので、
    // **早く矛盾に行き当たるほど安い**。
    //
    // どのマスが矛盾しやすいかは、浅い読みで測れる。そのマスを黒・白に置いて
    // 手筋だけで伝播させ、**遠くまで伝播したマスほど制約が強い**(すぐ止まるマスは
    // まわりと繋がっていない)。この下読みは深さ 0 なので、深い仮置き 1 回より桁違いに安い。
    //
    // 隣接する確定マスの数だけで並べたときは 5% しか縮まなかった。伝播の距離を使うと
    // 「あと一歩で矛盾するマス」を直接指せる(重い問題 20 問で 965 秒 → 835 秒)。
    //
    // 深さ 1 でも下読みする。深さ 2 の中の入れ子は深さ 1 なので、そこを速くしないと
    // 意味がない(深さ 2 以上に限ると重い 20 問が 835 秒 → 923 秒に戻った)。
    // 易しい問題への影響は測って無かった(40 問の合計で 9.3 秒 対 9.4 秒)。
    let mut targets: Vec<(i32, usize)> = (0..board.cell_count())
        .filter(|&i| answer.is_unknown(i))
        .filter(|&i| board.neighbours(i).iter().any(|&n| !answer.is_unknown(n)))
        .filter(|&i| match focus {
            None => true,
            Some(f) => {
                let (fx, fy) = board.position(f);
                let (x, y) = board.position(i);
                (fx - x).abs() + (fy - y).abs() <= NESTED_RADIUS
            }
        })
        .map(|i| (0, i))
        .collect();
    if depth > 0 {
        for (score, index) in targets.iter_mut() {
            let mut reach = 0;
            for state in [CellState::Black, CellState::White] {
                let mut trial = answer.clone_for_trial();
                if trial.set(*index, state).is_err() {
                    continue;
                }
                let (status, steps) = propagate_trial(board, &mut trial, 0, stats, Some(*index));
                // 浅い読みで既に矛盾するなら、深い読みでも真っ先に当たる
                reach = reach.max(if status == Status::Broken { i32::MAX / 2 } else { steps });
            }
            *score = -reach;
        }
        targets.sort_unstable();
    }
    let targets: Vec<usize> = targets.into_iter().map(|(_, i)| i).collect();

    for index in targets {
        if !answer.is_unknown(index) {
            continue; // 直前の確定で埋まった
        }
        let mut outcomes = Vec::new();
        for state in [CellState::Black, CellState::White] {
            let mut trial = answer.clone_for_trial();
            if trial.set(index, state).is_err() {
                continue;
            }
            let (status, steps) = propagate_trial(board, &mut trial, depth, stats, Some(index));
            outcomes.push((state, status, steps, trial));
        }
        let broken: Vec<bool> = outcomes.iter().map(|o| o.1 == Status::Broken).collect();
        match (broken.first().copied(), broken.get(1).copied()) {
            (Some(true), Some(true)) => return Status::Broken,
            (Some(true), _) => {
                let depth = outcomes[0].2;
                stats.deductions += 1;
                stats.max_depth = stats.max_depth.max(depth);
                let mut methods = AnswerMethods::new(board, answer, None);
                return methods.set(index, CellState::White, TRIAL_CONTRADICTION);
            }
            (_, Some(true)) => {
                let depth = outcomes[1].2;
                stats.deductions += 1;
                stats.max_depth = stats.max_depth.max(depth);
                let mut methods = AnswerMethods::new(board, answer, None);
                return methods.set(index, CellState::Black, TRIAL_CONTRADICTION);
            }
            _ => {
                // どちらでも生き残る。両方で同じ色になったマスは確定できる。
                if outcomes.len() == 2 {
                    let mut agreed = Vec::new();
                    for i in 0..board.cell_count() {
                        if !answer.is_unknown(i) {
                            continue;
                        }
                        let a = outcomes[0].3.get(i);
                        let b = outcomes[1].3.get(i);
                        if a == b && a != CellState::Unknown {
                            agreed.push((i, a));
                        }
                    }
                    if !agreed.is_empty() {
                        let depth = outcomes[0].2.max(outcomes[1].2);
                        stats.deductions += 1;
                        stats.max_depth = stats.max_depth.max(depth);
                        let mut methods = AnswerMethods::new(board, answer, None);
                        let mut result = Status::Stopped;
                        for (i, state) in agreed {
                            result = crate::answer_methods::merge_status(
                                result,
                                methods.set(i, state, TRIAL_ANY_CASE),
                            );
                        }
                        return result;
                    }
                }
            }
        }
    }
    Status::Stopped
}

/// 手筋を 1 巡する。名前つきの一覧(`trace` 用)。
pub fn technique_list() -> Vec<(&'static str, Technique)> {
    vec![
        ("clue_neighbours", clue_neighbours as Technique),
        ("separate", separate),
        ("island", island),
        ("pool", pool),
        ("wall", wall),
        ("budget", budget),
        ("region_budget", region_budget),
        ("region_depth", region_depth),
        ("wall_reach", wall_reach),
        ("reachable", reachable),
        ("white_link", white_link),
        ("wall_cut", wall_cut),
        ("wall_budget", wall_budget),
        ("island_cut", island_cut),
        ("shapes", shapes),
    ]
}

/// 手筋を 1 巡する。
pub fn solve(answer: &mut AnswerMethods<'_>) -> Status {
    run(answer, &TECHNIQUES)
}

/// 段階を絞って 1 巡する。
pub fn solve_tier(answer: &mut AnswerMethods<'_>, tier: u8) -> Status {
    run(answer, techniques_for_tier(tier))
}

fn run(answer: &mut AnswerMethods<'_>, techniques: &[Technique]) -> Status {
    let mut result = Status::Stopped;
    for &technique in techniques {
        match technique(answer) {
            Status::Broken => return Status::Broken,
            Status::Advanced => result = Status::Advanced,
            Status::Stopped => {}
        }
    }
    result
}

pub fn run_all(board: &Board, options: SolveOptions) -> SolveOutcome {
    let mut answer = AnswerModel::new(board);
    let mut recorder = Recorder::default();
    let mut passes = 0;
    let mut broken = false;
    let mut stats = TrialStats::default();
    let mut stalled = false;
    let mut deep_stalled = false;
    // 安い段階から始めて、止まったら 1 段ずつ上げる。
    // 到達した最大の段階が「その問題に要った読みの深さ」になる。
    // 易しい問題では重い手筋を一度も回さずに済むので、速度の面でも得。
    let mut level: u8 = 1;

    loop {
        passes += 1;
        let status = {
            let mut methods = AnswerMethods::new(board, &mut answer, Some(&mut recorder));
            solve_tier(&mut methods, level.min(options.tier))
        };
        if status == Status::Broken {
            broken = true;
            break;
        }
        if status == Status::Advanced {
            if options.max_passes > 0 && passes >= options.max_passes {
                break;
            }
            continue;
        }
        // ここで止まった。全部埋まっているなら段階を上げる必要はない
        // (埋まった盤面はどの手筋も Stopped を返すので、これが無いと
        //  易しい問題まで最上段まで登ってしまう)。
        if answer.is_complete() {
            break;
        }
        // まだ上の段階があれば上げる。
        if level < options.tier.min(TIER_COUNT) {
            level += 1;
            continue;
        }
        if !stalled {
            // 手筋だけで進めなくなった最初の瞬間
            stats.pure_unknown = answer.unknown_count() as i32;
            stalled = true;
        }
        if options.no_trial {
            break;
        }
        // 仮置き。まず入れ子なしで試し、それでも止まったら深い仮置きに上げる。
        level = level.max(LEVEL_SHALLOW_TRIAL);
        let shallow = try_solve(board, &mut answer, &mut stats, 0, None);
        if shallow == Status::Broken {
            broken = true;
            break;
        }
        if shallow == Status::Advanced {
            continue;
        }
        if !deep_stalled {
            stats.shallow_unknown = answer.unknown_count() as i32;
            deep_stalled = true;
        }
        if options.trial_depth == 0 {
            break;
        }
        // 入れ子の深さも 1 段ずつ上げる。浅い読みで済む問題を深く潜らせないためと、
        // 「最低どの深さが要ったか」をそのまま段階として残すため。
        let mut advanced = false;
        for depth in 1..=options.trial_depth {
            // 段階を上げるのは、その深さで実際に進んだときだけ。
            // 試しただけで上げると、解けなかった問題の段階が一律に最大値になる。
            match try_solve(board, &mut answer, &mut stats, depth, None) {
                Status::Broken => {
                    level = level.max(level_for_depth(depth));
                    broken = true;
                    advanced = true;
                    break;
                }
                Status::Advanced => {
                    level = level.max(level_for_depth(depth));
                    advanced = true;
                    break;
                }
                Status::Stopped => {}
            }
        }
        if broken || !advanced {
            break;
        }
    }

    let status = if broken {
        SolveStatus::Broken
    } else if answer.is_complete() {
        // 全確定でもルールを満たしていなければ矛盾。検証は独立実装を使う。
        if validate_solution(board, &answer).is_empty() {
            SolveStatus::Completed
        } else {
            SolveStatus::Broken
        }
    } else {
        SolveStatus::Stopped
    };

    let level = if status == SolveStatus::Stopped {
        level_unsolved(options.trial_depth)
    } else {
        level
    };

    SolveOutcome {
        status,
        level,
        answer,
        recorder,
        passes,
        stats,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::puzzlink::decode_url;

    #[test]
    fn solves_or_stops_without_contradiction_on_a_published_problem() {
        let board = decode_url("https://puzz.link/p?nurikabe/6/6/m8n8i9u").unwrap();
        let outcome = run_all(&board, SolveOptions::default());
        assert_ne!(
            outcome.status,
            SolveStatus::Broken,
            "実在の問題で矛盾を出してはいけない"
        );
    }

    #[test]
    fn records_which_technique_fired() {
        // 中央に 1 → clue_neighbours が 4 マスを確定する
        let mut clues = vec![crate::board::NO_CLUE; 9];
        clues[4] = 1;
        let board = Board::new(3, 3, clues).unwrap();
        let outcome = run_all(&board, SolveOptions::default());
        assert_eq!(
            outcome.recorder.counts.get(crate::reasons::CLUE_NEIGHBOUR_BLACK),
            Some(&4)
        );
    }
}
