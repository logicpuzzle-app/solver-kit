use std::collections::VecDeque;
use std::fmt;

use crate::board::Board;
use crate::difficulty::{
    band, clue_counts, difficulty, normalized_difficulty,
};
use crate::engine::EdgeState;
use crate::puzzlink::encode_code;
use crate::random::Rng;
use crate::search::{count_solutions, CountResult};
use crate::solution::validate_solution;
use crate::solver::{run_all, SolveOptions, SolveOutcome, SolveStatus};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Symmetry {
    None,
    Rot2,
    Rot4,
    MirrorH,
    MirrorV,
}

pub struct GenerateOptions {
    pub cols: i32,
    pub rows: i32,
    pub attempts: i32,
    pub max_nodes: i32,
    pub dp_min: Option<i32>,
    pub dp_max: Option<i32>,
    pub dpn_min: Option<f64>,
    pub dpn_max: Option<f64>,
    pub band: Option<String>,
    pub symmetry: Symmetry,
    pub pattern: Option<Vec<bool>>,
    pub reduce: bool,
    pub exact_reduce: bool,
    pub refine: i32,
    pub no_local_pattern: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GenerateError {
    FinalNotUnique {
        solutions: usize,
        problem_code: String,
    },
    FinalSolutionMismatch {
        problem_code: String,
    },
}

impl fmt::Display for GenerateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FinalNotUnique {
                solutions,
                problem_code,
            } => write!(
                formatter,
                "generator bug: final puzzle has {solutions} solutions instead of one: {problem_code}"
            ),
            Self::FinalSolutionMismatch { problem_code } => write!(
                formatter,
                "generator bug: final unique solution differs from the drawn loop: {problem_code}"
            ),
        }
    }
}

impl std::error::Error for GenerateError {}

pub struct Generated {
    pub board: Board,
    pub solution: Vec<EdgeState>,
    pub difficulty: i32,
    pub normalized_difficulty: f64,
    pub outcome: SolveOutcome,
    pub attempts: i32,
    pub stats: GenerationStats,
}

pub struct GenerationReport {
    pub generated: Option<Generated>,
    pub dpn_min: Option<f64>,
    pub dpn_max: Option<f64>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GenerationStats {
    pub stretch_iterations: usize,
    pub stretch_limit: usize,
    pub stretch_accepted: usize,
    pub stretch_initial_length: usize,
    pub stretch_target_length: usize,
    pub reduction_checks: usize,
    pub final_check_limit: i32,
    pub final_check_nodes: usize,
    pub final_check_aborted: bool,
    pub final_check_solutions: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct StretchStats {
    iterations: usize,
    limit: usize,
    accepted: usize,
    initial_length: usize,
    target_length: usize,
}

/// 補集合の各境界セルは盤外ノードへ直接つながるため、そこから同時に
/// flood fill すれば「盤外を含む補集合が一つ」という条件をそのまま検査できる。
fn complement_is_connected(inside: &[bool], cols: usize, rows: usize) -> bool {
    let mut reached = vec![false; inside.len()];
    let mut queue = VecDeque::new();
    for y in 0..rows {
        for x in 0..cols {
            let index = y * cols + x;
            if !inside[index]
                && (x == 0 || x + 1 == cols || y == 0 || y + 1 == rows)
            {
                reached[index] = true;
                queue.push_back(index);
            }
        }
    }
    if queue.is_empty() {
        return false;
    }
    while let Some(index) = queue.pop_front() {
        let x = index % cols;
        let y = index / cols;
        if x > 0 {
            visit_complement(index - 1, inside, &mut reached, &mut queue);
        }
        if x + 1 < cols {
            visit_complement(index + 1, inside, &mut reached, &mut queue);
        }
        if y > 0 {
            visit_complement(index - cols, inside, &mut reached, &mut queue);
        }
        if y + 1 < rows {
            visit_complement(index + cols, inside, &mut reached, &mut queue);
        }
    }
    inside
        .iter()
        .zip(reached)
        .all(|(&is_inside, was_reached)| is_inside || was_reached)
}

fn visit_complement(
    index: usize,
    inside: &[bool],
    reached: &mut [bool],
    queue: &mut VecDeque<usize>,
) {
    if !inside[index] && !reached[index] {
        reached[index] = true;
        queue.push_back(index);
    }
}

/// 対角二セルだけが内側だと境界が格子点で自己接触する。追加候補の
/// 周囲だけでも判定できるが、全頂点を走査して条件の実装漏れを避ける。
fn has_diagonal_touch(inside: &[bool], cols: usize, rows: usize) -> bool {
    for y in 1..rows {
        for x in 1..cols {
            let nw = inside[(y - 1) * cols + x - 1];
            let ne = inside[(y - 1) * cols + x];
            let sw = inside[y * cols + x - 1];
            let se = inside[y * cols + x];
            if (nw && se && !ne && !sw) || (ne && sw && !nw && !se) {
                return true;
            }
        }
    }
    false
}

fn touches_inside(index: usize, inside: &[bool], cols: usize, rows: usize) -> bool {
    let x = index % cols;
    let y = index / cols;
    (x > 0 && inside[index - 1])
        || (x + 1 < cols && inside[index + 1])
        || (y > 0 && inside[index - cols])
        || (y + 1 < rows && inside[index + cols])
}

/// 内側を削る変形では連結性が自明でなくなるため、採用前に全体を検査する。
fn inside_is_connected(inside: &[bool], cols: usize, rows: usize) -> bool {
    let Some(start) = inside.iter().position(|&is_inside| is_inside) else {
        return false;
    };
    let mut reached = vec![false; inside.len()];
    let mut queue = VecDeque::from([start]);
    reached[start] = true;
    while let Some(index) = queue.pop_front() {
        let x = index % cols;
        let y = index / cols;
        if x > 0 {
            visit_inside(index - 1, inside, &mut reached, &mut queue);
        }
        if x + 1 < cols {
            visit_inside(index + 1, inside, &mut reached, &mut queue);
        }
        if y > 0 {
            visit_inside(index - cols, inside, &mut reached, &mut queue);
        }
        if y + 1 < rows {
            visit_inside(index + cols, inside, &mut reached, &mut queue);
        }
    }
    inside
        .iter()
        .zip(reached)
        .all(|(&is_inside, was_reached)| !is_inside || was_reached)
}

fn visit_inside(
    index: usize,
    inside: &[bool],
    reached: &mut [bool],
    queue: &mut VecDeque<usize>,
) {
    if inside[index] && !reached[index] {
        reached[index] = true;
        queue.push_back(index);
    }
}

/// 各内側セルについて盤外または外側セルに接する辺を数えると、境界長になる。
fn boundary_length(inside: &[bool], cols: usize, rows: usize) -> usize {
    let mut length = 0;
    for index in 0..inside.len() {
        if !inside[index] {
            continue;
        }
        let x = index % cols;
        let y = index / cols;
        length += usize::from(x == 0 || !inside[index - 1]);
        length += usize::from(x + 1 == cols || !inside[index + 1]);
        length += usize::from(y == 0 || !inside[index - cols]);
        length += usize::from(y + 1 == rows || !inside[index + cols]);
    }
    length
}

fn stretch_boundary(
    rng: &mut Rng,
    inside: &mut [bool],
    cols: usize,
    rows: usize,
) -> Option<StretchStats> {
    let cells = inside.len();
    let total_edges = cols
        .checked_mul(rows.checked_add(1)?)?
        .checked_add(cols.checked_add(1)?.checked_mul(rows)?)?;
    let target_percent = 40 + rng.next_int(16);
    let target = total_edges
        .checked_mul(target_percent)?
        .checked_add(99)?
        / 100;
    let mut inside_count = inside.iter().filter(|&&cell| cell).count();
    let mut length = boundary_length(inside, cols, rows);
    let initial_length = length;
    let limit = cells.saturating_mul(50);
    let mut iterations = 0;
    let mut accepted_count = 0;

    // 境界を短くする操作は戻さない。長さが同じ操作だけを少数許し、
    // 単純な局所最大の平坦面から別の増加候補へ移れるようにする。
    for _ in 0..limit {
        if length >= target {
            break;
        }
        iterations += 1;
        let index = rng.next_int(cells);
        let was_inside = inside[index];
        inside[index] = !was_inside;
        if was_inside {
            inside_count -= 1;
        } else {
            inside_count += 1;
        }

        let valid = inside_count > 0
            && inside_count < cells
            && inside_is_connected(inside, cols, rows)
            && complement_is_connected(inside, cols, rows)
            && !has_diagonal_touch(inside, cols, rows);
        let next_length = valid.then(|| boundary_length(inside, cols, rows));
        let accepted = next_length.is_some_and(|next| {
            next > length || (next == length && rng.next_int(8) == 0)
        });
        if accepted {
            accepted_count += 1;
            length = next_length.expect("採用時は境界長が計算済み");
        } else {
            inside[index] = was_inside;
            if was_inside {
                inside_count += 1;
            } else {
                inside_count -= 1;
            }
        }
    }
    Some(StretchStats {
        iterations,
        limit,
        accepted: accepted_count,
        initial_length,
        target_length: target,
    })
}

fn grow_inside(
    rng: &mut Rng,
    cols: usize,
    rows: usize,
) -> Option<(Vec<bool>, StretchStats)> {
    let cells = cols.checked_mul(rows)?;
    if cells < 2 || cells > i32::MAX as usize {
        return None;
    }
    let percent = 35 + rng.next_int(21);
    let target = ((cells * percent + 50) / 100).clamp(1, cells - 1);
    let mut inside = vec![false; cells];
    inside[rng.next_int(cells)] = true;
    let mut count = 1;

    while count < target {
        let mut candidates = Vec::new();
        for index in 0..cells {
            if inside[index] || !touches_inside(index, &inside, cols, rows) {
                continue;
            }
            inside[index] = true;
            let allowed = complement_is_connected(&inside, cols, rows)
                && !has_diagonal_touch(&inside, cols, rows);
            inside[index] = false;
            if allowed {
                candidates.push(index);
            }
        }
        if candidates.is_empty() {
            break;
        }
        let chosen = candidates[rng.next_int(candidates.len())];
        inside[chosen] = true;
        count += 1;
    }
    let stretch = stretch_boundary(rng, &mut inside, cols, rows)?;
    (count < cells).then_some((inside, stretch))
}

fn boundary_solution(board: &Board, inside: &[bool]) -> Vec<EdgeState> {
    let mut edges = vec![EdgeState::Cross; board.edge_count()];
    for y in 0..=board.rows {
        for x in 0..board.cols {
            let above = y > 0 && inside[(y - 1) * board.cols + x];
            let below = y < board.rows && inside[y * board.cols + x];
            if above != below {
                edges[board.h_id(x, y)] = EdgeState::Line;
            }
        }
    }
    for y in 0..board.rows {
        for x in 0..=board.cols {
            let left = x > 0 && inside[y * board.cols + x - 1];
            let right = x < board.cols && inside[y * board.cols + x];
            if left != right {
                edges[board.v_id(x, y)] = EdgeState::Line;
            }
        }
    }
    edges
}

fn full_clue_board(
    cols: usize,
    rows: usize,
    solution: &[EdgeState],
) -> Option<Board> {
    let empty = Board::empty(cols, rows).ok()?;
    let mut clues = Vec::with_capacity(cols * rows);
    for y in 0..rows {
        for x in 0..cols {
            let count = empty
                .cell_edges(x, y)
                .into_iter()
                .filter(|&edge| solution[edge] == EdgeState::Line)
                .count();
            // 連結条件が正しければ孤立セルや穴はなく、4 は生じない。
            if count > 3 {
                return None;
            }
            clues.push(count as i8);
        }
    }
    Board::new(cols, rows, clues).ok()
}

fn solver_options(no_trial: bool, no_local_pattern: bool) -> SolveOptions {
    SolveOptions {
        no_trial,
        max_passes: 0,
        no_local_pattern,
    }
}

fn technique_solution(
    board: &Board,
    no_local_pattern: bool,
) -> Option<Vec<EdgeState>> {
    let outcome =
        run_all(board, None, solver_options(true, no_local_pattern));
    match outcome.status {
        SolveStatus::Completed => {
            Some(outcome.answer.edges().to_vec())
        }
        SolveStatus::Stopped => None,
        SolveStatus::Broken => {
            // ヒント削減は既知の正解と整合するヒントを消すだけなので、
            // 矛盾は手筋の健全性が壊れた合図としてデバッグ時に表面化させる。
            debug_assert!(
                false,
                "既知の正解を持つヒント削減盤面で手筋ソルバーが矛盾しました"
            );
            None
        }
    }
}

fn exact_solution(board: &Board, max_nodes: i32) -> Option<Vec<EdgeState>> {
    let result = count_solutions(board, 2, max_nodes);
    if result.aborted || result.solutions.len() != 1 {
        None
    } else {
        result.solutions.into_iter().next()
    }
}

fn reduction_solution(
    board: &Board,
    max_nodes: i32,
    exact_reduce: bool,
    no_local_pattern: bool,
) -> Option<Vec<EdgeState>> {
    if exact_reduce {
        exact_solution(board, max_nodes)
    } else {
        // 既定モードは人が使える手筋だけで完解できることを削除条件にする。
        // 仮置きや完全探索を挟まないため、削減が進んでも判定時間が膨らまない。
        technique_solution(board, no_local_pattern)
    }
}

fn normalized_score(board: &Board, no_local_pattern: bool) -> f64 {
    let outcome =
        run_all(board, None, solver_options(false, no_local_pattern));
    let score = difficulty(&outcome);
    let (zero_clues, total_clues) = clue_counts(&board.clues);
    normalized_difficulty(
        i64::from(score),
        board.clues.len(),
        zero_clues,
        total_clues,
    )
}

fn band_level(name: &str) -> Option<usize> {
    match name {
        "intro" => Some(0),
        "easy" => Some(1),
        "medium" => Some(2),
        "hard" => Some(3),
        "expert" => Some(4),
        "fiendish" => Some(5),
        _ => None,
    }
}

fn exceeds_dpn_upper(
    score: f64,
    dpn_max: Option<f64>,
    requested_band: Option<&str>,
) -> bool {
    dpn_max.is_some_and(|maximum| score > maximum)
        || requested_band.is_some_and(|requested| {
            band_level(band(score))
                .zip(band_level(requested))
                .is_some_and(|(actual, target)| actual > target)
        })
}

fn orbit(
    index: usize,
    cols: usize,
    rows: usize,
    symmetry: Symmetry,
) -> Vec<usize> {
    let x = index % cols;
    let y = index / cols;
    let positions = match symmetry {
        Symmetry::None => vec![(x, y)],
        Symmetry::Rot2 => vec![(x, y), (cols - 1 - x, rows - 1 - y)],
        Symmetry::Rot4 => vec![
            (x, y),
            (cols - 1 - y, x),
            (cols - 1 - x, rows - 1 - y),
            (y, rows - 1 - x),
        ],
        Symmetry::MirrorH => vec![(x, y), (cols - 1 - x, y)],
        Symmetry::MirrorV => vec![(x, y), (x, rows - 1 - y)],
    };
    let mut result = Vec::new();
    for (px, py) in positions {
        let cell = py * cols + px;
        if !result.contains(&cell) {
            result.push(cell);
        }
    }
    result.sort_unstable();
    result
}

fn symmetry_groups(cols: usize, rows: usize, symmetry: Symmetry) -> Vec<Vec<usize>> {
    let mut used = vec![false; cols * rows];
    let mut groups = Vec::new();
    for index in 0..used.len() {
        if used[index] {
            continue;
        }
        let group = orbit(index, cols, rows, symmetry);
        for &cell in &group {
            used[cell] = true;
        }
        groups.push(group);
    }
    groups
}

fn singleton_groups(pattern: &[bool]) -> Vec<Vec<usize>> {
    pattern
        .iter()
        .enumerate()
        .filter_map(|(index, &allowed)| allowed.then_some(vec![index]))
        .collect()
}

fn remove_group(board: &mut Board, group: &[usize]) {
    for &cell in group {
        board.clues[cell] = -1;
    }
}

fn restore_group(board: &mut Board, full_clues: &[i8], group: &[usize]) {
    for &cell in group {
        board.clues[cell] = full_clues[cell];
    }
}

fn reduce_clues(
    board: &mut Board,
    solution: &[EdgeState],
    groups: &[Vec<usize>],
    rng: &mut Rng,
    max_nodes: i32,
    exact_reduce: bool,
    no_local_pattern: bool,
    dpn_max: Option<f64>,
    requested_band: Option<&str>,
) -> usize {
    let mut order: Vec<_> = (0..groups.len()).collect();
    rng.shuffle(&mut order);
    let mut checks = 0;
    let has_dpn_upper = dpn_max.is_some()
        || requested_band
            .and_then(band_level)
            .is_some_and(|level| level < 5);
    let mut clue_count =
        board.clues.iter().filter(|&&clue| clue >= 0).count();
    // 中サイズ以上では半数まで減れば実用上十分に疎であり、そこから先は
    // 削除失敗の再確認が支配的になるため、既定モードだけ終盤を打ち切る。
    let clue_floor = (!exact_reduce && board.clues.len() >= 15 * 15)
        .then_some((clue_count + 1) / 2);
    for group_index in order {
        if clue_floor.is_some_and(|floor| clue_count <= floor) {
            break;
        }
        let group = &groups[group_index];
        let saved: Vec<_> =
            group.iter().map(|&cell| board.clues[cell]).collect();
        remove_group(board, group);
        checks += 1;
        let removable =
            reduction_solution(board, max_nodes, exact_reduce, no_local_pattern)
                .as_deref()
                == Some(solution);
        if !removable {
            for (&cell, clue) in group.iter().zip(saved) {
                board.clues[cell] = clue;
            }
        } else {
            let score = has_dpn_upper
                .then(|| normalized_score(board, no_local_pattern));
            if score.is_some_and(|value| {
                exceeds_dpn_upper(value, dpn_max, requested_band)
            }) {
                // 削除順は既にシャッフル済みなので、上限直前で止めても
                // ヒント配置に走査順由来の偏りは生じない。
                for (&cell, clue) in group.iter().zip(saved) {
                    board.clues[cell] = clue;
                }
                break;
            }
            clue_count -= saved.iter().filter(|&&clue| clue >= 0).count();
        }
    }
    checks
}

fn refine_puzzle(
    board: &mut Board,
    solution: &[EdgeState],
    full_clues: &[i8],
    groups: &[Vec<usize>],
    rng: &mut Rng,
    rounds: i32,
    max_nodes: i32,
    exact_reduce: bool,
    no_local_pattern: bool,
) {
    let mut best = difficulty(&run_all(
        board,
        None,
        solver_options(false, no_local_pattern),
    ));
    for _ in 0..rounds {
        let removed: Vec<_> = groups
            .iter()
            .enumerate()
            .filter_map(|(index, group)| {
                group.iter().all(|&cell| board.clues[cell] < 0).then_some(index)
            })
            .collect();
        let present: Vec<_> = groups
            .iter()
            .enumerate()
            .filter_map(|(index, group)| {
                group.iter().all(|&cell| board.clues[cell] >= 0).then_some(index)
            })
            .collect();
        if removed.is_empty() || present.is_empty() {
            return;
        }
        let restored = removed[rng.next_int(removed.len())];
        let deleted = present[rng.next_int(present.len())];
        restore_group(board, full_clues, &groups[restored]);
        remove_group(board, &groups[deleted]);

        let unique =
            reduction_solution(board, max_nodes, exact_reduce, no_local_pattern)
                .as_deref()
            == Some(solution);
        let score = if unique {
            difficulty(&run_all(
                board,
                None,
                solver_options(false, no_local_pattern),
            ))
        } else {
            best
        };
        if unique && score > best {
            best = score;
        } else {
            remove_group(board, &groups[restored]);
            restore_group(board, full_clues, &groups[deleted]);
        }
    }
}

fn valid_options(options: &GenerateOptions) -> Option<(usize, usize)> {
    if options.cols <= 0
        || options.rows <= 0
        || options.attempts < 0
        || options.refine < 0
    {
        return None;
    }
    let cols = options.cols as usize;
    let rows = options.rows as usize;
    let cells = cols.checked_mul(rows)?;
    if cells < 2 || cells > i32::MAX as usize {
        return None;
    }
    if options.pattern.as_ref().is_some_and(|pattern| pattern.len() != cells) {
        return None;
    }
    if options.pattern.is_none()
        && options.symmetry == Symmetry::Rot4
        && cols != rows
    {
        return None;
    }
    Some((cols, rows))
}

fn finish(
    mut board: Board,
    solution: Vec<EdgeState>,
    full_clues: Vec<i8>,
    groups: Vec<Vec<usize>>,
    rng: &mut Rng,
    options: &GenerateOptions,
    attempt: i32,
    stretch: StretchStats,
    observed_dpn: &mut Option<(f64, f64)>,
) -> Result<Option<Generated>, GenerateError> {
    if validate_solution(&board, &solution).is_empty() {
        // パターン指定で最初から落ちているヒントもあるため、削減開始時点で
        // 選択中の方式が正解を証明できない盤面はこの試行では扱わない。
        let initial = technique_solution(&board, options.no_local_pattern)
            .or_else(|| {
                options
                    .exact_reduce
                    .then(|| exact_solution(&board, options.max_nodes))
                    .flatten()
            });
        if initial.as_deref() != Some(solution.as_slice()) {
            return Ok(None);
        }
        let reduction_checks = if options.reduce {
            reduce_clues(
                &mut board,
                &solution,
                &groups,
                rng,
                options.max_nodes,
                options.exact_reduce,
                options.no_local_pattern,
                options.dpn_max,
                options.band.as_deref(),
            )
        } else {
            0
        };
        if options.refine > 0 {
            refine_puzzle(
                &mut board,
                &solution,
                &full_clues,
                &groups,
                rng,
                options.refine,
                options.max_nodes,
                options.exact_reduce,
                options.no_local_pattern,
            );
        }
        // 最終探索は手筋判定とは独立に残し、完走した場合と複数解を
        // 発見した場合に、手筋や生成処理の健全性退行を検出する。
        // 既定モードでは手筋完解が一意性を証明済みなので、独立診断が
        // 生成時間を再び支配しない範囲でも退行の早期検出には十分役立つ。
        const DEFAULT_FINAL_CHECK_NODES: i32 = 50_000;
        let final_check_nodes = if options.exact_reduce || options.max_nodes <= 0 {
            options.max_nodes
        } else {
            options.max_nodes.min(DEFAULT_FINAL_CHECK_NODES)
        };
        let counted = count_solutions(&board, 2, final_check_nodes);
        verify_final_count(&board, &solution, &counted)?;
        let stats = GenerationStats {
            stretch_iterations: stretch.iterations,
            stretch_limit: stretch.limit,
            stretch_accepted: stretch.accepted,
            stretch_initial_length: stretch.initial_length,
            stretch_target_length: stretch.target_length,
            reduction_checks,
            final_check_limit: final_check_nodes,
            final_check_nodes: counted.nodes,
            final_check_aborted: counted.aborted,
            final_check_solutions: counted.solutions.len(),
        };
        let outcome = run_all(
            &board,
            None,
            solver_options(false, options.no_local_pattern),
        );
        let score = difficulty(&outcome);
        let (zero_clues, total_clues) = clue_counts(&board.clues);
        let normalized_score = normalized_difficulty(
            i64::from(score),
            board.clues.len(),
            zero_clues,
            total_clues,
        );
        match observed_dpn {
            Some((minimum, maximum)) => {
                *minimum = minimum.min(normalized_score);
                *maximum = maximum.max(normalized_score);
            }
            None => *observed_dpn = Some((normalized_score, normalized_score)),
        }
        if options.dp_min.is_some_and(|minimum| score < minimum)
            || options.dp_max.is_some_and(|maximum| score > maximum)
            || options
                .dpn_min
                .is_some_and(|minimum| normalized_score < minimum)
            || options
                .dpn_max
                .is_some_and(|maximum| normalized_score > maximum)
            || options
                .band
                .as_deref()
                .is_some_and(|requested| band(normalized_score) != requested)
        {
            return Ok(None);
        }
        return Ok(Some(Generated {
            board,
            solution,
            difficulty: score,
            normalized_difficulty: normalized_score,
            outcome,
            attempts: attempt,
            stats,
        }));
    }
    Ok(None)
}

fn verify_final_count(
    board: &Board,
    solution: &[EdgeState],
    counted: &CountResult,
) -> Result<(), GenerateError> {
    let problem_code = || encode_code(board);
    if counted.solutions.len() >= 2
        || (!counted.aborted && counted.solutions.len() != 1)
    {
        return Err(GenerateError::FinalNotUnique {
            solutions: counted.solutions.len(),
            problem_code: problem_code(),
        });
    }
    if counted
        .solutions
        .first()
        .is_some_and(|found| found != solution)
    {
        return Err(GenerateError::FinalSolutionMismatch {
            problem_code: problem_code(),
        });
    }
    // 打ち切りは非一意の証拠ではない。既定モードでは手筋完解が、
    // 完全探索削減では各削除時の一意性確認が、既知ループの一意性を保証する。
    Ok(())
}

fn generate_report_checked(
    rng: &mut Rng,
    options: &GenerateOptions,
    pattern_mode: bool,
) -> Result<GenerationReport, GenerateError> {
    let mut observed_dpn = None;
    let Some((cols, rows)) = valid_options(options) else {
        return Ok(GenerationReport {
            generated: None,
            dpn_min: None,
            dpn_max: None,
        });
    };
    let mut attempt = 1;
    while options.attempts == 0 || attempt <= options.attempts {
        let Some((inside, stretch)) = grow_inside(rng, cols, rows) else {
            attempt += 1;
            continue;
        };
        let Some(empty) = Board::empty(cols, rows).ok() else {
            return Ok(GenerationReport {
                generated: None,
                dpn_min: None,
                dpn_max: None,
            });
        };
        let solution = boundary_solution(&empty, &inside);
        // 生成条件とは独立なルール検証を必ず通し、境界構築の誤りを隠さない。
        if !validate_solution(&empty, &solution).is_empty() {
            attempt += 1;
            continue;
        }
        let Some(full) = full_clue_board(cols, rows, &solution) else {
            attempt += 1;
            continue;
        };
        let full_clues = full.clues.clone();
        let mut board = full;
        let groups = if pattern_mode {
            if let Some(pattern) = &options.pattern {
                for (cell, &allowed) in pattern.iter().enumerate() {
                    if !allowed {
                        board.clues[cell] = -1;
                    }
                }
                singleton_groups(pattern)
            } else {
                symmetry_groups(cols, rows, options.symmetry)
            }
        } else {
            symmetry_groups(cols, rows, options.symmetry)
        };
        if groups.is_empty() {
            attempt += 1;
            continue;
        }
        if let Some(generated) = finish(
            board,
            solution,
            full_clues,
            groups,
            rng,
            options,
            attempt,
            stretch,
            &mut observed_dpn,
        )? {
            return Ok(GenerationReport {
                generated: Some(generated),
                dpn_min: observed_dpn.map(|range| range.0),
                dpn_max: observed_dpn.map(|range| range.1),
            });
        }
        attempt += 1;
    }
    Ok(GenerationReport {
        generated: None,
        dpn_min: observed_dpn.map(|range| range.0),
        dpn_max: observed_dpn.map(|range| range.1),
    })
}

pub fn generate_loop_report_checked(
    rng: &mut Rng,
    options: &GenerateOptions,
) -> Result<GenerationReport, GenerateError> {
    generate_report_checked(rng, options, false)
}

pub fn generate_pattern_report_checked(
    rng: &mut Rng,
    options: &GenerateOptions,
) -> Result<GenerationReport, GenerateError> {
    generate_report_checked(rng, options, true)
}

pub fn generate_loop_checked(
    rng: &mut Rng,
    options: &GenerateOptions,
) -> Result<Option<Generated>, GenerateError> {
    generate_loop_report_checked(rng, options).map(|report| report.generated)
}

pub fn generate_loop(
    rng: &mut Rng,
    options: &GenerateOptions,
) -> Option<Generated> {
    generate_loop_checked(rng, options)
        .unwrap_or_else(|error| panic!("{error}"))
}

pub fn generate_pattern_checked(
    rng: &mut Rng,
    options: &GenerateOptions,
) -> Result<Option<Generated>, GenerateError> {
    generate_pattern_report_checked(rng, options)
        .map(|report| report.generated)
}

pub fn generate_pattern(
    rng: &mut Rng,
    options: &GenerateOptions,
) -> Option<Generated> {
    generate_pattern_checked(rng, options)
        .unwrap_or_else(|error| panic!("{error}"))
}

impl Default for GenerateOptions {
    fn default() -> Self {
        Self {
            cols: 10,
            rows: 10,
            attempts: 100,
            max_nodes: 200_000,
            dp_min: None,
            dp_max: None,
            dpn_min: None,
            dpn_max: None,
            band: None,
            symmetry: Symmetry::None,
            pattern: None,
            reduce: true,
            exact_reduce: false,
            refine: 0,
            no_local_pattern: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::puzzlink::encode_url;

    fn small_options() -> GenerateOptions {
        GenerateOptions {
            cols: 5,
            rows: 5,
            attempts: 100,
            max_nodes: 0,
            ..GenerateOptions::default()
        }
    }

    #[test]
    fn grown_boundaries_are_always_single_loops() {
        let board = Board::empty(8, 7).expect("盤面を作れる");
        for seed in -10..20 {
            let (inside, _) =
                grow_inside(&mut Rng::new(seed), board.cols, board.rows)
                    .expect("内側領域を生成できる");
            let solution = boundary_solution(&board, &inside);
            assert!(
                validate_solution(&board, &solution).is_empty(),
                "seed {seed} の境界が単一閉路でない"
            );
        }
    }

    #[test]
    fn ten_by_ten_boundaries_cover_at_least_thirty_five_percent() {
        let board = Board::empty(10, 10).expect("盤面を作れる");
        for seed in 1..=8 {
            let (inside, _) =
                grow_inside(&mut Rng::new(seed), board.cols, board.rows)
                    .expect("内側領域を生成できる");
            let solution = boundary_solution(&board, &inside);
            let lines = solution
                .iter()
                .filter(|&&edge| edge == EdgeState::Line)
                .count();
            assert!(
                lines * 100 >= board.edge_count() * 35,
                "seed {seed} の境界長 {lines} が総辺数の35%未満"
            );
        }
    }

    #[test]
    fn generated_puzzles_are_unique_and_keep_drawn_solution() {
        for seed in 0..5 {
            let options = small_options();
            let generated = generate_loop(&mut Rng::new(seed), &options)
                .expect("問題を生成できる");
            let techniques = technique_solution(&generated.board, false)
                .expect("既定モードの問題は仮置きなしで完解できる");
            assert_eq!(techniques, generated.solution);
            let counted = count_solutions(&generated.board, 2, 0);
            assert!(!counted.aborted);
            assert_eq!(counted.solutions.len(), 1, "seed {seed} が一意でない");
            assert_eq!(counted.solutions[0], generated.solution);
        }
    }

    #[test]
    fn aborted_final_count_keeps_a_previously_proved_puzzle() {
        let board = Board::empty(2, 1).expect("盤面を作れる");
        let solution = vec![EdgeState::Cross; board.edge_count()];
        let counted = CountResult {
            solutions: Vec::new(),
            nodes: 1,
            aborted: true,
        };

        // 探索上限は非一意を意味しないため、先行する手筋または削減時探索の
        // 証明を取り消さず、最終診断だけを理由に試行を捨てない。
        assert!(verify_final_count(&board, &solution, &counted).is_ok());
    }

    #[test]
    fn final_count_with_two_solutions_reports_the_problem_code() {
        let board = Board::empty(2, 1).expect("盤面を作れる");
        let solution = vec![EdgeState::Cross; board.edge_count()];
        let counted = CountResult {
            solutions: vec![solution.clone(), solution.clone()],
            nodes: 2,
            aborted: true,
        };

        let error = verify_final_count(&board, &solution, &counted)
            .expect_err("二解を発見した場合は打ち切りでもエラーにする");
        assert!(error.to_string().contains(&encode_code(&board)));
    }

    #[test]
    fn exact_reduction_can_remove_clues_beyond_technique_reduction() {
        let technique_options = small_options();
        let exact_options = GenerateOptions {
            exact_reduce: true,
            ..small_options()
        };
        let technique =
            generate_loop(&mut Rng::new(0), &technique_options)
                .expect("手筋方式で問題を生成できる");
        let exact = generate_loop(&mut Rng::new(0), &exact_options)
            .expect("完全探索方式で問題を生成できる");
        let technique_clues =
            technique.board.clues.iter().filter(|&&clue| clue >= 0).count();
        let exact_clues =
            exact.board.clues.iter().filter(|&&clue| clue >= 0).count();

        // 同じループと削除順でも、完全探索なら手筋だけでは証明できない
        // 一意な削除を採用できることを固定シードで回帰検査する。
        assert_eq!(technique.solution, exact.solution);
        assert!(exact_clues < technique_clues);
        let counted = count_solutions(&exact.board, 2, 0);
        assert!(!counted.aborted);
        assert_eq!(counted.solutions, vec![exact.solution]);
    }

    #[test]
    fn generation_is_deterministic() {
        let options = small_options();
        let first = generate_loop(&mut Rng::new(1234), &options)
            .expect("一回目を生成できる");
        let second = generate_loop(&mut Rng::new(1234), &options)
            .expect("二回目を生成できる");
        assert_eq!(encode_url(&first.board), encode_url(&second.board));
        assert_eq!(first.solution, second.solution);
    }

    #[test]
    fn reduction_upper_uses_dpn_max_and_band_boundary() {
        assert!(!exceeds_dpn_upper(395.999, None, Some("easy")));
        assert!(exceeds_dpn_upper(396.0, None, Some("easy")));
        assert!(exceeds_dpn_upper(300.0, Some(299.0), None));
        assert!(!exceeds_dpn_upper(299.0, Some(299.0), None));
    }

    #[test]
    fn easy_band_stops_before_its_upper_boundary() {
        let options = GenerateOptions {
            cols: 10,
            rows: 10,
            attempts: 20,
            band: Some("easy".to_string()),
            ..GenerateOptions::default()
        };
        let first = generate_loop(&mut Rng::new(1), &options)
            .expect("10x10 の easy を生成できる");
        let second = generate_loop(&mut Rng::new(1), &options)
            .expect("同じ条件でもう一度生成できる");

        assert_eq!(band(first.normalized_difficulty), "easy");
        assert!(first.normalized_difficulty < 396.0);
        assert_eq!(encode_url(&first.board), encode_url(&second.board));
        assert_eq!(first.solution, second.solution);
        let counted = count_solutions(&first.board, 2, 0);
        assert!(!counted.aborted);
        assert_eq!(counted.solutions, vec![first.solution]);
    }

    #[test]
    fn rejected_attempts_report_the_observed_dpn_range() {
        let options = GenerateOptions {
            cols: 4,
            rows: 4,
            attempts: 3,
            max_nodes: 0,
            dpn_min: Some(1_000_000.0),
            ..GenerateOptions::default()
        };
        let report =
            generate_loop_report_checked(&mut Rng::new(7), &options)
                .expect("生成試行を完了できる");

        assert!(report.generated.is_none());
        let minimum = report.dpn_min.expect("DPN 最小値を観測できる");
        let maximum = report.dpn_max.expect("DPN 最大値を観測できる");
        assert!(minimum.is_finite());
        assert!(minimum <= maximum);
        assert!(maximum < 1_000_000.0);
    }

    fn assert_clue_placement_symmetry(board: &Board, symmetry: Symmetry) {
        for y in 0..board.rows {
            for x in 0..board.cols {
                let (symmetric_x, symmetric_y) = match symmetry {
                    Symmetry::None => (x, y),
                    Symmetry::Rot2 => {
                        (board.cols - 1 - x, board.rows - 1 - y)
                    }
                    Symmetry::Rot4 => {
                        assert_eq!(
                            board.cols, board.rows,
                            "4回対称の検査には正方形盤面が必要"
                        );
                        (board.cols - 1 - y, x)
                    }
                    Symmetry::MirrorH => (board.cols - 1 - x, y),
                    Symmetry::MirrorV => (x, board.rows - 1 - y),
                };
                let index = y * board.cols + x;
                let symmetric =
                    symmetric_y * board.cols + symmetric_x;
                assert_eq!(
                    board.clues[symmetric] >= 0,
                    board.clues[index] >= 0,
                    "セル {index} と {symmetric} のヒント有無が対称でない"
                );
            }
        }
    }

    #[test]
    fn all_symmetries_hold_in_loop_generation() {
        let symmetries = [
            Symmetry::Rot2,
            Symmetry::Rot4,
            Symmetry::MirrorH,
            Symmetry::MirrorV,
        ];
        for (offset, symmetry) in symmetries.into_iter().enumerate() {
            let options = GenerateOptions {
                symmetry,
                ..small_options()
            };
            let seed = 99 + offset as i64;
            let loop_generated = generate_loop(&mut Rng::new(seed), &options)
                .expect("ループ先行方式で対称問題を生成できる");

            assert_clue_placement_symmetry(&loop_generated.board, symmetry);
        }
    }

    #[test]
    fn all_symmetries_hold_in_pattern_generation() {
        let symmetries = [
            Symmetry::Rot2,
            Symmetry::Rot4,
            Symmetry::MirrorH,
            Symmetry::MirrorV,
        ];
        for (offset, symmetry) in symmetries.into_iter().enumerate() {
            let options = GenerateOptions {
                symmetry,
                ..small_options()
            };
            let seed = 99 + offset as i64;
            let pattern_generated =
                generate_pattern(&mut Rng::new(seed), &options)
                    .expect("パターン方式で対称問題を生成できる");

            assert_clue_placement_symmetry(&pattern_generated.board, symmetry);
        }
    }

    #[test]
    fn none_symmetry_keeps_previous_loop_output() {
        let options = GenerateOptions {
            symmetry: Symmetry::None,
            ..small_options()
        };
        let expected = [
            (1, "slither/5/5/cg8di11771138d"),
            (2, "slither/5/5/g818cg23c85cd"),
            (1234, "slither/5/5/223cg2b23b3c57b"),
        ];
        for (seed, code) in expected {
            let generated = generate_loop(&mut Rng::new(seed), &options)
                .expect("従来互換の問題を生成できる");
            assert_eq!(encode_code(&generated.board), code);
        }
    }

    #[test]
    fn technique_solver_is_sound_on_fifty_generated_puzzles() {
        let options = GenerateOptions {
            cols: 4,
            rows: 4,
            attempts: 100,
            max_nodes: 0,
            reduce: false,
            ..GenerateOptions::default()
        };
        for seed in 0..50 {
            let generated = generate_loop(&mut Rng::new(seed), &options)
                .expect("健全性検査用問題を生成できる");
            for (edge, &state) in
                generated.outcome.answer.edges().iter().enumerate()
            {
                if state != EdgeState::Unknown {
                    assert_eq!(
                        state, generated.solution[edge],
                        "seed {seed} の辺 {edge} が唯一解と食い違う"
                    );
                }
            }
        }
    }
}
