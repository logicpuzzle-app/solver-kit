use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::process::ExitCode;
use std::time::Instant;

use yajilin_kit::board::Board;
use yajilin_kit::difficulty::{band, difficulty, puzsq_rating_hundredths};
use yajilin_kit::format::{
    format_answer_grid, format_problem_text, format_solution_summary, parse_problem_text,
};
use yajilin_kit::generator::{
    generate_loop, generate_pattern, GenerateOptions, Generated, Symmetry,
};
use yajilin_kit::puzzlink::{decode_url, encode_code, encode_url};
use yajilin_kit::random::Rng;
use yajilin_kit::search::count_solutions;
use yajilin_kit::solution::{
    describe_validation_error, extract_solution, validate_solution,
};
use yajilin_kit::solver::{run_all, SolveOptions, SolveStatus};

const USAGE: &str = r#"usage: yajilin <command> [options]

commands:
  solve <problem>              solve a puzzle and report the answer and difficulty
  count <problem> [--limit N]  count solutions (default limit 2)
  generate-loop [options]      generate by drawing the loop first
  generate-pattern [options]   generate from a clue pattern
  bench [options]              time solving and generation

<problem> is a file path, a puzz.link url, or a bare "yajilin/W/H/body" code.

common options:
  --seed N            rng seed (default 0)
  --size WxH          board size (default 10x10)
  --clues N           number of arrow clues
  --clue-ratio R      clues as a fraction of the board (default 0.16)
  --attempts N        retry budget, 0 = unlimited (default 100)
  --dp-min N          reject puzzles below this difficulty
  --dp-max N          reject puzzles above this difficulty
  --max-nodes N       search node cap, 0 = unlimited (default 200000)
  --symmetry S        none|rot2|rot4|mirror-h|mirror-v (pattern mode, default rot2)
  --pattern FILE      explicit clue pattern (pattern mode)
  --no-weaken         keep the most informative clue directions
  --no-reduce         keep every clue, even redundant ones (loop mode)
  --refine N          hill-climb N rounds for a harder puzzle (default 0)
  --anneal N          annealing rounds when the greedy repair stalls (default 8 per cell)
  --vary-clue-count   let the annealing add and remove clues: harder, ~40% slower
  --black-bias N      per-mille chance of trying a cell as black first (default 850)
  --no-trial          solve without the lookahead
  --format F          url|code|text|grid (default grid)
  --out FILE          write to a file instead of stdout
  --count N           bench iterations (default 10)
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
        "--clues",
        "--clue-ratio",
        "--attempts",
        "--dp-min",
        "--dp-max",
        "--max-nodes",
        "--symmetry",
        "--pattern",
        "--format",
        "--out",
        "--limit",
        "--count",
        "--refine",
        "--anneal",
        "--black-bias",
    ]
    .into_iter()
    .collect();
    let mut result = Options::default();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if valued.contains(arg.as_str()) {
            i += 1;
            let value = args
                .get(i)
                .ok_or_else(|| format!("{arg} requires a value"))?;
            result.values.insert(arg.clone(), value.clone());
        } else if arg.starts_with("--") {
            result.flags.insert(arg.clone());
        } else {
            result.positional.push(arg.clone());
        }
        i += 1;
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

fn emit(options: &Options, text: &str) -> Result<(), String> {
    if let Some(path) = options.values.get("--out") {
        fs::write(path, text).map_err(|e| e.to_string())
    } else {
        print!("{text}");
        Ok(())
    }
}

fn read_problem(source: &str) -> Result<Board, String> {
    let text = fs::read_to_string(source).unwrap_or_else(|_| source.to_string());
    let trimmed = text.trim();
    if trimmed.contains("yajilin/") {
        decode_url(trimmed)
    } else {
        parse_problem_text(trimmed)
    }
}

fn read_pattern(source: &str, cols: i32, rows: i32) -> Result<Vec<bool>, String> {
    let text = fs::read_to_string(source).map_err(|e| e.to_string())?;
    let lines: Vec<_> = text
        .lines()
        .map(str::trim)
        .filter(|line| {
            !line.is_empty()
                && !(line.starts_with('#')
                    && (line.len() == 1 || line.as_bytes().get(1) == Some(&b' ')))
        })
        .collect();
    if lines.len() != rows as usize {
        return Err(format!(
            "pattern must have {} rows, found {}",
            rows,
            lines.len()
        ));
    }
    let mut pattern = vec![false; (cols * rows) as usize];
    for (y, line) in lines.iter().enumerate() {
        let split: Vec<_> = line.split_whitespace().collect();
        let cells: Vec<String> = if split.len() == cols as usize {
            split.into_iter().map(str::to_string).collect()
        } else {
            line.chars().map(|c| c.to_string()).collect()
        };
        if cells.len() != cols as usize {
            return Err(format!("pattern row {} must have {} cells", y + 1, cols));
        }
        for (x, token) in cells.iter().enumerate() {
            pattern[y * cols as usize + x] = token != "." && token != "0";
        }
    }
    Ok(pattern)
}

/// The puzzle-square 1-5 rating, formatted from integer hundredths so that the three ports
/// print identical bytes — dividing first and formatting a float would not guarantee that.
/// Node budget for the uniqueness check. A budget rather than a deadline: the node count is
/// deterministic, so the three ports agree on when to give up, which a clock never would.
///
/// The value buys what it can and no more. On the 164 puzzles in the corpus that the
/// technique solver cannot finish, this settles roughly two thirds of them at about half a
/// second each; the rest do not settle at any budget worth spending — 34 of them were still
/// running after twenty minutes apiece. Past that point the honest answer is "unverified".
///
/// It costs nothing on an ordinary puzzle, because a finished solve is never asked.
const UNIQUENESS_NODES: i32 = 250_000;

/// How many answers the puzzle has, as "0", "1", "2+" or "?" when the budget ran out.
///
/// Only asked when the technique solver stopped short. Every deduction it makes is forced —
/// even the trials, which only ever rule a colour out by contradiction — so a solve that
/// finishes has proved its answer is the only one, and searching again would be waste.
///
/// It has to be asked at all because a puzzle with two answers is not hard, it is broken,
/// and the solver stalling on it looks exactly like the solver stalling on a hard one.
fn count_answers(board: &Board, status: SolveStatus) -> &'static str {
    if status == SolveStatus::Completed {
        return "1";
    }
    let found = count_solutions(board, 2, UNIQUENESS_NODES);
    if found.aborted {
        return "?";
    }
    match found.solutions.len() {
        0 => "0",
        1 => "1",
        _ => "2+",
    }
}

fn format_rating(score: i32) -> String {
    let hundredths = puzsq_rating_hundredths(score);
    let whole = hundredths / 100;
    let fraction = hundredths - whole * 100;
    format!("{whole}.{fraction:02}")
}

fn generate_options(options: &Options) -> Result<GenerateOptions, String> {
    let raw = options
        .values
        .get("--size")
        .map(String::as_str)
        .unwrap_or("10x10");
    let Some((w, h)) = raw.split_once('x') else {
        return Err("--size must look like 10x10".into());
    };
    let cols = w
        .parse()
        .map_err(|_| "--size must look like 10x10".to_string())?;
    let rows = h
        .parse()
        .map_err(|_| "--size must look like 10x10".to_string())?;
    let mut result = GenerateOptions {
        cols,
        rows,
        attempts: int_option(options, "--attempts", 100)?,
        max_nodes: int_option(options, "--max-nodes", 200_000)?,
        clue_ratio: options
            .values
            .get("--clue-ratio")
            .map(|v| {
                v.parse()
                    .map_err(|_| "--clue-ratio must be a number".to_string())
            })
            .unwrap_or(Ok(0.16))?,
        weaken: !options.flags.contains("--no-weaken"),
        reduce: !options.flags.contains("--no-reduce"),
        refine: int_option(options, "--refine", 0)?,
        vary_clue_count: options.flags.contains("--vary-clue-count"),
        anneal: if options.values.contains_key("--anneal") {
            Some(int_option(options, "--anneal", 0)?)
        } else {
            None
        },
        black_bias: int_option(options, "--black-bias", 850)?,
        ..GenerateOptions::default()
    };
    if options.values.contains_key("--clues") {
        result.clues = Some(int_option(options, "--clues", 0)? as usize);
    }
    if options.values.contains_key("--dp-min") {
        result.dp_min = Some(int_option(options, "--dp-min", 0)?);
    }
    if options.values.contains_key("--dp-max") {
        result.dp_max = Some(int_option(options, "--dp-max", 0)?);
    }
    if let Some(symmetry) = options.values.get("--symmetry") {
        result.symmetry = match symmetry.as_str() {
            "none" => Symmetry::None,
            "rot4" => Symmetry::Rot4,
            "mirror-h" => Symmetry::MirrorH,
            "mirror-v" => Symmetry::MirrorV,
            _ => Symmetry::Rot2,
        };
    }
    if let Some(pattern) = options.values.get("--pattern") {
        result.pattern = Some(read_pattern(pattern, cols, rows)?);
    }
    Ok(result)
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
        },
    );
    let solution = extract_solution(&outcome.answer);
    let errors = if outcome.status == SolveStatus::Completed {
        validate_solution(&board, &solution)
    } else {
        Vec::new()
    };
    let score = difficulty(&outcome, &board);
    let status = match outcome.status {
        SolveStatus::Completed => "COMPLETED",
        SolveStatus::Stopped => "STOPPED",
        SolveStatus::Broken => "BROKEN",
    };
    let solutions = count_answers(&board, outcome.status);
    // A score says how hard the puzzle was to work through, which means nothing when there
    // is nothing single to work towards.
    let rating = if solutions == "1" {
        format_rating(score)
    } else {
        "-".to_string()
    };
    let mut text = format!(
        "STATUS {status}\nSOLUTIONS {solutions}\nDP {score}\nBAND {}\nRATING {}\nLEVEL {}\nPASSES {}\nTRIAL {} {}\n",
        band(score),
        rating,
        outcome.stats.level,
        outcome.stats.passes,
        outcome.stats.trial_deductions,
        outcome.stats.max_trial_count
    );
    if !errors.is_empty() {
        text.push_str(&format!("INVALID {}\n", errors.len()));
        for error in errors.iter().take(5) {
            text.push_str(&format!("  {}\n", describe_validation_error(error)));
        }
    }
    text.push_str(&format_answer_grid(&board, &solution));
    text.push_str(&format_solution_summary(&solution));
    emit(options, &text)?;
    Ok(if outcome.status == SolveStatus::Broken
        || !errors.is_empty()
    {
        1
    } else if outcome.status != SolveStatus::Completed {
        2
    } else {
        0
    })
}

fn count_command(options: &Options) -> Result<i32, String> {
    let source = options
        .positional
        .first()
        .ok_or_else(|| "count needs a problem".to_string())?;
    let board = read_problem(source)?;
    let result = count_solutions(
        &board,
        int_option(options, "--limit", 2)? as usize,
        int_option(options, "--max-nodes", 0)?,
    );
    emit(
        options,
        &format!(
            "SOLUTIONS {}\nNODES {}\nABORTED {}\n",
            result.solutions.len(),
            result.nodes,
            i32::from(result.aborted)
        ),
    )?;
    Ok(if result.solutions.len() == 1 { 0 } else { 1 })
}

fn render_generated(options: &Options, generated: &Generated) -> String {
    match options.values.get("--format").map(String::as_str) {
        Some("url") => return format!("{}\n", encode_url(&generated.board)),
        Some("code") => return format!("{}\n", encode_code(&generated.board)),
        Some("text") => return format_problem_text(&generated.board),
        _ => {}
    }
    let clues = generated
        .board
        .cell
        .iter()
        .filter(|cell| cell.qnum != -1)
        .count();
    format!(
        "CODE {}\nURL {}\nDP {}\nBAND {}\nRATING {}\nSTATUS {}\nCLUES {}\nBLACKS {}\nATTEMPTS {}\n{}{}",
        encode_code(&generated.board),
        encode_url(&generated.board),
        generated.difficulty,
        band(generated.difficulty),
        format_rating(generated.difficulty),
        match generated.outcome.status {
            SolveStatus::Completed => "COMPLETED",
            SolveStatus::Stopped => "STOPPED",
            SolveStatus::Broken => "BROKEN",
        },
        clues,
        generated.solution.blacks.len(),
        generated.attempts,
        format_problem_text(&generated.board),
        format_answer_grid(&generated.board, &generated.solution)
    )
}

fn generate_command(options: &Options, pattern: bool) -> Result<i32, String> {
    let mut rng = Rng::new(int_option(options, "--seed", 0)? as i64);
    let generate = generate_options(options)?;
    let result = if pattern {
        generate_pattern(&mut rng, &generate)
    } else {
        generate_loop(&mut rng, &generate)
    };
    if let Some(generated) = result {
        emit(options, &render_generated(options, &generated))?;
        Ok(0)
    } else {
        eprintln!("RESULT GENERATE_FAILED attempts={}", generate.attempts);
        Ok(2)
    }
}

fn bench_command(options: &Options) -> Result<i32, String> {
    let count = int_option(options, "--count", 10)?;
    let seed = int_option(options, "--seed", 0)?;
    let generate = generate_options(options)?;
    let started = Instant::now();
    let mut boards = Vec::new();
    let mut dp_total = 0;
    for i in 0..count {
        if let Some(puzzle) = generate_loop(&mut Rng::new((seed + i) as i64), &generate) {
            dp_total += puzzle.difficulty;
            boards.push(puzzle.board);
        }
    }
    let generate_ms = started.elapsed().as_millis();
    let started = Instant::now();
    let solved = boards
        .iter()
        .filter(|b| run_all(b, None, SolveOptions::default()).status == SolveStatus::Completed)
        .count();
    let solve_ms = started.elapsed().as_millis();
    let started = Instant::now();
    let unique = boards
        .iter()
        .filter(|b| {
            let result = count_solutions(b, 2, generate.max_nodes);
            !result.aborted && result.solutions.len() == 1
        })
        .count();
    let count_ms = started.elapsed().as_millis();
    emit(
        options,
        &format!(
            "GENERATED {}/{}\nGENERATE_MS {}\nSOLVED {}/{}\nSOLVE_MS {}\nUNIQUE {}/{}\nCOUNT_MS {}\nDP_AVG {}\n",
            boards.len(),
            count,
            generate_ms,
            solved,
            boards.len(),
            solve_ms,
            unique,
            boards.len(),
            count_ms,
            if boards.is_empty() {
                0
            } else {
                ((dp_total as f64 / boards.len() as f64) + 0.5).floor() as i32
            }
        ),
    )?;
    Ok(if boards.len() == count as usize { 0 } else { 2 })
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
        "count" => count_command(&options),
        "generate-loop" => generate_command(&options, false),
        "generate-pattern" => generate_command(&options, true),
        "bench" => bench_command(&options),
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
