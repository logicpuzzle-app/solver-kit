//! nurikabe-kit の CLI。
//!
//! usage: nurikabe <command> [options]
//!   show <problem>   問題を読んで盤面を表示する

use std::process::ExitCode;

use nurikabe_kit::format::format_board;
use nurikabe_kit::difficulty::{difficulty, format_breakdown, puzsq_rating_hundredths};
use nurikabe_kit::format::format_answer;
use nurikabe_kit::puzzlink::{decode_url, encode_code, encode_url};
use nurikabe_kit::search::{count_solutions, count_solutions_from};
use nurikabe_kit::answer_methods::AnswerMethods;
use nurikabe_kit::answer_model::AnswerModel;
use nurikabe_kit::solver::{run_all, technique_list, SolveOptions, SolveStatus};
use nurikabe_kit::status::Status;

fn read_problem(source: &str) -> Result<nurikabe_kit::board::Board, String> {
    let trimmed = source.trim();
    if trimmed.contains("nurikabe/") {
        return decode_url(trimmed);
    }
    let text = std::fs::read_to_string(trimmed)
        .map_err(|e| format!("問題が読めません ({trimmed}): {e}"))?;
    decode_url(text.trim())
}

fn run(args: &[String]) -> Result<i32, String> {
    let command = args.first().map(String::as_str).unwrap_or("");
    match command {
        "show" => {
            let source = args
                .get(1)
                .ok_or_else(|| "show needs a problem".to_string())?;
            let board = read_problem(source)?;
            print!("{}", format_board(&board));
            println!("CODE {}", encode_code(&board));
            println!("URL {}", encode_url(&board));
            Ok(0)
        }
        "solve" => {
            let source = args
                .get(1)
                .ok_or_else(|| "solve needs a problem".to_string())?;
            let board = read_problem(source)?;
            let opts = SolveOptions {
                    no_trial: args.iter().any(|a| a == "--no-trial"),
                    tier: args
                        .iter()
                        .position(|a| a == "--tier")
                        .and_then(|i| args.get(i + 1))
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(nurikabe_kit::solver::TIER_COUNT),
                    trial_depth: if args.iter().any(|a| a == "--shallow") {
                        0
                    } else {
                        args.iter()
                            .position(|a| a == "--depth")
                            .and_then(|i| args.get(i + 1))
                            .and_then(|v| v.parse().ok())
                            .unwrap_or(SolveOptions::default().trial_depth)
                    },
                    ..SolveOptions::default()
            };
            let outcome = run_all(&board, opts);
            println!(
                "STATUS {}",
                match outcome.status {
                    SolveStatus::Completed => "COMPLETED",
                    SolveStatus::Stopped => "STOPPED",
                    SolveStatus::Broken => "BROKEN",
                }
            );
            // 一意解でない問題に難しさは定義できない。
            //
            // 手筋がすべて健全な演繹である以上、**完解できたなら解は一意**
            // (どのマスも他にありえないから確定した)。だから探索が要るのは
            // 手が尽きたときだけで、そこでだけ 2 つめを探す。
            let solutions = match outcome.status {
                SolveStatus::Completed => "1".to_string(),
                SolveStatus::Broken => "0".to_string(),
                SolveStatus::Stopped => {
                    // 手筋の確定はすべて健全な推論なので、どの解も途中盤面を満たす。
                    // よって途中から探索してよく、枝刈りが効いて桁違いに速い。
                    let found = count_solutions_from(&board, &outcome.answer, 2, 5_000_000);
                    match (found.solutions.len(), found.aborted) {
                        (0, false) => "0".to_string(),
                        (1, false) => "1".to_string(),
                        (n, _) if n >= 2 => "2+".to_string(),
                        // 打ち切った。「複数あった」と「数えられなかった」は別の話
                        _ => "?".to_string(),
                    }
                }
            };
            // 「一意でないと分かった」ときだけ難易度を伏せる。
            // 数えきれなかった(`?`)のは、複数あるという証拠ではない。
            // ここを伏せてしまうと、**手が尽きた難問がまるごと較正から消える**
            // ——「手筋では歯が立たなかった」は難しさの最も強い信号なので、
            // それを証拠なしに捨てるのは間違い。
            let unique = solutions != "2+" && solutions != "0";
            println!("SOLUTIONS {solutions}");
            if unique {
                println!("DP {}", difficulty(&outcome));
            } else {
                println!("DP -");
            }
            println!("LEVEL {}", outcome.level);
            println!(
                "RATING {}",
                if unique {
                    format!("{:.2}", f64::from(puzsq_rating_hundredths(difficulty(&outcome))) / 100.0)
                } else {
                    "-".to_string()
                }
            );
            println!("PASSES {}", outcome.passes);
            println!(
                "TRIAL {} {} {} {} {}",
                outcome.stats.deductions,
                outcome.stats.max_depth,
                outcome.stats.pure_unknown,
                outcome.stats.nested_deductions,
                outcome.stats.shallow_unknown
            );
            println!("UNKNOWN {}", outcome.answer.unknown_count());
            let mut counts: Vec<_> = outcome.recorder.counts.iter().collect();
            counts.sort_by_key(|(reason, _)| *reason);
            for (reason, count) in counts {
                println!("  {reason} {count}");
            }
            if args.iter().any(|a| a == "--breakdown") {
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
            // 手筋を 1 つずつ回し、確定したマスを毎回報告する。
            // 手筋を足したときに「誰が何を決めたか / どこで矛盾したか」を追うためのもの。
            let source = args
                .get(1)
                .ok_or_else(|| "trace needs a problem".to_string())?;
            let board = read_problem(source)?;
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
            // 探索で正解を求めて表示する(手詰まり盤面と見比べるため)
            let source = args
                .get(1)
                .ok_or_else(|| "answer needs a problem".to_string())?;
            let board = read_problem(source)?;
            let found = count_solutions(&board, 2, 20_000_000);
            println!("SOLUTIONS {}", found.solutions.len());
            println!("ABORTED {}", if found.aborted { 1 } else { 0 });
            if let Some(answer) = found.solutions.first() {
                print!("{}", format_answer(&board, answer));
            }
            Ok(0)
        }
        _ => Err("usage: nurikabe <show|solve|answer|trace> <problem>".into()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(code) => ExitCode::from(code as u8),
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(1)
        }
    }
}
