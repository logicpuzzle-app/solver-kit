//! puzz.link URL を受け取り、数独 (npgenerator) / スリザーリンク (slitherlink-kit) /
//! ヤジリン (yajilin-kit) を解いて難易度判定つきの JSON を返す wasm バインディング。
//!
//! 難易度較正の出どころ: 数独は tmp/npgen-puzsq-sudoku-fit.md(puzsq 211 問)、
//! スリザーリンクとヤジリンは各 kit 側(1,585 問 / 8,814 問)。
//! モデル版はパズル種ごとに独立で、結果 JSON の difficulty_version が示す。

use serde::Serialize;
use wasm_bindgen::prelude::*;

use yajilin_kit::board::{to_id, Board};
use yajilin_kit::difficulty::{
    band as yj_band, difficulty as yj_difficulty, puzsq_rating_hundredths, DIFFICULTY_VERSION,
};
use yajilin_kit::puzzlink::decode_url as yj_decode_url;
use yajilin_kit::search::count_solutions;
use yajilin_kit::solution::extract_solution;
use yajilin_kit::solver::{run_all, SolveOptions, SolveStatus};

/// puzsq 較正 (2026-08-03) の手詰まりペナルティと★バンド閾値。
/// tmp/npgen-puzsq-sudoku-fit.md 参照。値を変えたら必ず再較正すること。
const SUDOKU_STUCK_PENALTY: f64 = 700.0;
const SUDOKU_BANDS: [f64; 4] = [887.0, 10404.0, 23257.0, 42401.0];

/// DP_eff → puzsq 1〜5 スケール(×100)の補間アンカー。yajilin-kit の
/// PUZSQ_RATING_POINTS と同じ流儀で、★の切り替わる境界(バンド閾値)を x.5 に置く。
/// 上端は較正コーパスの ★4/★5 上限(〜16万)を 5.49 に対応させた。
const SUDOKU_RATING_POINTS: [(f64, i32); 6] = [
    (0.0, 50),
    (887.0, 150),
    (10404.0, 250),
    (23257.0, 350),
    (42401.0, 450),
    (160000.0, 549),
];

/// DPN → puzsq 1〜5 スケール(×100)。境界は slitherlink-kit の band() の
/// バンド閾値(easy/medium/hard/expert/fiendish)。上端はバンド上限比を
/// 数独と揃えて 24,000 → 5.49。
const SLITHER_RATING_POINTS: [(f64, i32); 6] = [
    (0.0, 50),
    (396.0, 150),
    (1145.0, 250),
    (2412.0, 350),
    (7948.0, 450),
    (24000.0, 549),
];

/// アンカー列に沿った線形補間。範囲外は端の値に丸める。
fn interp_rating_hundredths(points: &[(f64, i32)], score: f64) -> i32 {
    if score <= points[0].0 {
        return points[0].1;
    }
    let last = points[points.len() - 1];
    if score >= last.0 {
        return last.1;
    }
    for i in 1..points.len() {
        let (x1, y1) = points[i];
        if score < x1 {
            let (x0, y0) = points[i - 1];
            return (f64::from(y0) + (score - x0) / (x1 - x0) * f64::from(y1 - y0)).round()
                as i32;
        }
    }
    last.1
}

/// 数独の難易度モデル版。v1 = puzsq 211 問での較正(tmp/npgen-puzsq-sudoku-fit.md)。
const SUDOKU_DIFFICULTY_VERSION: u32 = 1;
/// スリザーリンクの難易度モデル版。v1 = slitherlink-kit 同梱の 1,585 問較正。
const SLITHER_DIFFICULTY_VERSION: u32 = 1;

/// ヤジリンの唯一解判定の探索ノード上限(yajilin-kit CLI と同じ値)。
const YJ_UNIQUENESS_NODES: i32 = 250_000;

/// スリザーリンクの唯一解判定の探索ノード上限(slitherlink-kit CLI の既定値)。
const SL_UNIQUENESS_NODES: i32 = 200_000;

#[derive(Serialize)]
struct SudokuResult {
    kind: &'static str,
    size: usize,
    block_width: usize,
    block_height: usize,
    problem: Vec<i32>,
    /// 手筋ソルバーの到達盤面(手詰まりなら 0 が残る)
    solution: Vec<i32>,
    /// バックトラックで求めた完全解(解が存在するとき)
    full_solution: Option<Vec<i32>>,
    /// 厳密な解の個数: "0" / "1" / "2+" / "?"(探索上限到達)
    solutions: &'static str,
    answer_kind: &'static str,
    dp: f64,
    unsolved: usize,
    dp_eff: f64,
    stars: u32,
    /// puzsq 1〜5 スケールの推定 ×100(例: 387 = 3.87)
    rating_hundredths: i32,
    difficulty_version: u32,
}

/// 厳密な解数カウント(バックトラック、最小候補セル選択)。
/// 戻り値は (見つけた解の数(limit で打ち切り), 最初の解, 探索を打ち切ったか)。
fn count_sudoku_solutions(
    size: usize,
    units_of: &[Vec<usize>],
    units: &[Vec<usize>],
    problem: &[i32],
    limit: usize,
    node_cap: u64,
) -> (usize, Option<Vec<i32>>, bool) {
    let ncells = size * size;
    let full: u32 = if size >= 32 { u32::MAX } else { (1u32 << size) - 1 };
    // ユニットごとの使用済みマスク
    let mut used = vec![0u32; units.len()];
    let mut grid: Vec<i32> = problem.to_vec();
    for (cell, &v) in problem.iter().enumerate() {
        if v > 0 {
            let bit = 1u32 << (v - 1);
            for &u in &units_of[cell] {
                if used[u] & bit != 0 {
                    return (0, None, false); // 与えられたヒントが矛盾
                }
                used[u] |= bit;
            }
        }
    }
    let mut count = 0usize;
    let mut first: Option<Vec<i32>> = None;
    let mut nodes = 0u64;
    let mut aborted = false;

    fn rec(
        grid: &mut Vec<i32>,
        used: &mut Vec<u32>,
        units_of: &[Vec<usize>],
        full: u32,
        ncells: usize,
        limit: usize,
        node_cap: u64,
        count: &mut usize,
        first: &mut Option<Vec<i32>>,
        nodes: &mut u64,
        aborted: &mut bool,
    ) {
        if *count >= limit || *aborted {
            return;
        }
        *nodes += 1;
        if *nodes > node_cap {
            *aborted = true;
            return;
        }
        // 最小候補のセルを選ぶ
        let mut best_cell = usize::MAX;
        let mut best_mask = 0u32;
        let mut best_n = u32::MAX;
        for cell in 0..ncells {
            if grid[cell] != 0 {
                continue;
            }
            let mut mask = full;
            for &u in &units_of[cell] {
                mask &= !used[u];
            }
            let n = mask.count_ones();
            if n < best_n {
                best_n = n;
                best_cell = cell;
                best_mask = mask;
                if n <= 1 {
                    break;
                }
            }
        }
        if best_cell == usize::MAX {
            *count += 1;
            if first.is_none() {
                *first = Some(grid.clone());
            }
            return;
        }
        let mut mask = best_mask;
        while mask != 0 {
            let bit = mask & mask.wrapping_neg();
            mask ^= bit;
            let v = bit.trailing_zeros() as i32 + 1;
            grid[best_cell] = v;
            for &u in &units_of[best_cell] {
                used[u] |= bit;
            }
            rec(grid, used, units_of, full, ncells, limit, node_cap, count, first, nodes, aborted);
            for &u in &units_of[best_cell] {
                used[u] &= !bit;
            }
            grid[best_cell] = 0;
            if *count >= limit || *aborted {
                return;
            }
        }
    }
    rec(
        &mut grid, &mut used, units_of, full, ncells, limit, node_cap,
        &mut count, &mut first, &mut nodes, &mut aborted,
    );
    (count, first, aborted)
}

/// 行・列・ブロックのユニットを構築する。
fn sudoku_units(size: usize, bw: usize, bh: usize) -> (Vec<Vec<usize>>, Vec<Vec<usize>>) {
    let mut units: Vec<Vec<usize>> = Vec::new();
    for r in 0..size {
        units.push((0..size).map(|c| r * size + c).collect());
    }
    for c in 0..size {
        units.push((0..size).map(|r| r * size + c).collect());
    }
    for br in (0..size).step_by(bh) {
        for bc in (0..size).step_by(bw) {
            units.push(
                (0..bh)
                    .flat_map(|dr| (0..bw).map(move |dc| (br + dr) * size + bc + dc))
                    .collect(),
            );
        }
    }
    let mut units_of = vec![Vec::new(); size * size];
    for (ui, u) in units.iter().enumerate() {
        for &cell in u {
            units_of[cell].push(ui);
        }
    }
    (units_of, units)
}

#[derive(Serialize)]
struct YajilinClue {
    x: i32,
    y: i32,
    dir: i32,
    num: i32,
}

#[derive(Serialize)]
struct YajilinResult {
    kind: &'static str,
    cols: i32,
    rows: i32,
    clues: Vec<YajilinClue>,
    blacks: Vec<[i32; 2]>,
    /// (x,y) と (x+1,y) を結ぶ線
    hlines: Vec<[i32; 2]>,
    /// (x,y) と (x,y+1) を結ぶ線
    vlines: Vec<[i32; 2]>,
    status: &'static str,
    solutions: &'static str,
    dp: i32,
    band: &'static str,
    /// puzsq 1〜5 スケールの推定 ×100(唯一解でないときは None)
    rating_hundredths: Option<i32>,
    /// 解くのに要った読みの段階(1〜6)。難易度スコアの主軸。
    level: u8,
    /// 難易度モデルの版(yajilin-kit の DIFFICULTY_VERSION)
    difficulty_version: u32,
}

#[derive(Serialize)]
struct SlitherResult {
    kind: &'static str,
    cols: usize,
    rows: usize,
    /// マスごとのヒント(-1 はなし)
    clues: Vec<i8>,
    /// 点 (x,y)-(x+1,y) の線
    hlines: Vec<[usize; 2]>,
    /// 点 (x,y)-(x,y+1) の線
    vlines: Vec<[usize; 2]>,
    status: &'static str,
    solutions: &'static str,
    dp: i32,
    /// 盤面サイズ・0ヒント率で正規化したスコア(バンドはこちらで判定)
    dpn: f64,
    band: &'static str,
    stars: u32,
    /// puzsq 1〜5 スケールの推定 ×100(例: 314 = 3.14)
    rating_hundredths: i32,
    difficulty_version: u32,
}

fn solve_slitherlink(input: &str) -> Result<String, String> {
    use slitherlink_kit::difficulty::{
        band as sl_band, clue_counts, difficulty as sl_difficulty, normalized_difficulty,
    };
    use slitherlink_kit::engine::EdgeState;
    use slitherlink_kit::puzzlink::decode_url as sl_decode_url;
    use slitherlink_kit::search::count_solutions as sl_count_solutions;
    use slitherlink_kit::solver::{
        run_all as sl_run_all, SolveOptions as SlOptions, SolveStatus as SlStatus,
    };

    let board = sl_decode_url(input)?;
    let outcome = sl_run_all(
        &board,
        None,
        SlOptions {
            no_trial: false,
            max_passes: 0,
            no_local_pattern: false,
        },
    );
    let dp = sl_difficulty(&outcome);
    let (zero_clues, total_clues) = clue_counts(&board.clues);
    let dpn = normalized_difficulty(i64::from(dp), board.clues.len(), zero_clues, total_clues);
    let status = match outcome.status {
        SlStatus::Completed => "COMPLETED",
        SlStatus::Stopped => "STOPPED",
        SlStatus::Broken => "BROKEN",
    };
    // 完解 = 手筋(すべて健全)で一意性が証明済み。手詰まりのときだけ探索する。
    let solutions = if outcome.status == SlStatus::Completed {
        "1"
    } else {
        let counted = sl_count_solutions(&board, 2, SL_UNIQUENESS_NODES);
        if counted.aborted {
            "?"
        } else {
            match counted.solutions.len() {
                0 => "0",
                1 => "1",
                _ => "2+",
            }
        }
    };
    let mut hlines = Vec::new();
    let mut vlines = Vec::new();
    let edges = outcome.answer.edges();
    for y in 0..=board.rows {
        for x in 0..board.cols {
            if edges[board.h_id(x, y)] == EdgeState::Line {
                hlines.push([x, y]);
            }
        }
    }
    for y in 0..board.rows {
        for x in 0..=board.cols {
            if edges[board.v_id(x, y)] == EdgeState::Line {
                vlines.push([x, y]);
            }
        }
    }
    let band_name = sl_band(dpn);
    let stars = match band_name {
        "intro" | "easy" => 1,
        "medium" => 2,
        "hard" => 3,
        "expert" => 4,
        _ => 5,
    };
    let out = SlitherResult {
        kind: "slitherlink",
        cols: board.cols,
        rows: board.rows,
        clues: board.clues.clone(),
        hlines,
        vlines,
        status,
        solutions,
        dp,
        dpn,
        band: band_name,
        stars,
        rating_hundredths: interp_rating_hundredths(&SLITHER_RATING_POINTS, dpn),
        difficulty_version: SLITHER_DIFFICULTY_VERSION,
    };
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

fn strip_query(input: &str) -> &str {
    let text = input.trim();
    match text.find('?') {
        Some(at) => &text[at + 1..],
        None => text,
    }
}

/// pzpr の Number16 デコード(variety-common/Encode.js 準拠、盤面値の範囲のみ)。
fn decode_number16(body: &str, ncells: usize) -> Result<Vec<i32>, String> {
    let chars: Vec<char> = body.chars().collect();
    let mut cells = vec![0i32; ncells];
    let mut c = 0usize;
    let mut i = 0usize;
    let hex = |slice: &[char]| -> Result<i32, String> {
        let text: String = slice.iter().collect();
        i32::from_str_radix(&text, 16).map_err(|_| format!("不正なエンコード: {text}"))
    };
    while i < chars.len() && c < ncells {
        let ca = chars[i];
        if ca.is_ascii_hexdigit() {
            cells[c] = ca.to_digit(16).unwrap() as i32;
            i += 1;
            c += 1;
        } else if ca == '-' {
            if i + 3 > chars.len() {
                return Err("エンコードが途中で切れています".into());
            }
            cells[c] = hex(&chars[i + 1..i + 3])?;
            i += 3;
            c += 1;
        } else if ca == '.' {
            return Err("『?』ヒント入りの盤面には対応していません".into());
        } else if ('g'..='z').contains(&ca) {
            c += ca.to_digit(36).unwrap() as usize - 15;
            i += 1;
        } else {
            i += 1;
        }
    }
    Ok(cells)
}

fn sudoku_stars(dp_eff: f64) -> u32 {
    let mut stars = 1;
    for cut in SUDOKU_BANDS {
        if dp_eff >= cut {
            stars += 1;
        }
    }
    stars
}

fn solve_sudoku(query: &str) -> Result<String, String> {
    let parts: Vec<&str> = query.split('/').filter(|p| !p.is_empty()).collect();
    if parts.len() < 4 {
        return Err("sudoku/幅/高さ/盤面 の形式ではありません".into());
    }
    let w: usize = parts[1].parse().map_err(|_| "サイズが読めません".to_string())?;
    let h: usize = parts[2].parse().map_err(|_| "サイズが読めません".to_string())?;
    if w != h {
        return Err(format!("{w}x{h}: 正方形の盤面のみ対応しています"));
    }
    let size = w;
    // ブロック分割: 平方数はデフォルト(√n×√n)、6x6 のみ横3×縦2
    let (block_kind, bw, bh) = match size {
        4 | 9 | 16 | 25 => (0u32, 0usize, 0usize),
        6 => (1u32, 3usize, 2usize),
        _ => return Err(format!("{size}x{size} のブロック分割には対応していません")),
    };
    let body = parts[3..].join("/");
    let problem = decode_number16(&body, size * size)?;
    if problem.iter().all(|&v| v == 0) {
        return Err("盤面が空です".into());
    }
    if problem.iter().any(|&v| v > size as i32) {
        return Err("盤面の数字がサイズを超えています".into());
    }
    // 厳密な解数を先に数える(npgen の answer_kind は生成用の手筋ベース判定のため)
    let (real_bw, real_bh) = if block_kind == 0 {
        let root = (size as f64).sqrt() as usize;
        (root, root)
    } else {
        (bw, bh)
    };
    let (units_of, units) = sudoku_units(size, real_bw, real_bh);
    let (count, first, aborted) =
        count_sudoku_solutions(size, &units_of, &units, &problem, 2, 5_000_000);
    if !aborted && count == 0 {
        return Err("解がありません".into());
    }
    let result = npgen::solve_puzzle(
        size as u32,
        problem.clone(),
        block_kind,
        bw as u32,
        bh as u32,
        Vec::new(),
        Vec::new(),
        true,  // vertical
        true,  // horizontal
        false, // diagonal
        false,
        0,   // seed
        127, // 全手筋
        7,   // 全一意性判定
    )
    .map_err(|_| "解けませんでした".to_string())?;

    let solution = result.solution();
    let unsolved = solution.iter().filter(|&&v| v == 0).count();
    let dp = result.difficulty();
    let dp_eff = dp + SUDOKU_STUCK_PENALTY * unsolved as f64;
    let answer_kind = match result.answer_kind() {
        0 => "unique",
        1 => "no_answer",
        2 => "multiple",
        3 => "irregular",
        _ => "no_judge",
    };
    let solutions = if aborted {
        "?"
    } else {
        match count {
            0 => "0",
            1 => "1",
            _ => "2+",
        }
    };
    let out = SudokuResult {
        kind: "sudoku",
        size,
        block_width: real_bw,
        block_height: real_bh,
        problem,
        solution,
        full_solution: first,
        solutions,
        answer_kind,
        dp,
        unsolved,
        dp_eff,
        stars: sudoku_stars(dp_eff),
        rating_hundredths: interp_rating_hundredths(&SUDOKU_RATING_POINTS, dp_eff),
        difficulty_version: SUDOKU_DIFFICULTY_VERSION,
    };
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

fn yajilin_answers(board: &Board, status: SolveStatus) -> &'static str {
    if status == SolveStatus::Completed {
        return "1";
    }
    let found = count_solutions(board, 2, YJ_UNIQUENESS_NODES);
    if found.aborted {
        return "?";
    }
    match found.solutions.len() {
        0 => "0",
        1 => "1",
        _ => "2+",
    }
}

fn solve_yajilin(input: &str) -> Result<String, String> {
    let board = yj_decode_url(input)?;
    let outcome = run_all(
        &board,
        None,
        SolveOptions {
            no_trial: false,
            max_passes: 0,
        },
    );
    let solution = extract_solution(&outcome.answer);
    let score = yj_difficulty(&outcome, &board);
    let status = match outcome.status {
        SolveStatus::Completed => "COMPLETED",
        SolveStatus::Stopped => "STOPPED",
        SolveStatus::Broken => "BROKEN",
    };
    let solutions = yajilin_answers(&board, outcome.status);

    let mut clues = Vec::new();
    for y in 0..board.rows {
        for x in 0..board.cols {
            let cell = board.cell[(y * board.cols + x) as usize];
            if cell.qnum != -1 {
                clues.push(YajilinClue {
                    x,
                    y,
                    dir: cell.qdir,
                    num: cell.qnum,
                });
            }
        }
    }
    let mut blacks = Vec::new();
    let mut hlines = Vec::new();
    let mut vlines = Vec::new();
    for y in 0..board.rows {
        for x in 0..board.cols {
            let id = to_id(yajilin_kit::position::Position { x, y });
            if solution.blacks.contains(&id) {
                blacks.push([x, y]);
            }
            if solution.horizontal.contains(&id) {
                hlines.push([x, y]);
            }
            if solution.vertical.contains(&id) {
                vlines.push([x, y]);
            }
        }
    }
    let out = YajilinResult {
        kind: "yajilin",
        cols: board.cols,
        rows: board.rows,
        clues,
        blacks,
        hlines,
        vlines,
        status,
        solutions,
        dp: score,
        band: yj_band(score),
        rating_hundredths: (solutions == "1").then(|| puzsq_rating_hundredths(score)),
        level: outcome.stats.level,
        difficulty_version: DIFFICULTY_VERSION,
    };
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct NurikabeResult {
    kind: &'static str,
    cols: i32,
    rows: i32,
    /// マスごとのヒント(-1 はなし、-2 は `?`)
    clues: Vec<i32>,
    /// かべ(黒)のマス
    blacks: Vec<[i32; 2]>,
    /// シマ(白)と確定したマス。ヒントのマスは含まない
    whites: Vec<[i32; 2]>,
    status: &'static str,
    solutions: &'static str,
    dp: i32,
    /// 解くのに要った読みの段階(1〜7)。難易度スコアの主軸
    level: u8,
    /// 手筋が尽きた時点で残っていた未確定マス
    unknown: usize,
    /// puzsq 1〜5 スケールの推定 ×100(唯一解でないときは None)
    rating_hundredths: Option<i32>,
    difficulty_version: u32,
}

/// ぬりかべの唯一解判定の探索ノード上限。
///
/// CLI は 2,000 万を使うが、ここは応答性を優先して 200 万にしてある。
/// 手筋が途中までしか埋められなかった問題は枝刈りが効かず、2,000 万だと
/// 45 秒かかることがあった。200 万なら最大 4.5 秒で、打ち切りになる問題の数は変わらない。
/// 打ち切ったら "?" を返し、難易度は出さない。
const NURIKABE_SEARCH_NODES: usize = 2_000_000;

/// 美術館の一意性判定に使うノード上限。手が尽きたときだけ走る。
const AKARI_SEARCH_NODES: u64 = 2_000_000;

fn solve_nurikabe(input: &str) -> Result<String, String> {
    use nurikabe_kit::difficulty::{
        difficulty as nk_difficulty, puzsq_rating_hundredths as nk_rating, DIFFICULTY_VERSION as NK_VERSION,
    };
    use nurikabe_kit::puzzlink::decode_url as nk_decode_url;
    use nurikabe_kit::search::count_solutions_from as nk_count_from;
    use nurikabe_kit::solver::{run_all as nk_run_all, SolveOptions as NkOptions, SolveStatus as NkStatus};

    let board = nk_decode_url(input)?;
    let outcome = nk_run_all(&board, NkOptions::default());
    let score = nk_difficulty(&outcome);
    let status = match outcome.status {
        NkStatus::Completed => "COMPLETED",
        NkStatus::Stopped => "STOPPED",
        NkStatus::Broken => "BROKEN",
    };

    // 手筋の確定はすべて健全な推論なので、どの解もそれを満たす。
    // よって途中盤面から探索を始めてよく、枝刈りが効いて桁違いに速い
    // (10x10 で 11 秒 → 25 ミリ秒)。
    //
    // 矛盾を見つけたときは解が無いことが確定しているので、探索そのものを省く。
    // ここで最初から数え直すと、解の無い大盤面で 2 分以上かかっていた。
    let solutions = if outcome.status == NkStatus::Broken {
        "0"
    } else {
        let found = nk_count_from(&board, &outcome.answer, 2, NURIKABE_SEARCH_NODES);
        if found.aborted {
            "?"
        } else {
            match found.solutions.len() {
                0 => "0",
                1 => "1",
                _ => "2+",
            }
        }
    };

    let clues = board.clues.clone();
    let mut blacks = Vec::new();
    let mut whites = Vec::new();
    for index in 0..board.cell_count() {
        let (x, y) = board.position(index);
        if outcome.answer.is_black(index) {
            blacks.push([x, y]);
        } else if outcome.answer.is_white(index) && !board.is_clue(x, y) {
            whites.push([x, y]);
        }
    }

    let out = NurikabeResult {
        kind: "nurikabe",
        cols: board.cols,
        rows: board.rows,
        clues,
        blacks,
        whites,
        status,
        solutions,
        dp: score,
        level: outcome.level,
        unknown: outcome.answer.unknown_count(),
        // 「一意でないと分かった」ときだけ評価を伏せる。数えきれなかった(`?`)のは
        // 複数あるという証拠ではないので、評価は出す(CLI と同じ規則)。
        rating_hundredths: (solutions != "2+" && solutions != "0").then(|| nk_rating(score)),
        difficulty_version: NK_VERSION,
    };
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct AkariResult {
    kind: &'static str,
    cols: i32,
    rows: i32,
    /// マスごとの中身(-1 は白マス、-2 は数字なしのかべ、0〜4 は数字つきのかべ)
    cells: Vec<i32>,
    /// 照明を置くマス
    lamps: Vec<[i32; 2]>,
    /// 照明を置かないと確定した白マス
    empties: Vec<[i32; 2]>,
    /// 照明に照らされているマス。照射は照明の配置から導く派生量
    lit: Vec<[i32; 2]>,
    status: &'static str,
    solutions: &'static str,
    dp: i32,
    /// 解くのに要った読みの段階(1〜8)。難易度スコアの主軸
    level: u8,
    unknown: usize,
    rating_hundredths: Option<i32>,
    difficulty_version: u32,
}

fn solve_akari(input: &str) -> Result<String, String> {
    use akari_kit::difficulty::{
        difficulty as ak_difficulty, puzsq_rating_hundredths as ak_rating,
        DIFFICULTY_VERSION as AK_VERSION,
    };
    use akari_kit::puzzlink::decode_url as ak_decode_url;
    use akari_kit::search::count_solutions_from as ak_count_from;
    use akari_kit::solver::{
        run_all as ak_run_all, SolveOptions as AkOptions, SolveStatus as AkStatus,
    };

    let board = ak_decode_url(input)?;
    let outcome = ak_run_all(&board, AkOptions::default());
    let score = ak_difficulty(&outcome);
    let status = match outcome.status {
        AkStatus::Completed => "COMPLETED",
        AkStatus::Stopped => "STOPPED",
        AkStatus::Broken => "BROKEN",
    };

    // 手筋がすべて健全な演繹である以上、完解できたなら解は一意。
    // だから探索が要るのは手が尽きたときだけで、そこも途中盤面から始めれば速い。
    let solutions = match outcome.status {
        AkStatus::Completed => "1",
        AkStatus::Broken => "0",
        AkStatus::Stopped => {
            let found = ak_count_from(&board, outcome.answer.clone(), 2, AKARI_SEARCH_NODES);
            if found.aborted {
                "?"
            } else {
                match found.solutions.len() {
                    0 => "0",
                    1 => "1",
                    _ => "2+",
                }
            }
        }
    };

    let lit_flags = outcome.answer.lit(&board);
    let mut lamps = Vec::new();
    let mut empties = Vec::new();
    let mut lit = Vec::new();
    for index in 0..board.cell_count() {
        let (x, y) = board.position(index);
        if board.is_wall(index) {
            continue;
        }
        if outcome.answer.is_lamp(index) {
            lamps.push([x, y]);
        } else if outcome.answer.is_empty(index) {
            empties.push([x, y]);
        }
        if lit_flags[index] {
            lit.push([x, y]);
        }
    }

    let out = AkariResult {
        kind: "akari",
        cols: board.cols,
        rows: board.rows,
        cells: board.cells.clone(),
        lamps,
        empties,
        lit,
        status,
        solutions,
        dp: score,
        level: outcome.level,
        unknown: outcome.answer.unknown_count(),
        // 「一意でないと分かった」ときだけ評価を伏せる。数えきれなかった(`?`)のは
        // 複数あるという証拠ではないので、評価は出す(CLI と同じ規則)。
        rating_hundredths: (solutions != "2+" && solutions != "0").then(|| ak_rating(score)),
        difficulty_version: AK_VERSION,
    };
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

const MASYU_SEARCH_NODES: u64 = 2_000_000;

#[derive(Serialize)]
struct MasyuResult {
    kind: &'static str,
    cols: i32,
    rows: i32,
    /// 白丸のマス
    whites: Vec<[i32; 2]>,
    /// 黒丸のマス
    blacks: Vec<[i32; 2]>,
    /// 線の入った水平辺(左側のマスの座標)
    hlines: Vec<[i32; 2]>,
    /// 線の入った垂直辺(上側のマスの座標)
    vlines: Vec<[i32; 2]>,
    status: &'static str,
    solutions: &'static str,
    dp: i32,
    /// 解くのに要った読みの段階(1〜7)。難易度スコアの主軸
    level: u8,
    /// 未確定の辺の数(ましゅの確定率の分母はマスではなく辺)
    unknown: usize,
    rating_hundredths: Option<i32>,
    difficulty_version: u32,
}

fn solve_masyu(input: &str) -> Result<String, String> {
    use masyu_kit::board::{BLACK, DOWN, NO_EDGE, RIGHT, WHITE};
    use masyu_kit::difficulty::{
        difficulty as ms_difficulty, puzsq_rating_hundredths as ms_rating,
        DIFFICULTY_VERSION as MS_VERSION,
    };
    use masyu_kit::puzzlink::decode_url as ms_decode_url;
    use masyu_kit::search::count_solutions_from as ms_count_from;
    use masyu_kit::solver::{
        run_all as ms_run_all, SolveOptions as MsOptions, SolveStatus as MsStatus,
    };

    let board = ms_decode_url(input)?;
    let outcome = ms_run_all(&board, MsOptions::default());
    let score = ms_difficulty(&outcome);
    let status = match outcome.status {
        MsStatus::Completed => "COMPLETED",
        MsStatus::Stopped => "STOPPED",
        MsStatus::Broken => "BROKEN",
    };

    // 手筋がすべて健全な演繹である以上、完解できたなら解は一意。
    // だから探索が要るのは手が尽きたときだけで、そこも途中盤面から始めれば速い。
    let solutions = match outcome.status {
        MsStatus::Completed => "1",
        MsStatus::Broken => "0",
        MsStatus::Stopped => {
            let found = ms_count_from(&board, outcome.answer.clone(), 2, MASYU_SEARCH_NODES);
            if found.aborted {
                "?"
            } else {
                match found.solutions.len() {
                    0 => "0",
                    1 => "1",
                    _ => "2+",
                }
            }
        }
    };

    let mut whites = Vec::new();
    let mut blacks = Vec::new();
    let mut hlines = Vec::new();
    let mut vlines = Vec::new();
    for cell in 0..board.cell_count() {
        let (x, y) = board.position(cell);
        match board.at(cell) {
            WHITE => whites.push([x as i32, y as i32]),
            BLACK => blacks.push([x as i32, y as i32]),
            _ => {}
        }
        for (dir, out) in [(RIGHT, &mut hlines), (DOWN, &mut vlines)] {
            let edge = board.incident(cell)[dir];
            if edge != NO_EDGE && outcome.answer.is_line(edge) {
                out.push([x as i32, y as i32]);
            }
        }
    }

    let out = MasyuResult {
        kind: "masyu",
        cols: board.cols as i32,
        rows: board.rows as i32,
        whites,
        blacks,
        hlines,
        vlines,
        status,
        solutions,
        dp: score,
        level: outcome.level,
        unknown: outcome.answer.unknown_count(),
        // 「一意でないと分かった」ときだけ評価を伏せる。数えきれなかった(`?`)のは
        // 複数あるという証拠ではないので、評価は出す(CLI と同じ規則)。
        rating_hundredths: (solutions != "2+" && solutions != "0").then(|| ms_rating(score)),
        difficulty_version: MS_VERSION,
    };
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// puzz.link URL(または `?` 以降のクエリ)を解いて JSON を返す。
#[wasm_bindgen]
pub fn solve_url(input: &str) -> Result<String, JsError> {
    let query = strip_query(input);
    let result = if query.starts_with("sudoku/") {
        solve_sudoku(query)
    } else if query.starts_with("yajilin/") {
        // バリアント(yajilin/b/... など)は数字でない区分が挟まる
        solve_yajilin(input)
    } else if query.starts_with("slither/") {
        solve_slitherlink(input)
    } else if query.starts_with("nurikabe/") {
        solve_nurikabe(input)
    } else if query.starts_with("akari/") {
        solve_akari(input)
    } else if ["mashu/", "masyu/", "pearl/"].iter().any(|p| query.starts_with(p)) {
        solve_masyu(input)
    } else {
        Err(format!(
            "対応していないパズルです(数独 / ヤジリン / スリザーリンク / ぬりかべ / 美術館 / ましゅ): {}",
            query.chars().take(40).collect::<String>()
        ))
    };
    result.map_err(|message| JsError::new(&message))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sudoku_roundtrip() {
        // puzsq id 12088 (★4)
        let json = solve_sudoku("sudoku/9/9/j2h3g4j1g29k45h1i8h9h76i38h9h6i1h59k73g2j8g2h1j").unwrap();
        assert!(json.contains("\"kind\":\"sudoku\""));
    }

    #[test]
    fn yajilin_parses() {
        let json = solve_yajilin("yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n").unwrap();
        assert!(json.contains("\"kind\":\"yajilin\""));
        assert!(json.contains("\"status\":\"COMPLETED\""));
    }

    #[test]
    fn slitherlink_parses() {
        // puzsq-corpus.tsv id 296 (★1)。ネイティブ CLI: DP 849 / BAND easy / COMPLETED
        let json =
            solve_slitherlink("https://puzz.link/p?slither/6/6/g1b2bhbg0d3dgch1b0c").unwrap();
        assert!(json.contains("\"kind\":\"slitherlink\""));
        assert!(json.contains("\"status\":\"COMPLETED\""));
        assert!(json.contains("\"dp\":849"));
        assert!(json.contains("\"band\":\"easy\""));
    }
}
