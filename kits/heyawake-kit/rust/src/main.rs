use std::process::ExitCode;

use heyawake_kit::answer_methods::AnswerMethods;
use heyawake_kit::answer_model::AnswerModel;
use heyawake_kit::difficulty::{difficulty, format_breakdown, puzsq_rating_hundredths};
use heyawake_kit::format::{format_answer, format_board};
use heyawake_kit::puzzlink::{decode_url, encode_code, encode_url};
use heyawake_kit::search::{count_solutions, count_solutions_from};
use heyawake_kit::solver::{run_all, technique_list, SolveOptions, SolveStatus, TIER_COUNT};
use heyawake_kit::status::Status;

/// 大盤面で解数を数え切れないときは `SOLUTIONS ?` とし、多解と区別する。
const UNIQUENESS_NODES: u64 = 2_000_000;

fn read_problem(source: &str) -> Result<heyawake_kit::board::Board, String> {
    let trimmed = source.trim();
    if trimmed.contains("heyawake/") {
        return decode_url(trimmed);
    }
    let text = std::fs::read_to_string(trimmed)
        .map_err(|error| format!("問題が読めません ({trimmed}): {error}"))?;
    decode_url(text.trim())
}

fn run(args: &[String]) -> Result<i32, String> {
    match args.first().map(String::as_str).unwrap_or("") {
        "show" => {
            let board = read_problem(args.get(1).ok_or("show needs a problem")?)?;
            print!("{}", format_board(&board));
            println!("CODE {}", encode_code(&board));
            println!("URL {}", encode_url(&board));
            Ok(0)
        }
        "solve" => {
            let board = read_problem(args.get(1).ok_or("solve needs a problem")?)?;
            let outcome = run_all(
                &board,
                SolveOptions {
                    no_trial: args.iter().any(|arg| arg == "--no-trial"),
                    tier: args
                        .iter()
                        .position(|arg| arg == "--tier")
                        .and_then(|at| args.get(at + 1))
                        .and_then(|value| value.parse().ok())
                        .unwrap_or(TIER_COUNT),
                    trial_depth: args
                        .iter()
                        .position(|arg| arg == "--depth")
                        .and_then(|at| args.get(at + 1))
                        .and_then(|value| value.parse().ok())
                        .unwrap_or(1),
                    ..SolveOptions::default()
                },
            );
            println!(
                "STATUS {}",
                match outcome.status {
                    SolveStatus::Completed => "COMPLETED",
                    SolveStatus::Stopped => "STOPPED",
                    SolveStatus::Broken => "BROKEN",
                }
            );
            // 健全な演繹で完解したなら一意、破綻なら解なし。探索は手筋切れ時だけ行う。
            let solutions = match outcome.status {
                SolveStatus::Completed => "1".to_string(),
                SolveStatus::Broken => "0".to_string(),
                SolveStatus::Stopped => {
                    let found = count_solutions_from(
                        &board,
                        outcome.answer.clone(),
                        2,
                        UNIQUENESS_NODES,
                    );
                    match (found.solutions.len(), found.aborted) {
                        (0, false) => "0".to_string(),
                        (1, false) => "1".to_string(),
                        (n, _) if n >= 2 => "2+".to_string(),
                        _ => "?".to_string(),
                    }
                }
            };
            let unique = solutions != "2+" && solutions != "0";
            println!("SOLUTIONS {solutions}");
            if unique {
                println!("DP {}", difficulty(&outcome));
                let rating = puzsq_rating_hundredths(difficulty(&outcome));
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
            let mut counts: Vec<_> = outcome.recorder.counts.iter().collect();
            counts.sort_by_key(|(reason, _)| *reason);
            for (reason, count) in counts {
                println!("  {reason} {count}");
            }
            if args.iter().any(|arg| arg == "--breakdown") {
                print!("{}", format_breakdown(&outcome));
            }
            print!("{}", format_answer(&board, &outcome.answer));
            Ok(match outcome.status {
                SolveStatus::Broken => 1,
                SolveStatus::Stopped => 2,
                SolveStatus::Completed => 0,
            })
        }
        "trace" => {
            let board = read_problem(args.get(1).ok_or("trace needs a problem")?)?;
            let mut answer = AnswerModel::new(&board);
            let list = technique_list();
            for pass in 1..=30 {
                let mut moved = false;
                for (name, technique) in &list {
                    let before = answer.unknown_count();
                    let mut methods = AnswerMethods::new(&board, &mut answer, None);
                    let status = technique(&mut methods);
                    let decided = before - answer.unknown_count();
                    if decided > 0 || status == Status::Broken {
                        println!("pass {pass} {name}: {decided} マス確定 ({status:?})");
                        moved = true;
                    }
                    if status == Status::Broken {
                        print!("{}", format_answer(&board, &answer));
                        return Ok(0);
                    }
                }
                if !moved {
                    println!("pass {pass}: 進展なし");
                    break;
                }
            }
            print!("{}", format_answer(&board, &answer));
            Ok(0)
        }
        "answer" => {
            let board = read_problem(args.get(1).ok_or("answer needs a problem")?)?;
            let found = count_solutions(&board, 2, 20_000_000);
            println!("SOLUTIONS {}", found.solutions.len());
            println!("ABORTED {}", if found.aborted { 1 } else { 0 });
            if let Some(answer) = found.solutions.first() {
                print!("{}", format_answer(&board, answer));
            }
            Ok(0)
        }
        _ => Err("usage: heyawake <show|solve|answer|trace> <problem>".into()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(code) => ExitCode::from(code as u8),
        Err(error) => {
            eprintln!("{error}");
            ExitCode::from(1)
        }
    }
}
