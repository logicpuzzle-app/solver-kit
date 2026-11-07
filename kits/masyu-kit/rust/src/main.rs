use std::process::ExitCode;

use masyu_kit::answer_methods::{AnswerMethods, Recorder};
use masyu_kit::answer_model::AnswerModel;
use masyu_kit::board::Board;
use masyu_kit::difficulty::{difficulty, format_breakdown, puzsq_rating_hundredths};
use masyu_kit::format::{format_answer, format_board};
use masyu_kit::puzzlink::{decode_url, encode_code, encode_url};
use masyu_kit::search::count_solutions_from;
use masyu_kit::solver::{run_all, technique_list, SolveOptions, SolveStatus, TIER_COUNT};
use masyu_kit::status::Status;

const UNIQUENESS_NODES: u64 = 2_000_000;
const ANSWER_NODES: u64 = 20_000_000;

fn read_problem(source: &str) -> Result<Board, String> {
    if source.contains("mashu/") || source.contains("masyu/") || source.contains("pearl/") {
        decode_url(source)
    } else {
        let text = std::fs::read_to_string(source).map_err(|e| format!("{}: {}", source, e))?;
        decode_url(text.trim())
    }
}

fn parse_flag(args: &mut Vec<String>, name: &str) -> bool {
    if let Some(pos) = args.iter().position(|a| a == name) {
        args.remove(pos);
        true
    } else {
        false
    }
}

fn parse_value(args: &mut Vec<String>, name: &str) -> Result<Option<i32>, String> {
    if let Some(pos) = args.iter().position(|a| a == name) {
        if pos + 1 >= args.len() {
            return Err(format!("{} に値がない", name));
        }
        let value = args[pos + 1]
            .parse()
            .map_err(|_| format!("{} の値が不正: {}", name, args[pos + 1]))?;
        args.remove(pos + 1);
        args.remove(pos);
        Ok(Some(value))
    } else {
        Ok(None)
    }
}

fn cmd_show(board: &Board) {
    print!("{}", format_board(board));
    println!("CODE {}", encode_code(board));
    println!("URL {}", encode_url(board));
}

fn cmd_solve(board: &Board, mut args: Vec<String>) -> Result<i32, String> {
    let mut options = SolveOptions::default();
    options.no_trial = parse_flag(&mut args, "--no-trial");
    if parse_flag(&mut args, "--shallow") {
        options.trial_depth = 0;
    }
    if let Some(tier) = parse_value(&mut args, "--tier")? {
        options.tier = tier.clamp(1, i32::from(TIER_COUNT)) as u8;
    }
    if let Some(depth) = parse_value(&mut args, "--depth")? {
        options.trial_depth = depth.max(0);
    }
    let breakdown = parse_flag(&mut args, "--breakdown");
    if !args.is_empty() {
        return Err(format!("不明な引数: {}", args.join(" ")));
    }

    let outcome = run_all(board, options);

    let solutions = match outcome.status {
        SolveStatus::Completed => "1".to_string(),
        SolveStatus::Broken => "0".to_string(),
        SolveStatus::Stopped => {
            let found =
                count_solutions_from(board, outcome.answer.clone(), 2, UNIQUENESS_NODES);
            match (found.solutions.len(), found.aborted) {
                (0, false) => "0".to_string(),
                (1, false) => "1".to_string(),
                (n, _) if n >= 2 => "2+".to_string(),
                _ => "?".to_string(),
            }
        }
    };
    // ? を伏せてはいけない。数えきれなかったことは複数あることの証拠ではない。
    let unique = solutions != "2+" && solutions != "0";

    println!(
        "STATUS {}",
        match outcome.status {
            SolveStatus::Completed => "COMPLETED",
            SolveStatus::Stopped => "STOPPED",
            SolveStatus::Broken => "BROKEN",
        }
    );
    println!("SOLUTIONS {}", solutions);
    if unique {
        let score = difficulty(&outcome);
        println!("DP {}", score);
        let rating = puzsq_rating_hundredths(score);
        println!("RATING {}.{:02}", rating / 100, rating % 100);
    } else {
        println!("DP -");
        println!("RATING -");
    }
    println!("LEVEL {}", outcome.level);
    println!("PASSES {}", outcome.passes);
    println!(
        "TRIAL {} {} {} {}",
        outcome.stats.deductions,
        outcome.stats.nested_deductions,
        outcome.stats.pure_unknown,
        outcome.stats.shallow_unknown
    );
    println!("UNKNOWN {}", outcome.answer.unknown_count());
    println!("EDGES {}", board.edge_count());
    let mut reasons: Vec<(&str, i32)> = outcome
        .recorder
        .counts
        .iter()
        .map(|(&reason, &count)| (reason, count))
        .collect();
    reasons.sort();
    for (reason, count) in reasons {
        println!("  {} {}", reason, count);
    }
    if breakdown {
        println!("{}", format_breakdown(&outcome));
    }
    print!("{}", format_answer(board, &outcome.answer));

    Ok(match outcome.status {
        SolveStatus::Completed => 0,
        SolveStatus::Broken => 1,
        SolveStatus::Stopped => 2,
    })
}

fn cmd_answer(board: &Board) -> Result<i32, String> {
    let result = count_solutions_from(board, AnswerModel::new(board), 20, ANSWER_NODES);
    println!("SOLUTIONS {}", result.solutions.len());
    println!("ABORTED {}", if result.aborted { 1 } else { 0 });
    if let Some(answer) = result.solutions.first() {
        print!("{}", format_answer(board, answer));
    }
    Ok(0)
}

fn cmd_trace(board: &Board) -> Result<i32, String> {
    let mut answer = AnswerModel::new(board);
    let mut recorder = Recorder::default();
    for pass in 1..=30 {
        let mut advanced = false;
        for (name, technique) in technique_list() {
            let before = recorder.entries.len();
            let status = {
                let mut methods = AnswerMethods::new(board, &mut answer, Some(&mut recorder));
                technique(&mut methods)
            };
            let placed = recorder.entries.len() - before;
            if placed > 0 || status != Status::Stopped {
                println!("pass {} {}: {} 辺確定 ({:?})", pass, name, placed, status);
            }
            if status == Status::Broken {
                print!("{}", format_answer(board, &answer));
                return Ok(1);
            }
            if placed > 0 {
                advanced = true;
            }
        }
        if !advanced {
            println!("pass {}: 進展なし", pass);
            break;
        }
    }
    print!("{}", format_answer(board, &answer));
    Ok(0)
}

fn run(args: &[String]) -> Result<i32, String> {
    let usage = "usage: masyu <show|solve|answer|trace> <URL or file> [options]";
    if args.len() < 2 {
        return Err(usage.into());
    }
    let command = &args[0];
    let board = read_problem(&args[1])?;
    let rest: Vec<String> = args[2..].to_vec();
    match command.as_str() {
        "show" => {
            cmd_show(&board);
            Ok(0)
        }
        "solve" => cmd_solve(&board, rest),
        "answer" => cmd_answer(&board),
        "trace" => cmd_trace(&board),
        _ => Err(usage.into()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(code) => ExitCode::from(code as u8),
        Err(message) => {
            eprintln!("{}", message);
            ExitCode::from(1)
        }
    }
}
