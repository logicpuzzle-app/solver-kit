use crate::answer_methods::{merge_status, AnswerMethods, Recorder};
use crate::answer_model::AnswerModel;
use crate::board::{Board, EdgeId};
use crate::engine::EdgeState;
use crate::reasons::{TRIAL_ANY_CASE, TRIAL_CONTRADICTION};
use crate::solution::validate_solution;
use crate::status::Status;
use crate::techniques::cell_exact::cell_exact;
use crate::techniques::cell_forced::cell_forced;
use crate::techniques::clue_corner_pair::clue_corner_pair;
use crate::techniques::connect_line::connect_line;
use crate::techniques::corner_clue::corner_clue;
use crate::techniques::inside_outside::inside_outside;
use crate::techniques::local_pattern::local_pattern;
use crate::techniques::no_small_loop::no_small_loop;
use crate::techniques::one_blocked_corner::one_blocked_corner;
use crate::techniques::parity_line::parity_line;
use crate::techniques::three_diagonal::three_diagonal;
use crate::techniques::three_incoming::three_incoming;
use crate::techniques::three_pair::three_pair;
use crate::techniques::three_zero_adjacent::three_zero_adjacent;
use crate::techniques::three_zero_diagonal::three_zero_diagonal;
use crate::techniques::two_blocked_corner::two_blocked_corner;
use crate::techniques::vertex_close::vertex_close;
use crate::techniques::vertex_dead::vertex_dead;
use crate::techniques::vertex_extend::vertex_extend;
use crate::techniques::zero_cell::zero_cell;

#[derive(Clone, Debug, Default)]
pub struct TrialStats {
    pub trial_deductions: i32,
    pub max_trial_count: i32,
    pub passes: i32,
}

/// 一巡の中では具体的な定石を先に適用し、難易度理由が一般則に
/// 吸収されないようにする。いずれも健全な推論なので順序は解を変えない。
pub fn solve(answer: &mut AnswerMethods<'_>) -> Status {
    let techniques: [fn(&mut AnswerMethods<'_>) -> Status; 19] = [
        three_pair,
        three_diagonal,
        three_zero_diagonal,
        three_zero_adjacent,
        corner_clue,
        three_incoming,
        one_blocked_corner,
        two_blocked_corner,
        zero_cell,
        cell_exact,
        cell_forced,
        vertex_close,
        vertex_extend,
        vertex_dead,
        clue_corner_pair,
        no_small_loop,
        // 内外関係の全盤走査は重いため、局所手筋が済んでから適用する。
        inside_outside,
        parity_line,
        connect_line,
    ];
    let mut result = Status::Stopped;
    for technique in techniques {
        result = merge_status(result, technique(answer));
        if result == Status::Broken {
            return result;
        }
    }
    result
}

fn final_status(board: &Board, model: &AnswerModel, propagated: Status) -> Status {
    if propagated == Status::Broken {
        return Status::Broken;
    }
    if model
        .edges()
        .iter()
        .all(|&state| state != EdgeState::Unknown)
    {
        if validate_solution(board, model.edges()).is_empty() {
            Status::Stopped
        } else {
            Status::Broken
        }
    } else {
        propagated
    }
}

fn propagate_trial(
    board: &Board,
    model: &mut AnswerModel,
    pass_limit: i32,
) -> (Status, i32) {
    let mut count = 0;
    loop {
        count += 1;
        let mut methods = AnswerMethods::new(board, model, None);
        let propagated = solve(&mut methods);
        let status = final_status(board, methods.answer, propagated);
        if status != Status::Advanced {
            return (status, count);
        }
        if pass_limit > 0 && count >= pass_limit {
            return (Status::Stopped, count);
        }
    }
}

#[derive(Clone, Copy)]
struct TrialDeduction {
    edge: EdgeId,
    state: EdgeState,
    reason: &'static str,
    count: i32,
}

fn remember(
    deductions: &mut Vec<TrialDeduction>,
    edge: EdgeId,
    state: EdgeState,
    reason: &'static str,
    count: i32,
) -> Result<(), ()> {
    if let Some(previous) = deductions
        .iter_mut()
        .find(|deduction| deduction.edge == edge)
    {
        if previous.state != state {
            return Err(());
        }
        if count < previous.count {
            previous.count = count;
            previous.reason = reason;
        }
        return Ok(());
    }
    deductions.push(TrialDeduction {
        edge,
        state,
        reason,
        count,
    });
    Ok(())
}

fn try_solve(
    answer: &mut AnswerMethods<'_>,
    stats: &mut TrialStats,
    candidate_limit: usize,
) -> Status {
    let mut unknown: Vec<_> = answer
        .answer
        .edges()
        .iter()
        .enumerate()
        .filter_map(|(edge, &state)| {
            (state == EdgeState::Unknown).then_some(edge)
        })
        .collect();
    if candidate_limit > 0 {
        unknown.truncate(candidate_limit);
    }
    let mut deductions = Vec::new();
    let mut shallowest = 0;

    for edge in unknown {
        let mut line_model = answer.answer.clone_for_trial();
        if line_model
            .set_edge(answer.board, edge, EdgeState::Line)
            .is_err()
        {
            return Status::Broken;
        }
        let (line_status, line_count) =
            propagate_trial(answer.board, &mut line_model, shallowest);
        // 両仮定の比較に必要なのは辺状態だけである。大型盤面で二つの
        // union-find 付きモデルを同時保持しないよう、Line側を先に解放する。
        let line_states = line_model.edges().to_vec();
        drop(line_model);

        let mut cross_model = answer.answer.clone_for_trial();
        if cross_model
            .set_edge(answer.board, edge, EdgeState::Cross)
            .is_err()
        {
            return Status::Broken;
        }
        let (cross_status, cross_count) =
            propagate_trial(answer.board, &mut cross_model, shallowest);

        match (line_status, cross_status) {
            (Status::Broken, Status::Broken) => return Status::Broken,
            (Status::Broken, _) => {
                if remember(
                    &mut deductions,
                    edge,
                    EdgeState::Cross,
                    TRIAL_CONTRADICTION,
                    line_count,
                )
                .is_err()
                {
                    return Status::Broken;
                }
                shallowest = if shallowest == 0 {
                    line_count
                } else {
                    shallowest.min(line_count)
                };
            }
            (_, Status::Broken) => {
                if remember(
                    &mut deductions,
                    edge,
                    EdgeState::Line,
                    TRIAL_CONTRADICTION,
                    cross_count,
                )
                .is_err()
                {
                    return Status::Broken;
                }
                shallowest = if shallowest == 0 {
                    cross_count
                } else {
                    shallowest.min(cross_count)
                };
            }
            _ => {
                let count = line_count.max(cross_count);
                for candidate in 0..answer.board.edge_count() {
                    if answer.edge(candidate) != EdgeState::Unknown {
                        continue;
                    }
                    let line_state = line_states[candidate];
                    if line_state != EdgeState::Unknown
                        && line_state == cross_model.edge(candidate)
                    {
                        if remember(
                            &mut deductions,
                            candidate,
                            line_state,
                            TRIAL_ANY_CASE,
                            count,
                        )
                        .is_err()
                        {
                            return Status::Broken;
                        }
                        shallowest = if shallowest == 0 {
                            count
                        } else {
                            shallowest.min(count)
                        };
                    }
                }
            }
        }
    }

    let Some(min_count) = deductions.iter().map(|deduction| deduction.count).min()
    else {
        return Status::Stopped;
    };
    let mut result = Status::Stopped;
    for deduction in deductions
        .into_iter()
        .filter(|deduction| deduction.count == min_count)
    {
        let status = answer.set_edge(
            deduction.edge,
            deduction.state,
            deduction.reason,
        );
        if status == Status::Advanced {
            stats.trial_deductions += 1;
            stats.max_trial_count = stats.max_trial_count.max(deduction.count);
        }
        result = merge_status(result, status);
        if result == Status::Broken {
            return result;
        }
    }
    result
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SolveStatus {
    Completed,
    Stopped,
    Broken,
}

pub struct SolveOutcome {
    pub status: SolveStatus,
    pub answer: AnswerModel,
    pub recorder: Recorder,
    pub stats: TrialStats,
}

pub struct SolveOptions {
    pub no_trial: bool,
    pub max_passes: i32,
    pub no_local_pattern: bool,
}

pub fn run_all(
    board: &Board,
    initial: Option<AnswerModel>,
    options: SolveOptions,
) -> SolveOutcome {
    run_all_with_trial_limit(board, initial, options, 0)
}

pub fn run_all_with_trial_limit(
    board: &Board,
    initial: Option<AnswerModel>,
    options: SolveOptions,
    trial_candidate_limit: usize,
) -> SolveOutcome {
    let mut answer = initial.unwrap_or_else(|| AnswerModel::new(board));
    let mut recorder = Recorder::default();
    let mut stats = TrialStats::default();
    let mut status = if options.no_local_pattern {
        Status::Advanced
    } else {
        let mut methods =
            AnswerMethods::new(board, &mut answer, Some(&mut recorder));
        match local_pattern(&mut methods) {
            Status::Broken => Status::Broken,
            // 局所表の確定有無にかかわらず、通常手筋を最低一巡させる。
            Status::Advanced | Status::Stopped => Status::Advanced,
        }
    };
    while status == Status::Advanced {
        stats.passes += 1;
        let mut methods =
            AnswerMethods::new(board, &mut answer, Some(&mut recorder));
        let propagated = solve(&mut methods);
        status = final_status(board, methods.answer, propagated);
        let complete = methods
            .answer
            .edges()
            .iter()
            .all(|&state| state != EdgeState::Unknown)
            && validate_solution(board, methods.answer.edges()).is_empty();
        if status == Status::Stopped && !complete && !options.no_trial {
            status =
                try_solve(&mut methods, &mut stats, trial_candidate_limit);
        }
        if options.max_passes > 0 && stats.passes >= options.max_passes {
            break;
        }
    }
    let complete = answer
        .edges()
        .iter()
        .all(|&state| state != EdgeState::Unknown)
        && validate_solution(board, answer.edges()).is_empty();
    let final_status = if status == Status::Broken {
        SolveStatus::Broken
    } else if complete {
        SolveStatus::Completed
    } else {
        SolveStatus::Stopped
    };
    SolveOutcome {
        status: final_status,
        answer,
        recorder,
        stats,
    }
}

impl Default for SolveOptions {
    fn default() -> Self {
        Self {
            no_trial: false,
            max_passes: 0,
            no_local_pattern: false,
        }
    }
}
