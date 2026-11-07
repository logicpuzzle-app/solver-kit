use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering as AtomicOrdering};
use std::sync::{Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::difficulty::{
    clue_counts, normalized_difficulty_with_exponent, stopped_adjustment,
    unknown_edge_count, MAX_TRIAL_COUNT_WEIGHT,
    STOPPED_PENALTY, STOPPED_UNKNOWN_WEIGHT, TRIAL_DEDUCTION_WEIGHT,
};
use crate::puzzlink::decode_url;
use crate::reasons::{weight, DIFFICULTY_REASONS};
use crate::solver::{run_all_with_trial_limit, SolveOptions, SolveStatus};

pub const TRIAL_DEDUCTIONS_PARAMETER: usize = DIFFICULTY_REASONS.len();
pub const MAX_TRIAL_COUNT_PARAMETER: usize = DIFFICULTY_REASONS.len() + 1;
pub const STOPPED_PENALTY_PARAMETER: usize = DIFFICULTY_REASONS.len() + 2;
pub const STOPPED_UNKNOWN_WEIGHT_PARAMETER: usize =
    DIFFICULTY_REASONS.len() + 3;
pub const PARAMETER_COUNT: usize = DIFFICULTY_REASONS.len() + 4;
pub const DEFAULT_TRIAL_CANDIDATE_LIMIT: usize = 28;
pub const DEFAULT_FOLDS: usize = 5;
// 最大59x59を含む全コーパスでは、仮置き状態を2問同時に保持すると
// 実行環境によって異常終了する。較正値は並列数に依存しないため、
// 再現性と完走を優先してメモリを使うワーカーを一つに限定する。
pub const MAX_WORKERS: usize = 1;
pub const MAX_CALIBRATION_WEIGHT: i32 = 100_000;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CorpusEntry {
    pub id: String,
    pub difficulty: i32,
    pub code: String,
}

#[derive(Clone, Debug)]
pub struct SolvedEntry {
    pub id: String,
    pub difficulty: i32,
    pub code: String,
    pub counts: Vec<i32>,
    pub trial_deductions: i32,
    pub max_trial_count: i32,
    pub stopped: bool,
    pub unknown_edges: i32,
    pub cell_count: usize,
    pub edge_count: usize,
    pub zero_clues: usize,
    pub total_clues: usize,
}

#[derive(Clone, Debug)]
pub struct FailedEntry {
    pub id: String,
    pub difficulty: i32,
    pub code: String,
    pub counts: Vec<i32>,
    pub trial_deductions: i32,
    pub max_trial_count: i32,
}

#[derive(Clone, Debug)]
pub struct CorpusResults {
    pub completed: Vec<SolvedEntry>,
    pub stopped: Vec<SolvedEntry>,
    pub broken: Vec<FailedEntry>,
    pub workers: usize,
    pub elapsed: Duration,
}

#[derive(Clone, Debug)]
pub struct OptimizationResult {
    pub parameters: Vec<i32>,
    pub correlation: f64,
    pub rounds: usize,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FoldResult {
    pub fold: usize,
    pub train_count: usize,
    pub test_count: usize,
    pub baseline_correlation: f64,
    pub calibrated_correlation: f64,
    pub uncorrected_calibrated_dpn_correlation: f64,
    pub baseline_dpn_correlation: f64,
    pub calibrated_dpn_correlation: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CrossValidationResult {
    pub folds: Vec<FoldResult>,
    pub baseline_mean: f64,
    pub calibrated_mean: f64,
    pub calibrated_stddev: f64,
    pub uncorrected_calibrated_dpn_mean: f64,
    pub baseline_dpn_mean: f64,
    pub calibrated_dpn_mean: f64,
    pub calibrated_dpn_stddev: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct ClassSummary {
    pub difficulty: i32,
    pub count: usize,
    pub completed_count: usize,
    pub q1: f64,
    pub median: f64,
    pub q3: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct BoundarySuggestion {
    pub lower_difficulty: i32,
    pub upper_difficulty: i32,
    pub threshold: i64,
    pub errors: usize,
    pub sample_count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NormalizationKind {
    PerCell,
    PerEdge,
    PowerCell(f64),
}

impl NormalizationKind {
    pub fn name(self) -> &'static str {
        match self {
            Self::PerCell => "DP_PER_CELL",
            Self::PerEdge => "DP_PER_EDGE",
            Self::PowerCell(_) => "LOG_DP_MINUS_A_LOG_CELLS",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct NormalizationAnalysis {
    pub per_cell_correlation: f64,
    pub per_edge_correlation: f64,
    pub power_exponent: f64,
    pub power_correlation: f64,
    pub selected: NormalizationKind,
    pub selected_correlation: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct SizeLayerCorrelation {
    pub cell_count: usize,
    pub count: usize,
    pub dp_correlation: f64,
    pub dpn_correlation: f64,
}

#[derive(Clone, Debug)]
pub struct StratifiedCorrelations {
    pub layers: Vec<SizeLayerCorrelation>,
    pub dp_weighted_mean: f64,
    pub dpn_weighted_mean: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct NormalizedBoundarySuggestion {
    pub lower_difficulty: i32,
    pub upper_difficulty: i32,
    pub threshold: f64,
    pub errors: usize,
    pub sample_count: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct ZeroClueStratum {
    pub label: &'static str,
    pub count: usize,
    pub mean_delta: f64,
    pub large_overestimate_count: usize,
}

pub fn parse_corpus(text: &str) -> Result<Vec<CorpusEntry>, String> {
    let mut entries = Vec::new();
    for (line_index, raw_line) in text.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<_> = line.split('\t').collect();
        if fields.len() != 3 {
            return Err(format!(
                "コーパスの {} 行目はタブ区切り3列ではありません",
                line_index + 1
            ));
        }
        let difficulty: i32 = fields[1].parse().map_err(|_| {
            format!(
                "コーパスの {} 行目の difficulty が整数ではありません",
                line_index + 1
            )
        })?;
        if !(1..=5).contains(&difficulty) {
            return Err(format!(
                "コーパスの {} 行目の difficulty は1〜5ではありません",
                line_index + 1
            ));
        }
        entries.push(CorpusEntry {
            id: fields[0].to_string(),
            difficulty,
            code: fields[2].to_string(),
        });
    }
    if entries.is_empty() {
        return Err("コーパスに問題がありません".into());
    }
    Ok(entries)
}

pub fn read_corpus(path: &str) -> Result<Vec<CorpusEntry>, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("{path}: {error}"))?;
    parse_corpus(&text)
}

enum EntryResult {
    Completed(SolvedEntry),
    Stopped(SolvedEntry),
    Broken(FailedEntry),
}

struct HeavyGate {
    active: Mutex<usize>,
    available: Condvar,
    limit: usize,
}

impl HeavyGate {
    fn enter(&self) {
        let mut active = self.active.lock().expect("大型問題ゲートをロックできる");
        while *active >= self.limit {
            active = self
                .available
                .wait(active)
                .expect("大型問題ゲートを待機できる");
        }
        *active += 1;
    }

    fn leave(&self) {
        let mut active = self.active.lock().expect("大型問題ゲートをロックできる");
        *active -= 1;
        self.available.notify_one();
    }
}

fn is_heavy(entry: &CorpusEntry) -> bool {
    let mut parts = entry.code.split('/');
    let dimensions = (
        parts.next(),
        parts.next().and_then(|value| value.parse::<usize>().ok()),
        parts.next().and_then(|value| value.parse::<usize>().ok()),
    );
    matches!(
        dimensions,
        (Some("slither"), Some(cols), Some(rows))
            if cols.checked_mul(rows).is_some_and(|cells| cells > 1_500)
    )
}

fn solve_entry(
    entry: &CorpusEntry,
    trial_candidate_limit: usize,
) -> Result<EntryResult, String> {
    let board = decode_url(&entry.code)
        .map_err(|error| format!("問題 {}: {error}", entry.id))?;
    // 巨大盤面で全辺を仮置きすると一問だけで数分かかる。候補ID順の
    // 決定的な上限を使い、時間では打ち切らないことで再現性を保つ。
    let outcome = run_all_with_trial_limit(
        &board,
        None,
        SolveOptions::default(),
        trial_candidate_limit,
    );
    let cell_count = board.clues.len();
    let edge_count = board.edge_count();
    let (zero_clues, total_clues) = clue_counts(&board.clues);
    let counts: Vec<_> = DIFFICULTY_REASONS
        .iter()
        .map(|spec| {
            outcome
                .recorder
                .counts
                .get(spec.reason)
                .copied()
                .unwrap_or(0)
        })
        .collect();
    let failed = FailedEntry {
        id: entry.id.clone(),
        difficulty: entry.difficulty,
        code: entry.code.clone(),
        counts: counts.clone(),
        trial_deductions: outcome.stats.trial_deductions,
        max_trial_count: outcome.stats.max_trial_count,
    };
    let unknown_edges = unknown_edge_count(&outcome);
    match outcome.status {
        SolveStatus::Completed => Ok(EntryResult::Completed(SolvedEntry {
            id: entry.id.clone(),
            difficulty: entry.difficulty,
            code: entry.code.clone(),
            counts,
            trial_deductions: outcome.stats.trial_deductions,
            max_trial_count: outcome.stats.max_trial_count,
            stopped: false,
            unknown_edges: 0,
            cell_count,
            edge_count,
            zero_clues,
            total_clues,
        })),
        SolveStatus::Stopped => Ok(EntryResult::Stopped(SolvedEntry {
            id: entry.id.clone(),
            difficulty: entry.difficulty,
            code: entry.code.clone(),
            counts,
            trial_deductions: outcome.stats.trial_deductions,
            max_trial_count: outcome.stats.max_trial_count,
            stopped: true,
            unknown_edges,
            cell_count,
            edge_count,
            zero_clues,
            total_clues,
        })),
        SolveStatus::Broken => Ok(EntryResult::Broken(failed)),
    }
}

pub fn solve_corpus(
    entries: &[CorpusEntry],
    threads: usize,
    trial_candidate_limit: usize,
) -> Result<CorpusResults, String> {
    if threads == 0 {
        return Err("--threads must be positive".into());
    }
    let started = Instant::now();
    let next = AtomicUsize::new(0);
    let slots: Vec<_> = (0..entries.len()).map(|_| Mutex::new(None)).collect();
    let first_error = Mutex::new(None);
    // available_parallelism が大きい環境でも、仮置きモデルの同時複製で
    // メモリを使い切らないよう実働ワーカー数には安全上限を置く。
    let worker_count = threads.min(entries.len()).min(MAX_WORKERS);
    let heavy_gate = HeavyGate {
        active: Mutex::new(0),
        available: Condvar::new(),
        // 大型盤面の仮置きは複製状態を多く使う。通常問題の並列度は
        // 落とさず、大型盤面だけ直列化してメモリ急増による異常終了を防ぐ。
        limit: 1,
    };

    thread::scope(|scope| -> Result<(), String> {
        for worker in 0..worker_count {
            // 大盤面では橋検出のDFSが深くなる。OS既定の小さなワーカー
            // スタックで有効な問題を巻き込んで異常終了しないよう余裕を持たせる。
            thread::Builder::new()
                .name(format!("calibrate-{worker}"))
                // コーパスには最大59x59があり、橋検出のDFSと仮置き状態が
                // 重なると小さいスタックではmacOS上で使い切る。最大2ワーカー
                // という上限の内側で、較正専用スレッドだけに余裕を持たせる。
                .stack_size(128 * 1024 * 1024)
                .spawn_scoped(scope, || loop {
                    let index = next.fetch_add(1, AtomicOrdering::Relaxed);
                    let Some(entry) = entries.get(index) else {
                        break;
                    };
                    let heavy = is_heavy(entry);
                    if heavy {
                        heavy_gate.enter();
                    }
                    let solved =
                        solve_entry(entry, trial_candidate_limit);
                    if heavy {
                        heavy_gate.leave();
                    }
                    match solved {
                        Ok(result) => {
                            *slots[index]
                                .lock()
                                .expect("結果スロットをロックできる") = Some(result);
                        }
                        Err(error) => {
                            let mut stored =
                                first_error.lock().expect("エラーをロックできる");
                            if stored.is_none() {
                                *stored = Some(error);
                            }
                        }
                    }
                })
                .map_err(|error| {
                    format!("較正ワーカースレッドを開始できません: {error}")
                })?;
        }
        Ok(())
    })?;

    if let Some(error) = first_error
        .into_inner()
        .expect("エラーロックを回収できる")
    {
        return Err(error);
    }

    let mut completed = Vec::new();
    let mut stopped = Vec::new();
    let mut broken = Vec::new();
    for slot in slots {
        let result = slot
            .into_inner()
            .expect("結果ロックを回収できる")
            .expect("各問題は一度だけ処理される");
        match result {
            EntryResult::Completed(entry) => completed.push(entry),
            EntryResult::Stopped(entry) => stopped.push(entry),
            EntryResult::Broken(entry) => broken.push(entry),
        }
    }
    Ok(CorpusResults {
        completed,
        stopped,
        broken,
        workers: worker_count,
        elapsed: started.elapsed(),
    })
}

pub fn current_parameters() -> Vec<i32> {
    let mut parameters: Vec<_> = DIFFICULTY_REASONS
        .iter()
        .map(|spec| weight(spec.reason))
        .collect();
    parameters.push(TRIAL_DEDUCTION_WEIGHT);
    parameters.push(MAX_TRIAL_COUNT_WEIGHT);
    // STOPPED を目的関数から落とさず、座標降下がゼロから動けるよう
    // 固定罰点と未確定辺の初期係数には小さくても正の値を置く。
    parameters.push(STOPPED_PENALTY);
    parameters.push(STOPPED_UNKNOWN_WEIGHT);
    parameters
}

pub fn score(entry: &SolvedEntry, parameters: &[i32]) -> i64 {
    debug_assert_eq!(parameters.len(), PARAMETER_COUNT);
    let technique_score: i64 = entry
        .counts
        .iter()
        .zip(parameters)
        .map(|(&count, &parameter)| i64::from(count) * i64::from(parameter))
        .sum();
    let partial_score = technique_score
        + i64::from(entry.trial_deductions)
            * i64::from(parameters[TRIAL_DEDUCTIONS_PARAMETER])
        + i64::from(entry.max_trial_count)
            * i64::from(entry.max_trial_count)
            * i64::from(parameters[MAX_TRIAL_COUNT_PARAMETER]);
    // STOPPED 項の式を実表示と共有し、較正だけが別の難易度を最適化する
    // 状態へ戻らないようにする。重み自体は探索中の候補値を渡す。
    partial_score
        + stopped_adjustment(
            entry.stopped,
            entry.unknown_edges,
            parameters[STOPPED_PENALTY_PARAMETER],
            parameters[STOPPED_UNKNOWN_WEIGHT_PARAMETER],
        )
}

fn average_ranks(values: &[f64]) -> Vec<f64> {
    let mut order: Vec<_> = values.iter().copied().enumerate().collect();
    order.sort_unstable_by(|&(left_index, left_value), &(right_index, right_value)| {
        left_value
            .total_cmp(&right_value)
            .then_with(|| left_index.cmp(&right_index))
    });
    let mut ranks = vec![0.0; values.len()];
    let mut start = 0;
    while start < order.len() {
        let mut end = start + 1;
        while end < order.len() && order[end].1 == order[start].1 {
            end += 1;
        }
        // 順位を1始まりとし、同順位には占有する順位の平均を与える。
        let rank = (start + 1 + end) as f64 / 2.0;
        for &(index, _) in &order[start..end] {
            ranks[index] = rank;
        }
        start = end;
    }
    ranks
}

fn pearson(left: &[f64], right: &[f64]) -> f64 {
    if left.len() != right.len() || left.len() < 2 {
        return 0.0;
    }
    let left_mean = left.iter().sum::<f64>() / left.len() as f64;
    let right_mean = right.iter().sum::<f64>() / right.len() as f64;
    let mut covariance = 0.0;
    let mut left_variance = 0.0;
    let mut right_variance = 0.0;
    for (&left_value, &right_value) in left.iter().zip(right) {
        let left_delta = left_value - left_mean;
        let right_delta = right_value - right_mean;
        covariance += left_delta * right_delta;
        left_variance += left_delta * left_delta;
        right_variance += right_delta * right_delta;
    }
    if left_variance == 0.0 || right_variance == 0.0 {
        0.0
    } else {
        covariance / (left_variance * right_variance).sqrt()
    }
}

pub fn spearman(entries: &[SolvedEntry], parameters: &[i32]) -> f64 {
    let scores: Vec<_> = entries
        .iter()
        .map(|entry| score(entry, parameters) as f64)
        .collect();
    let ratings: Vec<_> = entries
        .iter()
        .map(|entry| f64::from(entry.difficulty))
        .collect();
    pearson(&average_ranks(&scores), &average_ranks(&ratings))
}

fn spearman_by(
    entries: &[SolvedEntry],
    mut value: impl FnMut(&SolvedEntry) -> f64,
) -> f64 {
    let scores: Vec<_> = entries.iter().map(&mut value).collect();
    let ratings: Vec<_> = entries
        .iter()
        .map(|entry| f64::from(entry.difficulty))
        .collect();
    pearson(&average_ranks(&scores), &average_ranks(&ratings))
}

pub fn normalized_score(
    entry: &SolvedEntry,
    parameters: &[i32],
    normalization: NormalizationKind,
) -> f64 {
    normalized_score_with_zero_discount(entry, parameters, normalization, true)
}

fn normalized_score_with_zero_discount(
    entry: &SolvedEntry,
    parameters: &[i32],
    normalization: NormalizationKind,
    apply_zero_discount: bool,
) -> f64 {
    let raw = score(entry, parameters);
    let zero_factor = if apply_zero_discount {
        crate::difficulty::zero_clue_factor(
            entry.zero_clues,
            entry.total_clues,
        )
    } else {
        1.0
    };
    match normalization {
        NormalizationKind::PerCell => {
            raw as f64 / entry.cell_count as f64 * zero_factor
        }
        NormalizationKind::PerEdge => {
            raw as f64 / entry.edge_count as f64 * zero_factor
        }
        NormalizationKind::PowerCell(exponent) if apply_zero_discount => {
            normalized_difficulty_with_exponent(
                raw,
                entry.cell_count,
                exponent,
                entry.zero_clues,
                entry.total_clues,
            )
        }
        NormalizationKind::PowerCell(exponent) => {
            raw as f64 / (entry.cell_count as f64).powf(exponent)
        }
    }
}

pub fn normalized_spearman(
    entries: &[SolvedEntry],
    parameters: &[i32],
    normalization: NormalizationKind,
) -> f64 {
    spearman_by(entries, |entry| {
        normalized_score(entry, parameters, normalization)
    })
}

pub fn uncorrected_normalized_spearman(
    entries: &[SolvedEntry],
    parameters: &[i32],
    normalization: NormalizationKind,
) -> f64 {
    spearman_by(entries, |entry| {
        normalized_score_with_zero_discount(
            entry,
            parameters,
            normalization,
            false,
        )
    })
}

fn better_exponent(
    candidate: (f64, f64),
    current: (f64, f64),
) -> bool {
    candidate.1 > current.1 + 1e-12
        || ((candidate.1 - current.1).abs() <= 1e-12
            && (candidate.0 - 1.0).abs() < (current.0 - 1.0).abs())
}

pub fn best_power_exponent(
    entries: &[SolvedEntry],
    parameters: &[i32],
) -> (f64, f64) {
    // DP は概ねセル数に比例するため 1 を中心に広めの範囲を粗探索し、
    // その近傍だけを細かく探す。Spearman は階段状なので解析的な回帰より
    // 順位相関そのものを目的関数にした方が、採用基準とずれない。
    let mut best = (1.0, f64::NEG_INFINITY);
    for step in -100..=300 {
        let exponent = step as f64 / 100.0;
        let correlation = normalized_spearman(
            entries,
            parameters,
            NormalizationKind::PowerCell(exponent),
        );
        if better_exponent((exponent, correlation), best) {
            best = (exponent, correlation);
        }
    }
    let coarse = best.0;
    for step in -200..=200 {
        let exponent = coarse + step as f64 / 10_000.0;
        let correlation = normalized_spearman(
            entries,
            parameters,
            NormalizationKind::PowerCell(exponent),
        );
        if better_exponent((exponent, correlation), best) {
            best = (exponent, correlation);
        }
    }
    best
}

pub fn analyze_normalizations(
    entries: &[SolvedEntry],
    parameters: &[i32],
) -> NormalizationAnalysis {
    let per_cell_correlation = normalized_spearman(
        entries,
        parameters,
        NormalizationKind::PerCell,
    );
    let per_edge_correlation = normalized_spearman(
        entries,
        parameters,
        NormalizationKind::PerEdge,
    );
    let (power_exponent, power_correlation) =
        best_power_exponent(entries, parameters);
    let power = NormalizationKind::PowerCell(power_exponent);
    let (selected, selected_correlation) =
        if per_edge_correlation > power_correlation + 1e-12 {
            (NormalizationKind::PerEdge, per_edge_correlation)
        } else {
            (power, power_correlation)
        };
    NormalizationAnalysis {
        per_cell_correlation,
        per_edge_correlation,
        power_exponent,
        power_correlation,
        selected,
        selected_correlation,
    }
}

pub fn size_only_spearman(entries: &[SolvedEntry]) -> f64 {
    spearman_by(entries, |entry| entry.cell_count as f64)
}

pub fn stratified_correlations(
    entries: &[SolvedEntry],
    parameters: &[i32],
    normalization: NormalizationKind,
    minimum_layer_size: usize,
) -> StratifiedCorrelations {
    stratified_correlations_with_zero_discount(
        entries,
        parameters,
        normalization,
        minimum_layer_size,
        true,
    )
}

pub fn uncorrected_stratified_correlations(
    entries: &[SolvedEntry],
    parameters: &[i32],
    normalization: NormalizationKind,
    minimum_layer_size: usize,
) -> StratifiedCorrelations {
    stratified_correlations_with_zero_discount(
        entries,
        parameters,
        normalization,
        minimum_layer_size,
        false,
    )
}

fn stratified_correlations_with_zero_discount(
    entries: &[SolvedEntry],
    parameters: &[i32],
    normalization: NormalizationKind,
    minimum_layer_size: usize,
    apply_zero_discount: bool,
) -> StratifiedCorrelations {
    let mut grouped: BTreeMap<usize, Vec<SolvedEntry>> = BTreeMap::new();
    for entry in entries {
        grouped
            .entry(entry.cell_count)
            .or_default()
            .push(entry.clone());
    }
    let layers: Vec<_> = grouped
        .into_iter()
        .filter(|(_, layer)| layer.len() >= minimum_layer_size)
        .map(|(cell_count, layer)| SizeLayerCorrelation {
            cell_count,
            count: layer.len(),
            dp_correlation: spearman(&layer, parameters),
            dpn_correlation: spearman_by(&layer, |entry| {
                normalized_score_with_zero_discount(
                    entry,
                    parameters,
                    normalization,
                    apply_zero_discount,
                )
            }),
        })
        .collect();
    let total: usize = layers.iter().map(|layer| layer.count).sum();
    let weighted = |value: fn(&SizeLayerCorrelation) -> f64| {
        if total == 0 {
            0.0
        } else {
            layers
                .iter()
                .map(|layer| value(layer) * layer.count as f64)
                .sum::<f64>()
                / total as f64
        }
    };
    StratifiedCorrelations {
        dp_weighted_mean: weighted(|layer| layer.dp_correlation),
        dpn_weighted_mean: weighted(|layer| layer.dpn_correlation),
        layers,
    }
}

fn candidates(current: i32, min_weight: i32) -> Vec<i32> {
    let current = i64::from(current);
    let raw = [
        i64::from(min_weight),
        1,
        current / 4,
        current / 2,
        current * 3 / 4,
        current,
        current * 5 / 4,
        current * 3 / 2,
        current * 2,
        current * 3,
    ];
    let mut result: Vec<_> = raw
        .into_iter()
        // 下限値そのものも候補へ含め、0 と 1 の比較を同じ探索条件で
        // 行えるようにする。上限は従来の探索範囲を維持する。
        .map(|value| {
            value.clamp(
                i64::from(min_weight),
                i64::from(MAX_CALIBRATION_WEIGHT),
            ) as i32
        })
        .collect();
    result.sort_unstable();
    result.dedup();
    result
}

pub fn optimize(
    entries: &[SolvedEntry],
    rounds: usize,
    min_weight: i32,
    normalization: NormalizationKind,
) -> OptimizationResult {
    optimize_with_zero_discount(
        entries,
        rounds,
        min_weight,
        normalization,
        true,
    )
}

pub fn optimize_without_zero_discount(
    entries: &[SolvedEntry],
    rounds: usize,
    min_weight: i32,
    normalization: NormalizationKind,
) -> OptimizationResult {
    optimize_with_zero_discount(
        entries,
        rounds,
        min_weight,
        normalization,
        false,
    )
}

fn optimize_with_zero_discount(
    entries: &[SolvedEntry],
    rounds: usize,
    min_weight: i32,
    normalization: NormalizationKind,
    apply_zero_discount: bool,
) -> OptimizationResult {
    debug_assert!((0..=MAX_CALIBRATION_WEIGHT).contains(&min_weight));
    // 初期値にも下限を適用し、候補を一度も採用しないパラメータまで
    // min_weight の制約を必ず満たすようにする。
    let mut parameters = current_parameters();
    for parameter in &mut parameters {
        *parameter = (*parameter).max(min_weight);
    }
    let correlation_for = |parameters: &[i32]| {
        spearman_by(entries, |entry| {
            normalized_score_with_zero_discount(
                entry,
                parameters,
                normalization,
                apply_zero_discount,
            )
        })
    };
    let mut correlation = correlation_for(&parameters);
    let mut completed_rounds = 0;
    for _ in 0..rounds {
        let round_start = correlation;
        for parameter_index in 0..parameters.len() {
            let current = parameters[parameter_index];
            let mut best_value = current;
            let mut best_correlation = correlation;
            for candidate in candidates(current, min_weight) {
                if candidate == current {
                    continue;
                }
                parameters[parameter_index] = candidate;
                let candidate_correlation = correlation_for(&parameters);
                if candidate_correlation > best_correlation + 1e-12 {
                    best_correlation = candidate_correlation;
                    best_value = candidate;
                }
            }
            parameters[parameter_index] = best_value;
            correlation = best_correlation;
        }
        completed_rounds += 1;
        if correlation <= round_start + 1e-12 {
            break;
        }
    }
    OptimizationResult {
        parameters,
        correlation,
        rounds: completed_rounds,
    }
}

pub fn cross_validate(
    entries: &[SolvedEntry],
    fold_count: usize,
    rounds: usize,
    min_weight: i32,
    normalization: NormalizationKind,
) -> Result<CrossValidationResult, String> {
    if fold_count < 2 {
        return Err("交差検証の fold 数は2以上である必要があります".into());
    }
    if fold_count > entries.len() {
        return Err(format!(
            "交差検証の fold 数 {fold_count} が較正可能な問題数 {} を超えています",
            entries.len()
        ));
    }

    // 入力ファイルの並びや並列求解の完了順に左右されないよう、問題IDを
    // 主キーにした全順序を作り、その位置だけで fold を決める。
    let mut order: Vec<_> = (0..entries.len()).collect();
    order.sort_unstable_by(|&left, &right| {
        entries[left]
            .id
            .cmp(&entries[right].id)
            .then_with(|| entries[left].code.cmp(&entries[right].code))
            .then_with(|| {
                entries[left]
                    .difficulty
                    .cmp(&entries[right].difficulty)
            })
            .then_with(|| left.cmp(&right))
    });

    let baseline_parameters = current_parameters();
    let mut fold_results = Vec::with_capacity(fold_count);
    for fold in 0..fold_count {
        // SolvedEntry は既に求解済みの特徴量だけを持つ。ここでは再求解せず、
        // 訓練集合と検証集合へ安価に振り分けて使い回す。
        let mut train = Vec::with_capacity(
            entries.len() - entries.len() / fold_count,
        );
        let mut test = Vec::with_capacity(entries.len() / fold_count + 1);
        for (position, &entry_index) in order.iter().enumerate() {
            if position % fold_count == fold {
                test.push(entries[entry_index].clone());
            } else {
                train.push(entries[entry_index].clone());
            }
        }
        let uncorrected_optimized = optimize_without_zero_discount(
            &train,
            rounds,
            min_weight,
            normalization,
        );
        let optimized = optimize(&train, rounds, min_weight, normalization);
        fold_results.push(FoldResult {
            fold,
            train_count: train.len(),
            test_count: test.len(),
            baseline_correlation: spearman(&test, &baseline_parameters),
            calibrated_correlation: spearman(&test, &optimized.parameters),
            uncorrected_calibrated_dpn_correlation:
                uncorrected_normalized_spearman(
                    &test,
                    &uncorrected_optimized.parameters,
                    normalization,
                ),
            baseline_dpn_correlation: normalized_spearman(
                &test,
                &baseline_parameters,
                normalization,
            ),
            calibrated_dpn_correlation: normalized_spearman(
                &test,
                &optimized.parameters,
                normalization,
            ),
        });
    }

    let baseline_mean = fold_results
        .iter()
        .map(|result| result.baseline_correlation)
        .sum::<f64>()
        / fold_count as f64;
    let calibrated_mean = fold_results
        .iter()
        .map(|result| result.calibrated_correlation)
        .sum::<f64>()
        / fold_count as f64;
    // K 個すべてを対象とする要約なので標本標準偏差ではなく母標準偏差を
    // 出し、fold 数によらず「今回の検証値の散らばり」として解釈する。
    let calibrated_stddev = (fold_results
        .iter()
        .map(|result| {
            let delta = result.calibrated_correlation - calibrated_mean;
            delta * delta
        })
        .sum::<f64>()
        / fold_count as f64)
        .sqrt();
    let uncorrected_calibrated_dpn_mean = fold_results
        .iter()
        .map(|result| result.uncorrected_calibrated_dpn_correlation)
        .sum::<f64>()
        / fold_count as f64;
    let baseline_dpn_mean = fold_results
        .iter()
        .map(|result| result.baseline_dpn_correlation)
        .sum::<f64>()
        / fold_count as f64;
    let calibrated_dpn_mean = fold_results
        .iter()
        .map(|result| result.calibrated_dpn_correlation)
        .sum::<f64>()
        / fold_count as f64;
    let calibrated_dpn_stddev = (fold_results
        .iter()
        .map(|result| {
            let delta =
                result.calibrated_dpn_correlation - calibrated_dpn_mean;
            delta * delta
        })
        .sum::<f64>()
        / fold_count as f64)
        .sqrt();

    Ok(CrossValidationResult {
        folds: fold_results,
        baseline_mean,
        calibrated_mean,
        calibrated_stddev,
        uncorrected_calibrated_dpn_mean,
        baseline_dpn_mean,
        calibrated_dpn_mean,
        calibrated_dpn_stddev,
    })
}

fn percentile(sorted: &[i64], probability: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let position = probability * (sorted.len() - 1) as f64;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    let fraction = position - lower as f64;
    sorted[lower] as f64 * (1.0 - fraction)
        + sorted[upper] as f64 * fraction
}

fn percentile_f64(sorted: &[f64], probability: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let position = probability * (sorted.len() - 1) as f64;
    let lower = position.floor() as usize;
    let upper = position.ceil() as usize;
    let fraction = position - lower as f64;
    sorted[lower] * (1.0 - fraction) + sorted[upper] * fraction
}

pub fn class_summaries(
    entries: &[SolvedEntry],
    parameters: &[i32],
) -> Vec<ClassSummary> {
    (1..=5)
        .map(|difficulty| {
            let mut scores: Vec<_> = entries
                .iter()
                .filter(|entry| entry.difficulty == difficulty)
                .map(|entry| score(entry, parameters))
                .collect();
            scores.sort_unstable();
            let completed_count = entries
                .iter()
                .filter(|entry| {
                    entry.difficulty == difficulty && !entry.stopped
                })
                .count();
            ClassSummary {
                difficulty,
                count: scores.len(),
                completed_count,
                q1: percentile(&scores, 0.25),
                median: percentile(&scores, 0.5),
                q3: percentile(&scores, 0.75),
            }
        })
        .collect()
}

pub fn normalized_class_summaries(
    entries: &[SolvedEntry],
    parameters: &[i32],
    normalization: NormalizationKind,
) -> Vec<ClassSummary> {
    normalized_class_summaries_with_zero_discount(
        entries,
        parameters,
        normalization,
        true,
    )
}

fn normalized_class_summaries_with_zero_discount(
    entries: &[SolvedEntry],
    parameters: &[i32],
    normalization: NormalizationKind,
    apply_zero_discount: bool,
) -> Vec<ClassSummary> {
    (1..=5)
        .map(|difficulty| {
            let mut scores: Vec<_> = entries
                .iter()
                .filter(|entry| entry.difficulty == difficulty)
                .map(|entry| {
                    normalized_score_with_zero_discount(
                        entry,
                        parameters,
                        normalization,
                        apply_zero_discount,
                    )
                })
                .collect();
            scores.sort_unstable_by(f64::total_cmp);
            let completed_count = entries
                .iter()
                .filter(|entry| {
                    entry.difficulty == difficulty && !entry.stopped
                })
                .count();
            ClassSummary {
                difficulty,
                count: scores.len(),
                completed_count,
                q1: percentile_f64(&scores, 0.25),
                median: percentile_f64(&scores, 0.5),
                q3: percentile_f64(&scores, 0.75),
            }
        })
        .collect()
}

fn threshold_errors(
    entries: &[SolvedEntry],
    parameters: &[i32],
    lower: i32,
    upper: i32,
    threshold: i64,
) -> (usize, usize) {
    let lower_errors = entries
        .iter()
        .filter(|entry| {
            entry.difficulty == lower
                && score(entry, parameters) >= threshold
        })
        .count();
    let upper_errors = entries
        .iter()
        .filter(|entry| {
            entry.difficulty == upper
                && score(entry, parameters) < threshold
        })
        .count();
    (lower_errors, upper_errors)
}

pub fn boundary_suggestions(
    entries: &[SolvedEntry],
    parameters: &[i32],
) -> Vec<BoundarySuggestion> {
    let summaries = class_summaries(entries, parameters);
    (1..5)
        .filter_map(|lower| {
            let upper = lower + 1;
            let relevant: Vec<_> = entries
                .iter()
                .filter(|entry| {
                    entry.difficulty == lower || entry.difficulty == upper
                })
                .collect();
            if summaries[lower as usize - 1].count == 0
                || summaries[upper as usize - 1].count == 0
            {
                return None;
            }
            let mut candidates = Vec::with_capacity(relevant.len() + 1);
            for entry in &relevant {
                let value = score(entry, parameters);
                candidates.push(value);
                candidates.push(value.saturating_add(1));
            }
            candidates.sort_unstable();
            candidates.dedup();
            let midpoint =
                (summaries[lower as usize - 1].median
                    + summaries[upper as usize - 1].median)
                    / 2.0;
            let lower_count = summaries[lower as usize - 1].count;
            let upper_count = summaries[upper as usize - 1].count;
            let mut best: Option<(f64, f64, i64, usize)> = None;
            for threshold in candidates {
                let (lower_errors, upper_errors) = threshold_errors(
                    entries,
                    parameters,
                    lower,
                    upper,
                    threshold,
                );
                // 投稿数の多いクラスへ閾値が寄らないよう、両クラスの
                // 誤分類率を同じ重さで評価して分布の交差点を近似する。
                let balanced_errors =
                    lower_errors as f64 / lower_count as f64
                        + upper_errors as f64 / upper_count as f64;
                let distance = (threshold as f64 - midpoint).abs();
                let candidate = (
                    balanced_errors,
                    distance,
                    threshold,
                    lower_errors + upper_errors,
                );
                if best.as_ref().is_none_or(|current| {
                    candidate.0.total_cmp(&current.0) == Ordering::Less
                        || (candidate.0.total_cmp(&current.0) == Ordering::Equal
                            && candidate.1.total_cmp(&current.1)
                                == Ordering::Less)
                        || (candidate.0.total_cmp(&current.0) == Ordering::Equal
                            && candidate.1.total_cmp(&current.1)
                                == Ordering::Equal
                            && candidate.2 < current.2)
                }) {
                    best = Some(candidate);
                }
            }
            let (_, _, threshold, errors) =
                best.expect("各隣接クラスに問題が一つ以上ある");
            Some(BoundarySuggestion {
                lower_difficulty: lower,
                upper_difficulty: upper,
                threshold,
                errors,
                sample_count: relevant.len(),
            })
        })
        .collect()
}

fn normalized_threshold_errors(
    entries: &[SolvedEntry],
    parameters: &[i32],
    normalization: NormalizationKind,
    lower: i32,
    upper: i32,
    threshold: f64,
    apply_zero_discount: bool,
) -> (usize, usize) {
    let lower_errors = entries
        .iter()
        .filter(|entry| {
            entry.difficulty == lower
                && normalized_score_with_zero_discount(
                    entry,
                    parameters,
                    normalization,
                    apply_zero_discount,
                ) >= threshold
        })
        .count();
    let upper_errors = entries
        .iter()
        .filter(|entry| {
            entry.difficulty == upper
                && normalized_score_with_zero_discount(
                    entry,
                    parameters,
                    normalization,
                    apply_zero_discount,
                ) < threshold
        })
        .count();
    (lower_errors, upper_errors)
}

fn next_larger(value: f64) -> f64 {
    debug_assert!(value >= 0.0 && value.is_finite());
    if value == 0.0 {
        f64::from_bits(1)
    } else {
        f64::from_bits(value.to_bits() + 1)
    }
}

pub fn normalized_boundary_suggestions(
    entries: &[SolvedEntry],
    parameters: &[i32],
    normalization: NormalizationKind,
) -> Vec<NormalizedBoundarySuggestion> {
    normalized_boundary_suggestions_with_zero_discount(
        entries,
        parameters,
        normalization,
        true,
    )
}

fn normalized_boundary_suggestions_with_zero_discount(
    entries: &[SolvedEntry],
    parameters: &[i32],
    normalization: NormalizationKind,
    apply_zero_discount: bool,
) -> Vec<NormalizedBoundarySuggestion> {
    let summaries = normalized_class_summaries_with_zero_discount(
        entries,
        parameters,
        normalization,
        apply_zero_discount,
    );
    (1..5)
        .filter_map(|lower| {
            let upper = lower + 1;
            let relevant: Vec<_> = entries
                .iter()
                .filter(|entry| {
                    entry.difficulty == lower || entry.difficulty == upper
                })
                .collect();
            if summaries[lower as usize - 1].count == 0
                || summaries[upper as usize - 1].count == 0
            {
                return None;
            }
            let mut candidates = Vec::with_capacity(relevant.len() * 2);
            for entry in &relevant {
                let value =
                    normalized_score_with_zero_discount(
                        entry,
                        parameters,
                        normalization,
                        apply_zero_discount,
                    );
                candidates.push(value);
                // 同点を境界の上下どちらへ置く場合も比較するため、直後の
                // 表現可能値を候補にする。固定小数の丸め幅には依存しない。
                candidates.push(next_larger(value));
            }
            candidates.sort_unstable_by(f64::total_cmp);
            candidates.dedup_by(|left, right| {
                left.total_cmp(right) == Ordering::Equal
            });
            let midpoint =
                (summaries[lower as usize - 1].median
                    + summaries[upper as usize - 1].median)
                    / 2.0;
            let lower_count = summaries[lower as usize - 1].count;
            let upper_count = summaries[upper as usize - 1].count;
            let mut best: Option<(f64, f64, f64, usize)> = None;
            for threshold in candidates {
                let (lower_errors, upper_errors) =
                    normalized_threshold_errors(
                        entries,
                        parameters,
                        normalization,
                        lower,
                        upper,
                        threshold,
                        apply_zero_discount,
                    );
                let balanced_errors =
                    lower_errors as f64 / lower_count as f64
                        + upper_errors as f64 / upper_count as f64;
                let distance = (threshold - midpoint).abs();
                let candidate = (
                    balanced_errors,
                    distance,
                    threshold,
                    lower_errors + upper_errors,
                );
                if best.as_ref().is_none_or(|current| {
                    candidate.0.total_cmp(&current.0) == Ordering::Less
                        || (candidate.0.total_cmp(&current.0)
                            == Ordering::Equal
                            && candidate.1.total_cmp(&current.1)
                                == Ordering::Less)
                        || (candidate.0.total_cmp(&current.0)
                            == Ordering::Equal
                            && candidate.1.total_cmp(&current.1)
                                == Ordering::Equal
                            && candidate.2 < current.2)
                }) {
                    best = Some(candidate);
                }
            }
            let (_, _, threshold, errors) =
                best.expect("各隣接クラスに問題が一つ以上ある");
            Some(NormalizedBoundarySuggestion {
                lower_difficulty: lower,
                upper_difficulty: upper,
                threshold,
                errors,
                sample_count: relevant.len(),
            })
        })
        .collect()
}

pub fn zero_clue_strata(
    entries: &[SolvedEntry],
    parameters: &[i32],
    normalization: NormalizationKind,
    apply_zero_discount: bool,
) -> Vec<ZeroClueStratum> {
    let boundaries = normalized_boundary_suggestions_with_zero_discount(
        entries,
        parameters,
        normalization,
        apply_zero_discount,
    );
    let groups = [
        ("0-5%", 0.0, 0.05),
        ("5-10%", 0.05, 0.10),
        ("10-15%", 0.10, 0.15),
        ("15-20%", 0.15, 0.20),
        ("20-30%", 0.20, 0.30),
        ("30%以上", 0.30, f64::INFINITY),
    ];
    groups
        .into_iter()
        .map(|(label, lower, upper)| {
            let grouped: Vec<_> = entries
                .iter()
                .filter(|entry| {
                    let ratio = if entry.total_clues == 0 {
                        0.0
                    } else {
                        entry.zero_clues as f64 / entry.total_clues as f64
                    };
                    ratio >= lower && ratio < upper
                })
                .collect();
            let mut delta_sum = 0_i64;
            let mut large_overestimate_count = 0;
            for entry in &grouped {
                let entry_score = normalized_score_with_zero_discount(
                    entry,
                    parameters,
                    normalization,
                    apply_zero_discount,
                );
                let predicted = 1
                    + boundaries
                        .iter()
                        .filter(|boundary| entry_score >= boundary.threshold)
                        .count() as i32;
                let delta = predicted - entry.difficulty;
                delta_sum += i64::from(delta);
                if delta >= 2 {
                    large_overestimate_count += 1;
                }
            }
            ZeroClueStratum {
                label,
                count: grouped.len(),
                mean_delta: if grouped.is_empty() {
                    0.0
                } else {
                    delta_sum as f64 / grouped.len() as f64
                },
                large_overestimate_count,
            }
        })
        .collect()
}

pub fn format_match_arms(parameters: &[i32]) -> String {
    let mut output = String::new();
    for (spec, &parameter) in DIFFICULTY_REASONS.iter().zip(parameters) {
        output.push_str(&format!("        {} => {},\n", spec.constant, parameter));
    }
    output.push_str("        TRIAL_CONTRADICTION | TRIAL_ANY_CASE => 0,\n");
    output.push_str("        _ => 1,\n");
    output.push_str(&format!(
        "\n// trial_deductions の係数: {}\n",
        parameters[TRIAL_DEDUCTIONS_PARAMETER]
    ));
    output.push_str(&format!(
        "// max_trial_count² の係数: {}\n",
        parameters[MAX_TRIAL_COUNT_PARAMETER]
    ));
    output.push_str(&format!(
        "// STOPPED 固定罰点: {}\n",
        parameters[STOPPED_PENALTY_PARAMETER]
    ));
    output.push_str(&format!(
        "// STOPPED 未確定辺の係数: {}\n",
        parameters[STOPPED_UNKNOWN_WEIGHT_PARAMETER]
    ));
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(difficulty: i32, value: i32) -> SolvedEntry {
        let mut counts = vec![0; DIFFICULTY_REASONS.len()];
        counts[0] = value;
        SolvedEntry {
            id: value.to_string(),
            difficulty,
            code: String::new(),
            counts,
            trial_deductions: 0,
            max_trial_count: 0,
            stopped: false,
            unknown_edges: 0,
            cell_count: 100,
            edge_count: 220,
            zero_clues: 0,
            total_clues: 10,
        }
    }

    #[test]
    fn corpus_parser_skips_comments_and_checks_ratings() {
        let parsed = parse_corpus(
            "# comment\n1\t2\tslither/1/1/0\n\n2\t5\tslither/1/1/1\n",
        )
        .expect("正しいコーパスを読める");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].difficulty, 2);
        assert!(parse_corpus("1\t6\tslither/1/1/0\n").is_err());
    }

    #[test]
    fn spearman_uses_average_ranks_for_ties() {
        let entries = vec![entry(1, 1), entry(1, 1), entry(2, 2), entry(3, 3)];
        let mut parameters = vec![0; PARAMETER_COUNT];
        parameters[0] = 1;
        assert!((spearman(&entries, &parameters) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn quartiles_are_linearly_interpolated() {
        let entries = vec![
            entry(1, 0),
            entry(1, 10),
            entry(1, 20),
            entry(1, 30),
        ];
        let mut parameters = vec![0; PARAMETER_COUNT];
        parameters[0] = 1;
        let summary = class_summaries(&entries, &parameters)[0];
        assert_eq!(summary.q1, 7.5);
        assert_eq!(summary.median, 15.0);
        assert_eq!(summary.q3, 22.5);
    }

    #[test]
    fn stopped_score_adds_penalty_and_unknown_edges() {
        let mut stopped = entry(5, 7);
        stopped.stopped = true;
        stopped.unknown_edges = 13;
        let mut parameters = vec![0; PARAMETER_COUNT];
        parameters[0] = 2;
        parameters[STOPPED_PENALTY_PARAMETER] = 100;
        parameters[STOPPED_UNKNOWN_WEIGHT_PARAMETER] = 3;
        assert_eq!(score(&stopped, &parameters), 7 * 2 + 100 + 13 * 3);
    }

    #[test]
    fn class_summary_counts_completed_and_stopped_separately() {
        let completed = entry(4, 1);
        let mut stopped = entry(4, 2);
        stopped.stopped = true;
        stopped.unknown_edges = 10;
        let parameters = vec![0; PARAMETER_COUNT];
        let summary = class_summaries(&[completed, stopped], &parameters)[3];
        assert_eq!(summary.count, 2);
        assert_eq!(summary.completed_count, 1);
    }

    #[test]
    fn candidates_respect_minimum_weight() {
        assert!(candidates(0, 1).iter().all(|&candidate| candidate >= 1));
        assert!(candidates(8, 1).contains(&1));
        assert!(candidates(8, 0).contains(&0));
    }

    #[test]
    fn optimization_applies_minimum_to_every_parameter() {
        let entries = vec![entry(1, 1), entry(2, 2), entry(3, 3)];
        let optimized = optimize(
            &entries,
            1,
            1,
            NormalizationKind::PowerCell(
                crate::difficulty::DPN_SIZE_EXPONENT,
            ),
        );
        assert!(
            optimized.parameters.iter().all(|&parameter| parameter >= 1)
        );
    }

    #[test]
    fn cross_validation_is_deterministic_and_balanced() {
        let mut entries = vec![
            entry(3, 3),
            entry(1, 1),
            entry(5, 5),
            entry(2, 2),
            entry(4, 4),
        ];
        entries[0].id = "c".into();
        entries[1].id = "a".into();
        entries[2].id = "e".into();
        entries[3].id = "b".into();
        entries[4].id = "d".into();

        let first = cross_validate(
            &entries,
            2,
            2,
            0,
            NormalizationKind::PerCell,
        )
            .expect("交差検証を実行できる");
        let second = cross_validate(
            &entries,
            2,
            2,
            0,
            NormalizationKind::PerCell,
        )
            .expect("同じ交差検証を再実行できる");
        assert_eq!(first, second);
        assert_eq!(first.folds[0].test_count, 3);
        assert_eq!(first.folds[1].test_count, 2);
        assert_eq!(first.folds[0].train_count, 2);
        assert_eq!(first.folds[1].train_count, 3);
    }

    #[test]
    fn size_only_correlation_uses_cell_count_ranks() {
        let mut entries = vec![entry(1, 1), entry(2, 2), entry(3, 3)];
        entries[0].cell_count = 25;
        entries[1].cell_count = 100;
        entries[2].cell_count = 225;
        assert!((size_only_spearman(&entries) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn per_cell_normalization_removes_proportional_growth() {
        let mut entries = vec![entry(1, 25), entry(2, 100)];
        entries[0].cell_count = 25;
        entries[1].cell_count = 100;
        let mut parameters = vec![0; PARAMETER_COUNT];
        parameters[0] = 1;
        assert_eq!(
            normalized_score(
                &entries[0],
                &parameters,
                NormalizationKind::PerCell
            ),
            normalized_score(
                &entries[1],
                &parameters,
                NormalizationKind::PerCell
            )
        );
    }

    #[test]
    fn normalization_applies_zero_clue_discount() {
        let without_zeroes = entry(1, 100);
        let mut with_zeroes = entry(1, 100);
        with_zeroes.zero_clues = 5;
        let mut parameters = vec![0; PARAMETER_COUNT];
        parameters[0] = 1;
        let plain = normalized_score(
            &without_zeroes,
            &parameters,
            NormalizationKind::PowerCell(
                crate::difficulty::DPN_SIZE_EXPONENT,
            ),
        );
        let discounted = normalized_score(
            &with_zeroes,
            &parameters,
            NormalizationKind::PowerCell(
                crate::difficulty::DPN_SIZE_EXPONENT,
            ),
        );
        assert!(
            (discounted / plain
                - crate::difficulty::zero_clue_factor(5, 10))
            .abs()
                < 1e-12
        );
    }
}
