use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::process::ExitCode;
use std::time::Instant;

use slitherlink_kit::board::Board;
use slitherlink_kit::calibrate::{
    analyze_normalizations, boundary_suggestions, class_summaries,
    current_parameters, cross_validate, format_match_arms,
    normalized_boundary_suggestions, normalized_class_summaries,
    normalized_score, normalized_spearman, optimize,
    optimize_without_zero_discount, read_corpus,
    size_only_spearman, solve_corpus, spearman, stratified_correlations,
    uncorrected_normalized_spearman,
    uncorrected_stratified_correlations, zero_clue_strata,
    NormalizationKind, DEFAULT_FOLDS,
    DEFAULT_TRIAL_CANDIDATE_LIMIT, MAX_CALIBRATION_WEIGHT,
    MAX_TRIAL_COUNT_PARAMETER, STOPPED_PENALTY_PARAMETER,
    STOPPED_UNKNOWN_WEIGHT_PARAMETER, TRIAL_DEDUCTIONS_PARAMETER,
};
use slitherlink_kit::difficulty::{
    band, clue_counts, difficulty, format_breakdown, is_band_name,
    normalized_difficulty, BAND_THRESHOLDS, DPN_SIZE_EXPONENT,
    MAX_TRIAL_COUNT_WEIGHT, STOPPED_PENALTY, STOPPED_UNKNOWN_WEIGHT,
    TRIAL_DEDUCTION_WEIGHT, ZERO_CLUE_DISCOUNT,
};
use slitherlink_kit::format::{
    format_board, format_problem_text, parse_problem_text,
};
use slitherlink_kit::generator::{
    generate_loop_checked, generate_loop_report_checked,
    generate_pattern_report_checked, GenerateOptions, Generated, Symmetry,
};
use slitherlink_kit::puzzlink::{decode_url, encode_code, encode_url};
use slitherlink_kit::random::Rng;
use slitherlink_kit::reasons::{weight, DIFFICULTY_REASONS};
use slitherlink_kit::search::count_solutions;
use slitherlink_kit::solution::{describe_validation_error, validate_solution};
use slitherlink_kit::solver::{run_all, SolveOptions, SolveStatus};

const USAGE: &str = r#"usage: slither <command> [options]

commands:
  solve <problem> [--no-trial] [--no-local-pattern] [--breakdown]
                                             solve and rate a puzzle
  bands                                      show difficulty bands and parameters
  count <problem> [--limit N]             count solutions (default limit 2)
  calibrate <corpus.tsv> [options]        calibrate difficulty weights
  generate-loop [options]                 generate by drawing the loop first
  generate-pattern [options]              generate with a clue pattern
  bench [options]                         time generation, solving, and counting
  bench-solve <file> [options]            time no-trial solving in one process

<problem> is a file path, a puzz.link URL, or a bare "slither/W/H/body" code.

options:
  --seed N            RNG seed (default 0)
  --size WxH          board size (default 10x10)
  --attempts N        retry limit, 0 = unlimited (default 100)
  --dp-min N          reject puzzles below this difficulty
  --dp-max N          reject puzzles above this difficulty
  --dpn-min N         reject puzzles below this normalized difficulty
  --dpn-max N         reject puzzles above this normalized difficulty
  --band NAME         intro|easy|medium|hard|expert|fiendish
  --max-nodes N       search node cap, 0 = unlimited (default 200000)
  --symmetry S        none|rot2|rot4|mirror-h|mirror-v
                      (generate-loop default none; generate-pattern default rot2)
  --pattern FILE      explicit allowed-clue pattern
  --no-reduce         do not remove clues
  --exact-reduce      use exhaustive uniqueness checks while removing clues
  --refine N          hill-climb N rounds (default 0)
  --no-trial          solve without contradiction lookahead
  --no-local-pattern  disable the embedded 3x3 pattern table
  --format F          url|code|text|grid (default grid)
  --out FILE          write output to a file
  --limit N           solution limit for count (default 2)
  --count N           bench iterations (default 10)
  --threads N         calibrate workers (default available parallelism)
  --rounds N          coordinate-descent rounds (default 20)
  --trial-limit N     trial candidates per pass for calibrate (default 28; 0 = unlimited)
  --folds K           cross-validation folds (default 5; 0 or 1 = disabled)
  --min-weight N      lower bound of calibrated weights (default 0)
  --breakdown         show the DP components for solve
"#;

#[derive(Default)]
struct Options {
    positional: Vec<String>,
    flags: HashSet<String>,
    values: HashMap<String, String>,
}

fn parse_args(args: &[String]) -> Result<Options, String> {
    let valued: HashSet<&str> = [
        "--seed",
        "--size",
        "--attempts",
        "--dp-min",
        "--dp-max",
        "--dpn-min",
        "--dpn-max",
        "--band",
        "--max-nodes",
        "--symmetry",
        "--pattern",
        "--refine",
        "--format",
        "--out",
        "--limit",
        "--count",
        "--threads",
        "--rounds",
        "--trial-limit",
        "--folds",
        "--min-weight",
    ]
    .into_iter()
    .collect();
    let mut result = Options::default();
    let mut index = 0;
    while index < args.len() {
        let argument = &args[index];
        if valued.contains(argument.as_str()) {
            index += 1;
            let value = args
                .get(index)
                .ok_or_else(|| format!("{argument} requires a value"))?;
            result.values.insert(argument.clone(), value.clone());
        } else if argument.starts_with("--") {
            result.flags.insert(argument.clone());
        } else {
            result.positional.push(argument.clone());
        }
        index += 1;
    }
    Ok(result)
}

fn int_option(options: &Options, name: &str, fallback: i32) -> Result<i32, String> {
    options
        .values
        .get(name)
        .map(|raw| {
            raw.parse()
                .map_err(|_| format!("{name} must be an integer"))
        })
        .unwrap_or(Ok(fallback))
}

fn usize_option(
    options: &Options,
    name: &str,
    fallback: usize,
) -> Result<usize, String> {
    options
        .values
        .get(name)
        .map(|raw| {
            raw.parse()
                .map_err(|_| format!("{name} must be a positive integer"))
        })
        .unwrap_or(Ok(fallback))
}

fn float_option(
    options: &Options,
    name: &str,
    fallback: f64,
) -> Result<f64, String> {
    options
        .values
        .get(name)
        .map(|raw| {
            let value: f64 = raw
                .parse()
                .map_err(|_| format!("{name} must be a number"))?;
            if value.is_finite() {
                Ok(value)
            } else {
                Err(format!("{name} must be finite"))
            }
        })
        .unwrap_or(Ok(fallback))
}

fn emit(options: &Options, text: &str) -> Result<(), String> {
    if let Some(path) = options.values.get("--out") {
        fs::write(path, text).map_err(|error| error.to_string())
    } else {
        print!("{text}");
        Ok(())
    }
}

fn read_problem(source: &str) -> Result<Board, String> {
    let text = fs::read_to_string(source).unwrap_or_else(|_| source.to_string());
    let trimmed = text.trim();
    if trimmed.contains("slither/") {
        decode_url(trimmed)
    } else {
        parse_problem_text(trimmed)
    }
}

fn read_pattern(source: &str, cols: i32, rows: i32) -> Result<Vec<bool>, String> {
    let text = fs::read_to_string(source).map_err(|error| error.to_string())?;
    let lines: Vec<_> = text
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !(line.starts_with('#')
                    && (line.len() == 1
                        || line.as_bytes().get(1) == Some(&b' ')))
        })
        .collect();
    if lines.len() != rows as usize {
        return Err(format!(
            "pattern must have {rows} rows, found {}",
            lines.len()
        ));
    }
    let mut pattern = vec![false; (cols * rows) as usize];
    for (y, line) in lines.iter().enumerate() {
        let split: Vec<_> = line.split_whitespace().collect();
        let cells: Vec<String> = if split.len() == cols as usize {
            split.into_iter().map(str::to_string).collect()
        } else {
            line.chars().map(|character| character.to_string()).collect()
        };
        if cells.len() != cols as usize {
            return Err(format!(
                "pattern row {} must have {cols} cells",
                y + 1
            ));
        }
        for (x, token) in cells.iter().enumerate() {
            pattern[y * cols as usize + x] = token != "." && token != "0";
        }
    }
    Ok(pattern)
}

fn parse_size(options: &Options) -> Result<(i32, i32), String> {
    let raw = options
        .values
        .get("--size")
        .map(String::as_str)
        .unwrap_or("10x10");
    let Some((raw_cols, raw_rows)) = raw.split_once('x') else {
        return Err("--size must look like 10x10".into());
    };
    let cols: i32 = raw_cols
        .parse()
        .map_err(|_| "--size must look like 10x10".to_string())?;
    let rows: i32 = raw_rows
        .parse()
        .map_err(|_| "--size must look like 10x10".to_string())?;
    if cols <= 0 || rows <= 0 {
        return Err("--size dimensions must be positive".into());
    }
    if cols
        .checked_mul(rows)
        .is_none_or(|cells| cells < 2)
    {
        return Err("--size must contain at least two cells".into());
    }
    Ok((cols, rows))
}

fn generate_options(
    options: &Options,
    pattern_mode: bool,
) -> Result<GenerateOptions, String> {
    let (cols, rows) = parse_size(options)?;
    let attempts = int_option(options, "--attempts", 100)?;
    let max_nodes = int_option(options, "--max-nodes", 200_000)?;
    let refine = int_option(options, "--refine", 0)?;
    if attempts < 0 {
        return Err("--attempts must not be negative".into());
    }
    if max_nodes < 0 {
        return Err("--max-nodes must not be negative".into());
    }
    if refine < 0 {
        return Err("--refine must not be negative".into());
    }
    let symmetry = match options
        .values
        .get("--symmetry")
        .map(String::as_str)
        .unwrap_or(if pattern_mode { "rot2" } else { "none" })
    {
        "none" => Symmetry::None,
        "rot2" => Symmetry::Rot2,
        "rot4" => Symmetry::Rot4,
        "mirror-h" => Symmetry::MirrorH,
        "mirror-v" => Symmetry::MirrorV,
        other => return Err(format!("unknown symmetry: {other}")),
    };
    if symmetry == Symmetry::Rot4
        && cols != rows
        && (!pattern_mode || !options.values.contains_key("--pattern"))
    {
        return Err("--symmetry rot4 requires a square board".into());
    }
    let dp_min = options
        .values
        .contains_key("--dp-min")
        .then(|| int_option(options, "--dp-min", 0))
        .transpose()?;
    let dp_max = options
        .values
        .contains_key("--dp-max")
        .then(|| int_option(options, "--dp-max", 0))
        .transpose()?;
    if dp_min.zip(dp_max).is_some_and(|(min, max)| min > max) {
        return Err("--dp-min must not exceed --dp-max".into());
    }
    let dpn_min = options
        .values
        .contains_key("--dpn-min")
        .then(|| float_option(options, "--dpn-min", 0.0))
        .transpose()?;
    let dpn_max = options
        .values
        .contains_key("--dpn-max")
        .then(|| float_option(options, "--dpn-max", 0.0))
        .transpose()?;
    if dpn_min.is_some_and(|value| value < 0.0)
        || dpn_max.is_some_and(|value| value < 0.0)
    {
        return Err("--dpn-min and --dpn-max must not be negative".into());
    }
    if dpn_min
        .zip(dpn_max)
        .is_some_and(|(min, max)| min > max)
    {
        return Err("--dpn-min must not exceed --dpn-max".into());
    }
    let requested_band = options.values.get("--band").cloned();
    if let Some(name) = &requested_band {
        if !is_band_name(name) {
            return Err(format!("unknown band: {name}"));
        }
    }
    let exact_reduce = options.flags.contains("--exact-reduce")
        || requested_band
            .as_deref()
            .is_some_and(|name| matches!(name, "hard" | "expert" | "fiendish"));
    let pattern = options
        .values
        .get("--pattern")
        .map(|path| read_pattern(path, cols, rows))
        .transpose()?;
    Ok(GenerateOptions {
        cols,
        rows,
        attempts,
        max_nodes,
        dp_min,
        dp_max,
        dpn_min,
        dpn_max,
        band: requested_band,
        symmetry,
        pattern,
        reduce: !options.flags.contains("--no-reduce"),
        exact_reduce,
        refine,
        no_local_pattern: options.flags.contains("--no-local-pattern"),
    })
}

/// 手詰まりで終わった問題の一意性。打ち切られた場合を Multiple と区別するために持つ
/// （判定できなかっただけで、複数解とは限らない）。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Uniqueness {
    Unique,
    Multiple,
    Unknown,
}

fn status_name(status: SolveStatus) -> &'static str {
    match status {
        SolveStatus::Completed => "COMPLETED",
        SolveStatus::Stopped => "STOPPED",
        SolveStatus::Broken => "BROKEN",
    }
}

fn bands_command(options: &Options) -> Result<i32, String> {
    let mut text = String::new();
    let mut lower_bound = 0.0;
    for &(upper_bound, name) in &BAND_THRESHOLDS {
        text.push_str(&format!(
            "BAND\t{name}\t{lower_bound}\t{upper_bound}\n"
        ));
        lower_bound = upper_bound;
    }
    text.push_str(&format!(
        "PARAM\tdpn_size_exponent\t{DPN_SIZE_EXPONENT}\n\
         PARAM\tzero_clue_discount\t{ZERO_CLUE_DISCOUNT:.2}\n\
         PARAM\ttrial_deduction_weight\t{TRIAL_DEDUCTION_WEIGHT}\n\
         PARAM\tmax_trial_count_weight\t{MAX_TRIAL_COUNT_WEIGHT}\n\
         PARAM\tstopped_penalty\t{STOPPED_PENALTY}\n\
         PARAM\tstopped_unknown_weight\t{STOPPED_UNKNOWN_WEIGHT}\n"
    ));
    for spec in &DIFFICULTY_REASONS {
        text.push_str(&format!(
            "WEIGHT\t{}\t{}\n",
            spec.reason,
            weight(spec.reason)
        ));
    }
    emit(options, &text)?;
    Ok(0)
}

fn solve_command(options: &Options) -> Result<i32, String> {
    let source = options
        .positional
        .first()
        .ok_or_else(|| "solve needs a problem".to_string())?;
    let board = read_problem(source)?;
    let outcome = run_all(
        &board,
        None,
        SolveOptions {
            no_trial: options.flags.contains("--no-trial"),
            max_passes: 0,
            no_local_pattern: options.flags.contains("--no-local-pattern"),
        },
    );
    let score = difficulty(&outcome);
    let (zero_clues, total_clues) = clue_counts(&board.clues);
    let normalized_score = normalized_difficulty(
        i64::from(score),
        board.clues.len(),
        zero_clues,
        total_clues,
    );
    let errors = if outcome.status == SolveStatus::Completed {
        validate_solution(&board, outcome.answer.edges())
    } else {
        Vec::new()
    };

    // 一意でない問題に難易度をつけても意味がない。手筋ソルバーは必ず手詰まりになり、
    // 手詰まりへの罰点で「難しい問題」として高いスコアが出てしまうためである
    // （実例: #19749 は解が4つあるのに DPN 517 = medium と出ていた。申告は ★1）。
    //
    // 完解した場合は確認しない。手筋の推論はすべて健全なので、完解＝一意性が証明済みであり、
    // ここで探索を走らせるのは純粋な無駄になる。手詰まりのときだけ調べる。
    let uniqueness = if outcome.status == SolveStatus::Stopped {
        let counted = count_solutions(&board, 2, int_option(options, "--max-nodes", 200_000)?);
        if counted.aborted {
            Uniqueness::Unknown
        } else if counted.solutions.len() >= 2 {
            Uniqueness::Multiple
        } else {
            Uniqueness::Unique
        }
    } else {
        Uniqueness::Unique
    };

    let mut text = if uniqueness == Uniqueness::Multiple {
        // 難易度の代わりに - を出す。値を出すと誤って使われるので、あえて空欄にする。
        format!(
            "STATUS {}\nDP -\nDPN -\nBAND -\nSOLUTIONS 2+\nPASSES {}\nTRIAL {} {}\n",
            status_name(outcome.status),
            outcome.stats.passes,
            outcome.stats.trial_deductions,
            outcome.stats.max_trial_count
        )
    } else {
        let mut t = format!(
            "STATUS {}\nDP {score}\nDPN {normalized_score:.6}\nBAND {}\nPASSES {}\nTRIAL {} {}\n",
            status_name(outcome.status),
            band(normalized_score),
            outcome.stats.passes,
            outcome.stats.trial_deductions,
            outcome.stats.max_trial_count
        );
        // 打ち切られた場合は「複数解ではない」と断定できない。分からないことは分からないと示す。
        if uniqueness == Uniqueness::Unknown {
            t.push_str("UNIQUE unknown\n");
        }
        t
    };
    if options.flags.contains("--breakdown") {
        text.push_str(&format_breakdown(&outcome));
    }
    if !errors.is_empty() {
        text.push_str(&format!("INVALID {}\n", errors.len()));
        for error in errors.iter().take(5) {
            text.push_str(&format!(
                "  {}\n",
                describe_validation_error(error)
            ));
        }
    }
    text.push_str(&format_board(&board, outcome.answer.edges()));
    emit(options, &text)?;
    Ok(if outcome.status == SolveStatus::Broken || !errors.is_empty() {
        1
    } else if outcome.status == SolveStatus::Stopped {
        2
    } else {
        0
    })
}

fn format_stat(value: f64) -> String {
    if value.fract().abs() < 1e-9 {
        format!("{value:.0}")
    } else {
        format!("{value:.2}")
    }
}

fn calibrate_command(options: &Options) -> Result<i32, String> {
    let source = options
        .positional
        .first()
        .ok_or_else(|| "calibrate needs a corpus TSV".to_string())?;
    let default_threads = std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1);
    let threads = usize_option(options, "--threads", default_threads)?;
    let rounds = usize_option(options, "--rounds", 20)?;
    let trial_limit = usize_option(
        options,
        "--trial-limit",
        DEFAULT_TRIAL_CANDIDATE_LIMIT,
    )?;
    let folds = usize_option(options, "--folds", DEFAULT_FOLDS)?;
    let min_weight = int_option(options, "--min-weight", 0)?;
    if threads == 0 {
        return Err("--threads must be positive".into());
    }
    if rounds == 0 {
        return Err("--rounds must be positive".into());
    }
    if !(0..=MAX_CALIBRATION_WEIGHT).contains(&min_weight) {
        return Err(format!(
            "--min-weight must be between 0 and {MAX_CALIBRATION_WEIGHT}"
        ));
    }

    let command_started = Instant::now();
    let corpus = read_corpus(source)?;
    if folds > corpus.len() {
        return Err(format!(
            "--folds ({folds}) must not exceed corpus size ({})",
            corpus.len()
        ));
    }
    let results = solve_corpus(&corpus, threads, trial_limit)?;
    // BROKEN は実装不具合の可能性があるため採点せず、完解と STOPPED
    // だけを入力順由来の決定的な集合として較正へ渡す。
    let all_entries: Vec<_> = results
        .completed
        .iter()
        .chain(&results.stopped)
        .cloned()
        .collect();
    let baseline_parameters = current_parameters();
    let completed_baseline =
        spearman(&results.completed, &baseline_parameters);
    let all_baseline = spearman(&all_entries, &baseline_parameters);
    let normalization =
        analyze_normalizations(&all_entries, &baseline_parameters);
    // 実表示と同じ固定指数・0 ヒント補正を較正目的にも使う。
    // 指数候補の分析結果へ目的関数を差し替えると、CLI の DPN とずれる。
    let dpn_normalization =
        NormalizationKind::PowerCell(DPN_SIZE_EXPONENT);
    let uncorrected_optimized = optimize_without_zero_discount(
        &all_entries,
        rounds,
        min_weight,
        dpn_normalization,
    );
    let optimized =
        optimize(&all_entries, rounds, min_weight, dpn_normalization);
    let calibrated_normalization =
        analyze_normalizations(&all_entries, &optimized.parameters);
    let completed_baseline_dpn = normalized_spearman(
        &results.completed,
        &baseline_parameters,
        dpn_normalization,
    );
    let all_baseline_dpn = normalized_spearman(
        &all_entries,
        &baseline_parameters,
        dpn_normalization,
    );
    let all_uncorrected_baseline_dpn = uncorrected_normalized_spearman(
        &all_entries,
        &baseline_parameters,
        dpn_normalization,
    );
    let all_uncorrected_calibrated_dpn = uncorrected_normalized_spearman(
        &all_entries,
        &uncorrected_optimized.parameters,
        dpn_normalization,
    );
    let completed_calibrated_dpn = normalized_spearman(
        &results.completed,
        &optimized.parameters,
        dpn_normalization,
    );
    let all_calibrated_dpn = normalized_spearman(
        &all_entries,
        &optimized.parameters,
        dpn_normalization,
    );
    let size_baseline = size_only_spearman(&all_entries);
    let stratified = stratified_correlations(
        &all_entries,
        &baseline_parameters,
        dpn_normalization,
        20,
    );
    let uncorrected_stratified = uncorrected_stratified_correlations(
        &all_entries,
        &baseline_parameters,
        dpn_normalization,
        20,
    );
    let cross_validation_started = Instant::now();
    let cross_validation = if folds >= 2 {
        Some(cross_validate(
            &all_entries,
            folds,
            rounds,
            min_weight,
            dpn_normalization,
        )?)
    } else {
        None
    };
    let cross_validation_elapsed = cross_validation_started.elapsed();
    let completed_calibrated =
        spearman(&results.completed, &optimized.parameters);
    let all_calibrated = spearman(&all_entries, &optimized.parameters);
    let summaries = class_summaries(&all_entries, &optimized.parameters);
    let boundaries =
        boundary_suggestions(&all_entries, &optimized.parameters);
    let normalized_summaries = normalized_class_summaries(
        &all_entries,
        &baseline_parameters,
        dpn_normalization,
    );
    let normalized_boundaries = normalized_boundary_suggestions(
        &all_entries,
        &baseline_parameters,
        dpn_normalization,
    );
    let zero_strata_before = zero_clue_strata(
        &all_entries,
        &baseline_parameters,
        dpn_normalization,
        false,
    );
    let zero_strata_after = zero_clue_strata(
        &all_entries,
        &baseline_parameters,
        dpn_normalization,
        true,
    );
    // 人手評価との差は band と同じ ★1〜★5 対応で測る。intro と easy は
    // どちらも ★1 なので、隣接評価4境界を越えた数だけ評価値へ足す。
    let stopped_mean_delta = if results.stopped.is_empty() {
        0.0
    } else {
        results
            .stopped
            .iter()
            .map(|entry| {
                let entry_score = normalized_score(
                    entry,
                    &baseline_parameters,
                    dpn_normalization,
                );
                let predicted = 1
                    + normalized_boundaries
                        .iter()
                        .filter(|boundary| entry_score >= boundary.threshold)
                        .count() as i32;
                f64::from(predicted - entry.difficulty)
            })
            .sum::<f64>()
            / results.stopped.len() as f64
    };

    let mut text = format!(
        "CORPUS_TOTAL {}\nCOMPLETED {}\nSTOPPED {}\nBROKEN {}\nTHREADS {}\nWORKERS {}\nTRIAL_CANDIDATE_LIMIT {}\nFOLDS {}\nMIN_WEIGHT {}\nSOLVE_MS {}\nCOMPLETED_ONLY_BASELINE_DP_SPEARMAN {:.6}\nCOMPLETED_ONLY_CALIBRATED_DP_SPEARMAN {:.6}\nCOMPLETED_ONLY_BASELINE_DPN_SPEARMAN {:.6}\nCOMPLETED_ONLY_CALIBRATED_DPN_SPEARMAN {:.6}\nALL_WITH_STOPPED_BASELINE_DP_SPEARMAN {:.6}\nALL_WITH_STOPPED_CALIBRATED_DP_SPEARMAN {:.6}\nALL_WITH_STOPPED_UNCORRECTED_BASELINE_DPN_SPEARMAN {:.6}\nALL_WITH_STOPPED_UNCORRECTED_CALIBRATED_DPN_SPEARMAN {:.6}\nALL_WITH_STOPPED_BASELINE_DPN_SPEARMAN {:.6}\nALL_WITH_STOPPED_CALIBRATED_DPN_SPEARMAN {:.6}\nSTOPPED_BASELINE_BAND_MEAN_DELTA {:.6}\nSIZE_ONLY_SPEARMAN {:.6}\nCALIBRATION_ROUNDS {}\n",
        corpus.len(),
        results.completed.len(),
        results.stopped.len(),
        results.broken.len(),
        threads,
        results.workers,
        trial_limit,
        folds,
        min_weight,
        results.elapsed.as_millis(),
        completed_baseline,
        completed_calibrated,
        completed_baseline_dpn,
        completed_calibrated_dpn,
        all_baseline,
        all_calibrated,
        all_uncorrected_baseline_dpn,
        all_uncorrected_calibrated_dpn,
        all_baseline_dpn,
        all_calibrated_dpn,
        stopped_mean_delta,
        size_baseline,
        optimized.rounds
    );
    text.push_str("NORMALIZATION_CANDIDATES\n");
    text.push_str(&format!(
        "  DP_PER_CELL correlation={:.6}\n  DP_PER_EDGE correlation={:.6}\n  LOG_DP_MINUS_A_LOG_CELLS a={:.4} correlation={:.6}\n  SELECTED {} correlation={:.6}\n",
        normalization.per_cell_correlation,
        normalization.per_edge_correlation,
        normalization.power_exponent,
        normalization.power_correlation,
        normalization.selected.name(),
        normalization.selected_correlation
    ));
    text.push_str(&format!(
        "DPN_NORMALIZATION {}\n",
        dpn_normalization.name()
    ));
    text.push_str(&format!(
        "CALIBRATED_NORMALIZATION_DIAGNOSTIC selected={} a={:.4} correlation={:.6}\n",
        calibrated_normalization.selected.name(),
        calibrated_normalization.power_exponent,
        calibrated_normalization.selected_correlation
    ));
    text.push_str("SIZE_STRATIFIED_SPEARMAN minimum_count=20\n");
    for (before, after) in uncorrected_stratified
        .layers
        .iter()
        .zip(&stratified.layers)
    {
        text.push_str(&format!(
            "  cells={} count={} DP={:.6} DPN_before={:.6} DPN_after={:.6}\n",
            after.cell_count,
            after.count,
            after.dp_correlation,
            before.dpn_correlation,
            after.dpn_correlation
        ));
    }
    text.push_str(&format!(
        "  WEIGHTED_MEAN count={} DP={:.6} DPN_before={:.6} DPN_after={:.6}\n",
        stratified.layers.iter().map(|layer| layer.count).sum::<usize>(),
        stratified.dp_weighted_mean,
        uncorrected_stratified.dpn_weighted_mean,
        stratified.dpn_weighted_mean
    ));
    if let Some(validation) = &cross_validation {
        text.push_str(&format!("CROSS_VALIDATION folds={folds}\n"));
        for fold in &validation.folds {
            text.push_str(&format!(
                "  fold={} train={} test={} DP_baseline={:.6} DP_calibrated={:.6} DPN_before={:.6} DPN_after={:.6}\n",
                fold.fold,
                fold.train_count,
                fold.test_count,
                fold.baseline_correlation,
                fold.calibrated_correlation,
                fold.uncorrected_calibrated_dpn_correlation,
                fold.calibrated_dpn_correlation
            ));
        }
        text.push_str(&format!(
            "  DP_MEAN baseline={:.6} calibrated={:.6} (stddev {:.6})\n  DPN_MEAN before={:.6} after={:.6} (after stddev {:.6})\n",
            validation.baseline_mean,
            validation.calibrated_mean,
            validation.calibrated_stddev,
            validation.uncorrected_calibrated_dpn_mean,
            validation.calibrated_dpn_mean,
            validation.calibrated_dpn_stddev
        ));
        let generalization_gap =
            optimized.correlation - validation.calibrated_dpn_mean;
        let uncorrected_generalization_gap = uncorrected_optimized.correlation
            - validation.uncorrected_calibrated_dpn_mean;
        text.push_str(&format!(
            "GENERALIZATION_DPN_BEFORE train={:.6} validation={:.6} gap={:.6}\nGENERALIZATION_DPN_AFTER train={:.6} validation={:.6} gap={:.6}\n",
            uncorrected_optimized.correlation,
            validation.uncorrected_calibrated_dpn_mean,
            uncorrected_generalization_gap,
            optimized.correlation,
            validation.calibrated_dpn_mean,
            generalization_gap
        ));
        // 0.05 は fold 間の小さな揺れではなく、採用判断に影響する相関低下を
        // 明示するための実務上の警告閾値とする。数値自体は常に直前へ出す。
        if generalization_gap >= 0.05 {
            text.push_str(
                "OVERFIT_WARNING validation correlation is at least 0.05 below training correlation\n",
            );
        }
        text.push_str(&format!(
            "CROSS_VALIDATION_MS {}\n",
            cross_validation_elapsed.as_millis()
        ));
    } else {
        text.push_str(&format!(
            "CROSS_VALIDATION disabled folds={folds}\n"
        ));
    }
    text.push_str("WEIGHTS\n");
    for (index, spec) in DIFFICULTY_REASONS.iter().enumerate() {
        text.push_str(&format!(
            "  {} ({}) {} -> {}\n",
            spec.constant,
            spec.reason,
            baseline_parameters[index],
            optimized.parameters[index]
        ));
    }
    text.push_str(&format!(
        "  trial_deductions {} -> {}\n",
        baseline_parameters[TRIAL_DEDUCTIONS_PARAMETER],
        optimized.parameters[TRIAL_DEDUCTIONS_PARAMETER]
    ));
    text.push_str(&format!(
        "  max_trial_count² {} -> {}\n",
        baseline_parameters[MAX_TRIAL_COUNT_PARAMETER],
        optimized.parameters[MAX_TRIAL_COUNT_PARAMETER]
    ));
    text.push_str(&format!(
        "  stopped_penalty {} -> {}\n",
        baseline_parameters[STOPPED_PENALTY_PARAMETER],
        optimized.parameters[STOPPED_PENALTY_PARAMETER]
    ));
    text.push_str(&format!(
        "  stopped_unknown_weight {} -> {}\n",
        baseline_parameters[STOPPED_UNKNOWN_WEIGHT_PARAMETER],
        optimized.parameters[STOPPED_UNKNOWN_WEIGHT_PARAMETER]
    ));
    text.push_str("CLASS_DP\n");
    for summary in summaries {
        let completion_rate = if summary.count == 0 {
            0.0
        } else {
            100.0 * summary.completed_count as f64 / summary.count as f64
        };
        text.push_str(&format!(
            "  difficulty={} completed={}/{} completion_rate={:.2}% q1={} median={} q3={}\n",
            summary.difficulty,
            summary.completed_count,
            summary.count,
            completion_rate,
            format_stat(summary.q1),
            format_stat(summary.median),
            format_stat(summary.q3)
        ));
    }
    text.push_str("BOUNDARIES_DP\n");
    for boundary in &boundaries {
        text.push_str(&format!(
            "  difficulty {} / {}: DP {} (adjacent-class errors {}/{})\n",
            boundary.lower_difficulty,
            boundary.upper_difficulty,
            boundary.threshold,
            boundary.errors,
            boundary.sample_count
        ));
    }
    text.push_str("CLASS_DPN\n");
    for summary in &normalized_summaries {
        let completion_rate = if summary.count == 0 {
            0.0
        } else {
            100.0 * summary.completed_count as f64 / summary.count as f64
        };
        text.push_str(&format!(
            "  difficulty={} completed={}/{} completion_rate={:.2}% q1={:.6} median={:.6} q3={:.6}\n",
            summary.difficulty,
            summary.completed_count,
            summary.count,
            completion_rate,
            summary.q1,
            summary.median,
            summary.q3
        ));
    }
    text.push_str("BOUNDARIES_DPN\n");
    for boundary in &normalized_boundaries {
        text.push_str(&format!(
            "  difficulty {} / {}: DPN {:.6} (adjacent-class errors {}/{})\n",
            boundary.lower_difficulty,
            boundary.upper_difficulty,
            boundary.threshold,
            boundary.errors,
            boundary.sample_count
        ));
    }
    text.push_str(
        "ZERO_CLUE_STRATA mean_delta=predicted_difficulty-human_difficulty large_overestimate=delta>=2\n",
    );
    for (before, after) in zero_strata_before.iter().zip(&zero_strata_after) {
        let before_rate = if before.count == 0 {
            0.0
        } else {
            100.0 * before.large_overestimate_count as f64
                / before.count as f64
        };
        let after_rate = if after.count == 0 {
            0.0
        } else {
            100.0 * after.large_overestimate_count as f64
                / after.count as f64
        };
        text.push_str(&format!(
            "  zero_ratio={} count={} before_mean_delta={:.6} after_mean_delta={:.6} before_large_overestimate={:.2}% after_large_overestimate={:.2}%\n",
            before.label,
            before.count,
            before.mean_delta,
            after.mean_delta,
            before_rate,
            after_rate
        ));
    }
    let intro_easy = normalized_summaries
        .first()
        .map(|summary| summary.q1)
        .unwrap_or(0.0);
    text.push_str("BAND_PROPOSAL_DPN\n");
    if normalized_boundaries.len() == 4 {
        let mut band_thresholds: Vec<_> = normalized_boundaries
            .iter()
            .map(|boundary| boundary.threshold)
            .collect();
        for index in 1..band_thresholds.len() {
            band_thresholds[index] =
                band_thresholds[index].max(
                    f64::from_bits(band_thresholds[index - 1].to_bits() + 1),
                );
        }
        let intro_easy = intro_easy.min(band_thresholds[0]);
        text.push_str(&format!(
            "  intro < {intro_easy:.6}\n  easy < {:.6}\n  medium < {:.6}\n  hard < {:.6}\n  expert < {:.6}\n  fiendish >= {:.6}\n",
            band_thresholds[0],
            band_thresholds[1],
            band_thresholds[2],
            band_thresholds[3],
            band_thresholds[3]
        ));
        text.push_str(
            "  mapping: difficulty 1=intro/easy, 2=medium, 3=hard, 4=expert, 5=fiendish\n",
        );
    } else {
        text.push_str(
            "  unavailable: one or more difficulty classes have no non-broken puzzles\n",
        );
    }
    if !results.broken.is_empty() {
        text.push_str("BROKEN_PROBLEMS\n");
        for entry in &results.broken {
            text.push_str(&format!("  {}\t{}\n", entry.id, entry.code));
        }
    }
    text.push_str(&format!(
        "TOTAL_MS {}\n",
        command_started.elapsed().as_millis()
    ));
    print!("{text}");

    if let Some(path) = options.values.get("--out") {
        fs::write(path, format_match_arms(&optimized.parameters))
            .map_err(|error| error.to_string())?;
        println!("WEIGHTS_OUT {path}");
    }
    Ok(0)
}

fn count_command(options: &Options) -> Result<i32, String> {
    let source = options
        .positional
        .first()
        .ok_or_else(|| "count needs a problem".to_string())?;
    let board = read_problem(source)?;
    let limit = int_option(options, "--limit", 2)?;
    let max_nodes = int_option(options, "--max-nodes", 200_000)?;
    if limit < 0 {
        return Err("--limit must not be negative".into());
    }
    if max_nodes < 0 {
        return Err("--max-nodes must not be negative".into());
    }
    let result = count_solutions(&board, limit as usize, max_nodes);
    emit(
        options,
        &format!(
            "SOLUTIONS {}\nNODES {}\nABORTED {}\n",
            result.solutions.len(),
            result.nodes,
            i32::from(result.aborted)
        ),
    )?;
    Ok(i32::from(
        result.aborted || result.solutions.len() != 1,
    ))
}

fn render_generated(
    options: &Options,
    generated: &Generated,
    reduce_mode: &str,
) -> Result<String, String> {
    match options.values.get("--format").map(String::as_str) {
        Some("url") => return Ok(format!("{}\n", encode_url(&generated.board))),
        Some("code") => return Ok(format!("{}\n", encode_code(&generated.board))),
        Some("text") => return Ok(format_problem_text(&generated.board)),
        None | Some("grid") => {}
        Some(other) => return Err(format!("unknown format: {other}")),
    }
    let clues = generated
        .board
        .clues
        .iter()
        .filter(|&&clue| clue >= 0)
        .count();
    let loop_edges = generated
        .solution
        .iter()
        .filter(|&&edge| edge == slitherlink_kit::engine::EdgeState::Line)
        .count();
    let total_edges = generated.board.edge_count();
    let loop_percent = 100.0 * loop_edges as f64 / total_edges as f64;
    Ok(format!(
        "CODE {}\nURL {}\nDP {}\nDPN {:.6}\nBAND {}\nSTATUS {}\nCLUES {}\nATTEMPTS {}\nREDUCE {}\nLOOP_EDGES {}/{} ({:.2}%)\nSTRETCH_ITERATIONS {}/{}\nSTRETCH_ACCEPTED {}\nSTRETCH_LENGTH {} -> {} (target {})\nREDUCTION_CHECKS {}\nFINAL_CHECK nodes={}/{} aborted={} solutions={}\n{}{}",
        encode_code(&generated.board),
        encode_url(&generated.board),
        generated.difficulty,
        generated.normalized_difficulty,
        band(generated.normalized_difficulty),
        status_name(generated.outcome.status),
        clues,
        generated.attempts,
        reduce_mode,
        loop_edges,
        total_edges,
        loop_percent,
        generated.stats.stretch_iterations,
        generated.stats.stretch_limit,
        generated.stats.stretch_accepted,
        generated.stats.stretch_initial_length,
        loop_edges,
        generated.stats.stretch_target_length,
        generated.stats.reduction_checks,
        generated.stats.final_check_nodes,
        generated.stats.final_check_limit,
        i32::from(generated.stats.final_check_aborted),
        generated.stats.final_check_solutions,
        format_problem_text(&generated.board),
        format_board(&generated.board, &generated.solution)
    ))
}

fn generate_command(options: &Options, pattern_mode: bool) -> Result<i32, String> {
    let seed = int_option(options, "--seed", 0)?;
    let generate = generate_options(options, pattern_mode)?;
    let reduce_mode = if !generate.reduce {
        "none"
    } else if generate.exact_reduce {
        "exact"
    } else {
        "technique"
    };
    let mut rng = Rng::new(seed as i64);
    let report = if pattern_mode {
        generate_pattern_report_checked(&mut rng, &generate)
    } else {
        generate_loop_report_checked(&mut rng, &generate)
    }
    .map_err(|error| error.to_string())?;
    if let Some(generated) = report.generated {
        let has_grid_metadata = options
            .values
            .get("--format")
            .is_none_or(|format| format == "grid");
        if !has_grid_metadata {
            eprintln!("REDUCE {reduce_mode}");
        }
        emit(
            options,
            &render_generated(options, &generated, reduce_mode)?,
        )?;
        Ok(0)
    } else {
        eprintln!("REDUCE {reduce_mode}");
        let range = match (report.dpn_min, report.dpn_max) {
            (Some(minimum), Some(maximum)) => {
                format!("{minimum:.1}..{maximum:.1}")
            }
            _ => "unavailable".to_string(),
        };
        if let Some(requested_band) = generate.band.as_deref() {
            let hint = if generate.exact_reduce {
                "--attempts を増やしてください"
            } else {
                "--exact-reduce を試すか、--attempts を増やしてください"
            };
            eprintln!(
                "RESULT GENERATE_FAILED attempts={} band={} reason=指定範囲に届かなかった dpn_range={} hint={}",
                generate.attempts, requested_band, range, hint
            );
        } else if generate.dpn_min.is_some()
            || generate.dpn_max.is_some()
            || generate.dp_min.is_some()
            || generate.dp_max.is_some()
        {
            eprintln!(
                "RESULT GENERATE_FAILED attempts={} reason=指定範囲に届かなかった dpn_range={} hint=--attempts を増やしてください",
                generate.attempts, range
            );
        } else {
            eprintln!(
                "RESULT GENERATE_FAILED attempts={} dpn_range={}",
                generate.attempts, range
            );
        }
        Ok(2)
    }
}

fn bench_command(options: &Options) -> Result<i32, String> {
    let count = int_option(options, "--count", 10)?;
    let seed = int_option(options, "--seed", 0)?;
    if count <= 0 {
        return Err("--count must be positive".into());
    }
    let generate = generate_options(options, false)?;
    let started = Instant::now();
    let mut boards = Vec::new();
    let mut dp_total = 0i64;
    for offset in 0..count {
        let current_seed = seed as i64 + offset as i64;
        if let Some(puzzle) = generate_loop_checked(
            &mut Rng::new(current_seed),
            &generate,
        )
        .map_err(|error| error.to_string())?
        {
            dp_total += puzzle.difficulty as i64;
            boards.push(puzzle.board);
        }
    }
    let generate_ms = started.elapsed().as_millis();

    let started = Instant::now();
    let solved = boards
        .iter()
        .filter(|board| {
            run_all(
                board,
                None,
                SolveOptions {
                    no_local_pattern: generate.no_local_pattern,
                    ..SolveOptions::default()
                },
            )
            .status
                == SolveStatus::Completed
        })
        .count();
    let solve_ms = started.elapsed().as_millis();

    let started = Instant::now();
    let mut unique = 0;
    let mut nodes_total = 0usize;
    for board in &boards {
        let result = count_solutions(board, 2, generate.max_nodes);
        nodes_total += result.nodes;
        if !result.aborted && result.solutions.len() == 1 {
            unique += 1;
        }
    }
    let count_ms = started.elapsed().as_millis();
    let average = if boards.is_empty() {
        0
    } else {
        ((dp_total as f64 / boards.len() as f64) + 0.5).floor() as i64
    };
    emit(
        options,
        &format!(
            "GENERATED {}/{}\nGENERATE_MS {}\nSOLVED {}/{}\nSOLVE_MS {}\nUNIQUE {}/{}\nCOUNT_MS {}\nNODES_TOTAL {}\nDP_AVG {}\n",
            boards.len(),
            count,
            generate_ms,
            solved,
            boards.len(),
            solve_ms,
            unique,
            boards.len(),
            count_ms,
            nodes_total,
            average
        ),
    )?;
    Ok(if boards.len() == count as usize { 0 } else { 2 })
}

fn benchmark_boards(
    source: &str,
    limit: usize,
) -> Result<Vec<(String, Board)>, String> {
    let text = fs::read_to_string(source).map_err(|error| error.to_string())?;
    let mut boards = Vec::new();
    for line in text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
    {
        let code = line
            .rsplit('\t')
            .next()
            .expect("空でない行には最後の列がある")
            .trim();
        boards.push((code.to_string(), decode_url(code)?));
        if boards.len() == limit {
            break;
        }
    }
    Ok(boards)
}

fn bench_solve_command(options: &Options) -> Result<i32, String> {
    let source = options
        .positional
        .first()
        .ok_or_else(|| "bench-solve needs a file".to_string())?;
    let limit = usize_option(options, "--limit", usize::MAX)?;
    if limit == 0 {
        return Err("--limit must be positive".into());
    }
    let boards = benchmark_boards(source, limit)?;
    let mut completed = 0usize;
    let mut stopped = 0usize;
    let mut broken = 0usize;
    let mut passes = 0i64;
    let mut measured_ns = 0u128;
    let started = Instant::now();
    let mut details = String::new();
    for (index, (code, board)) in boards.iter().enumerate() {
        let problem_started = Instant::now();
        let outcome = run_all(
            board,
            None,
            SolveOptions {
                no_trial: true,
                max_passes: 0,
                no_local_pattern: options.flags.contains("--no-local-pattern"),
            },
        );
        let elapsed_ns = problem_started.elapsed().as_nanos();
        measured_ns += elapsed_ns;
        passes += i64::from(outcome.stats.passes);
        match outcome.status {
            SolveStatus::Completed => completed += 1,
            SolveStatus::Stopped => stopped += 1,
            SolveStatus::Broken => broken += 1,
        }
        if options.flags.contains("--breakdown") {
            details.push_str(&format!(
                "PROBLEM {} status={} passes={} elapsed_ns={} code={}\n",
                index + 1,
                status_name(outcome.status),
                outcome.stats.passes,
                elapsed_ns,
                code
            ));
        }
    }
    let wall_ns = started.elapsed().as_nanos();
    let average_passes = if boards.is_empty() {
        0.0
    } else {
        passes as f64 / boards.len() as f64
    };
    let mut text = format!(
        "PROBLEMS {}\nCOMPLETED {}\nSTOPPED {}\nBROKEN {}\nPASSES_TOTAL {}\nPASSES_AVG {:.6}\nSOLVE_NS {}\nWALL_NS {}\n",
        boards.len(),
        completed,
        stopped,
        broken,
        passes,
        average_passes,
        measured_ns,
        wall_ns
    );
    text.push_str(&details);
    emit(options, &text)?;
    Ok(if broken == 0 { 0 } else { 1 })
}

fn run() -> Result<i32, String> {
    let args: Vec<_> = env::args().skip(1).collect();
    if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
        print!("{USAGE}");
        return Ok(if args.is_empty() { 1 } else { 0 });
    }
    let command = &args[0];
    let options = parse_args(&args[1..])?;
    match command.as_str() {
        "solve" => solve_command(&options),
        "bands" => bands_command(&options),
        "count" => count_command(&options),
        "calibrate" => calibrate_command(&options),
        "generate-loop" => generate_command(&options, false),
        "generate-pattern" => generate_command(&options, true),
        "bench" => bench_command(&options),
        "bench-solve" => bench_solve_command(&options),
        _ => {
            eprintln!("unknown command: {command}");
            print!("{USAGE}");
            Ok(1)
        }
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => ExitCode::from(code as u8),
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_reduce_flag_selects_exhaustive_reduction() {
        let options = parse_args(&["--exact-reduce".to_string()])
            .expect("引数を解釈できる");
        let generate =
            generate_options(&options, false).expect("生成設定を作れる");
        assert!(generate.exact_reduce);
    }

    #[test]
    fn hard_or_higher_band_selects_exhaustive_reduction() {
        for band in ["hard", "expert", "fiendish"] {
            let options = parse_args(&["--band".to_string(), band.to_string()])
                .expect("引数を解釈できる");
            let generate =
                generate_options(&options, false).expect("生成設定を作れる");
            assert!(generate.exact_reduce, "{band} は完全探索削減を使う");
        }
    }

    #[test]
    fn medium_or_lower_band_keeps_technique_reduction() {
        for band in ["intro", "easy", "medium"] {
            let options = parse_args(&["--band".to_string(), band.to_string()])
                .expect("引数を解釈できる");
            let generate =
                generate_options(&options, false).expect("生成設定を作れる");
            assert!(!generate.exact_reduce, "{band} は手筋削減を使う");
        }
    }

    #[test]
    fn symmetry_defaults_depend_on_generation_mode() {
        let options = parse_args(&[]).expect("空の引数を解釈できる");
        let loop_options =
            generate_options(&options, false).expect("ループ生成設定を作れる");
        let pattern_options =
            generate_options(&options, true).expect("パターン生成設定を作れる");

        assert_eq!(loop_options.symmetry, Symmetry::None);
        assert_eq!(pattern_options.symmetry, Symmetry::Rot2);
    }

    #[test]
    fn all_symmetries_are_parsed_for_both_generation_modes() {
        let cases = [
            ("rot2", Symmetry::Rot2),
            ("rot4", Symmetry::Rot4),
            ("mirror-h", Symmetry::MirrorH),
            ("mirror-v", Symmetry::MirrorV),
        ];
        for (name, expected) in cases {
            let options = parse_args(&[
                "--size".to_string(),
                "5x5".to_string(),
                "--symmetry".to_string(),
                name.to_string(),
            ])
            .expect("対称性引数を解釈できる");
            let loop_options = generate_options(&options, false)
                .expect("ループ生成設定を作れる");
            let pattern_options = generate_options(&options, true)
                .expect("パターン生成設定を作れる");

            assert_eq!(loop_options.symmetry, expected);
            assert_eq!(pattern_options.symmetry, expected);
        }
    }
}
