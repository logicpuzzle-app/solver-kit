use crate::answer_methods::AnswerMethods;
use crate::answer_model::AnswerModel;
use crate::board::Board;
use crate::engine::EdgeState;
use crate::puzzlink::encode_code;
use crate::random::Rng;
use crate::search::count_solutions;
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

fn board(cols: usize, rows: usize, clues: &[i8]) -> Board {
    Board::new(cols, rows, clues.to_vec()).expect("テスト盤面を作れる")
}

fn set(model: &mut AnswerModel, board: &Board, edge: usize, state: EdgeState) {
    model
        .set_edge(board, edge, state)
        .expect("テストの事前状態を設定できる");
}

type TechniqueFn = for<'a> fn(&mut AnswerMethods<'a>) -> Status;

#[derive(Clone, Copy)]
struct Technique {
    name: &'static str,
    apply: TechniqueFn,
}

fn all_techniques() -> [Technique; 20] {
    [
        Technique {
            name: "cell_exact",
            apply: cell_exact,
        },
        Technique {
            name: "cell_forced",
            apply: cell_forced,
        },
        Technique {
            name: "vertex_close",
            apply: vertex_close,
        },
        Technique {
            name: "vertex_extend",
            apply: vertex_extend,
        },
        Technique {
            name: "vertex_dead",
            apply: vertex_dead,
        },
        Technique {
            name: "zero_cell",
            apply: zero_cell,
        },
        Technique {
            name: "three_pair",
            apply: three_pair,
        },
        Technique {
            name: "three_diagonal",
            apply: three_diagonal,
        },
        Technique {
            name: "three_zero_diagonal",
            apply: three_zero_diagonal,
        },
        Technique {
            name: "three_zero_adjacent",
            apply: three_zero_adjacent,
        },
        Technique {
            name: "corner_clue",
            apply: corner_clue,
        },
        Technique {
            name: "three_incoming",
            apply: three_incoming,
        },
        Technique {
            name: "one_blocked_corner",
            apply: one_blocked_corner,
        },
        Technique {
            name: "two_blocked_corner",
            apply: two_blocked_corner,
        },
        Technique {
            name: "clue_corner_pair",
            apply: clue_corner_pair,
        },
        Technique {
            name: "parity_line",
            apply: parity_line,
        },
        Technique {
            name: "connect_line",
            apply: connect_line,
        },
        Technique {
            name: "no_small_loop",
            apply: no_small_loop,
        },
        Technique {
            name: "inside_outside",
            apply: inside_outside,
        },
        Technique {
            name: "local_pattern",
            apply: local_pattern,
        },
    ]
}

fn random_board(rng: &mut Rng) -> Board {
    let cols = 2 + rng.next_int(3);
    let rows = 2 + rng.next_int(3);
    let clues: Vec<i8> = (0..cols * rows)
        .map(|_| {
            if rng.next_int(100) < 60 {
                -1
            } else {
                rng.next_int(4) as i8
            }
        })
        .collect();
    board(cols, rows, &clues)
}

fn complete_solutions(board: &Board) -> Option<Vec<Vec<EdgeState>>> {
    const SOLUTION_LIMIT: usize = 200;

    let counted = count_solutions(board, SOLUTION_LIMIT, 0);
    if counted.aborted
        || counted.solutions.is_empty()
        || counted.solutions.len() == SOLUTION_LIMIT
    {
        None
    } else {
        Some(counted.solutions)
    }
}

fn edge_label(board: &Board, edge: usize) -> String {
    if edge < board.horizontal_edge_count() {
        let x = edge % board.cols;
        let y = edge / board.cols;
        format!("H({x},{y})")
    } else {
        let offset = edge - board.horizontal_edge_count();
        let x = offset % (board.cols + 1);
        let y = offset / (board.cols + 1);
        format!("V({x},{y})")
    }
}

fn state_label(state: EdgeState) -> &'static str {
    match state {
        EdgeState::Unknown => "?",
        EdgeState::Line => "Line",
        EdgeState::Cross => "Cross",
    }
}

fn known_edges_label(board: &Board, states: &[EdgeState]) -> String {
    let labels: Vec<_> = states
        .iter()
        .enumerate()
        .filter(|(_, state)| **state != EdgeState::Unknown)
        .map(|(edge, &state)| {
            format!(
                "{}={}",
                edge_label(board, edge),
                state_label(state)
            )
        })
        .collect();
    format!("[{}]", labels.join(", "))
}

fn solution_matches(states: &[EdgeState], solution: &[EdgeState]) -> bool {
    states
        .iter()
        .zip(solution)
        .all(|(&state, &solved)| {
            state == EdgeState::Unknown || state == solved
        })
}

fn check_technique_soundness(
    technique: Technique,
    board: &Board,
    solutions: &[Vec<EdgeState>],
    initial: &[EdgeState],
    case_index: usize,
) -> usize {
    let mut model = AnswerModel::new(board);
    for (edge, &state) in initial.iter().enumerate() {
        if state != EdgeState::Unknown {
            set(&mut model, board, edge, state);
        }
    }
    let before = model.edges().to_vec();
    let compatible: Vec<_> = solutions
        .iter()
        .filter(|solution| solution_matches(&before, solution))
        .collect();
    assert!(
        !compatible.is_empty(),
        "途中状態は選択した解と必ず整合する"
    );

    let status =
        (technique.apply)(&mut AnswerMethods::new(board, &mut model, None));
    let reproduction = format!(
        "手筋={}, case={}, code={}, cols={}, rows={}, clues={:?}, initial={}",
        technique.name,
        case_index,
        encode_code(board),
        board.cols,
        board.rows,
        board.clues,
        known_edges_label(board, &before),
    );
    assert_ne!(
        status,
        Status::Broken,
        "解が{}個残る状態で Broken を返した: {}",
        compatible.len(),
        reproduction
    );

    let mut fixed = 0;
    for (edge, (&old_state, &new_state)) in
        before.iter().zip(model.edges()).enumerate()
    {
        if old_state != EdgeState::Unknown
            || new_state == EdgeState::Unknown
        {
            continue;
        }
        fixed += 1;
        if let Some(solution) = compatible
            .iter()
            .find(|solution| solution[edge] != new_state)
        {
            panic!(
                "健全性違反: {}, edge={} (id={}) を {} に確定したが、\
                 整合解では {}: solution={}",
                reproduction,
                edge_label(board, edge),
                edge,
                state_label(new_state),
                state_label(solution[edge]),
                known_edges_label(board, solution),
            );
        }
    }
    fixed
}

fn random_partial_state(
    rng: &mut Rng,
    solution: &[EdgeState],
) -> Vec<EdgeState> {
    let reveal_percent = 30 + rng.next_int(31);
    solution
        .iter()
        .map(|&state| {
            if rng.next_int(100) < reveal_percent {
                state
            } else {
                EdgeState::Unknown
            }
        })
        .collect()
}

#[test]
fn zero_cell_marks_four_crosses() {
    let board = board(1, 1, &[0]);
    let mut model = AnswerModel::new(&board);
    let status = zero_cell(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    assert!(model
        .edges()
        .iter()
        .all(|&state| state == EdgeState::Cross));
}

#[test]
fn adjacent_threes_fix_shared_and_outer_edges() {
    let board = board(3, 2, &[3, 3, 0, -1, -1, -1]);
    let mut model = AnswerModel::new(&board);
    let status = three_pair(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    for edge in [board.v_id(0, 0), board.v_id(1, 0), board.v_id(2, 0)] {
        assert_eq!(model.edge(edge), EdgeState::Line);
    }
    assert_eq!(model.edge(board.v_id(1, 1)), EdgeState::Cross);
}

#[test]
fn isolated_adjacent_threes_always_fix_outer_edges() {
    let mut horizontal_clues = vec![-1; 36];
    horizontal_clues[2 * 6 + 2] = 3;
    horizontal_clues[2 * 6 + 3] = 3;
    let horizontal = board(6, 6, &horizontal_clues);
    let mut horizontal_model = AnswerModel::new(&horizontal);
    assert_eq!(
        three_pair(&mut AnswerMethods::new(
            &horizontal,
            &mut horizontal_model,
            None
        )),
        Status::Advanced
    );
    assert_eq!(
        horizontal_model.edge(horizontal.v_id(2, 2)),
        EdgeState::Line
    );
    assert_eq!(
        horizontal_model.edge(horizontal.v_id(4, 2)),
        EdgeState::Line
    );
    // 2セルを囲む長方形が完成解になれるため、共有辺とその延長は未確定のまま。
    for edge in [
        horizontal.v_id(3, 2),
        horizontal.v_id(3, 1),
        horizontal.v_id(3, 3),
    ] {
        assert_eq!(horizontal_model.edge(edge), EdgeState::Unknown);
    }

    let mut vertical_clues = vec![-1; 36];
    vertical_clues[2 * 6 + 2] = 3;
    vertical_clues[3 * 6 + 2] = 3;
    let vertical = board(6, 6, &vertical_clues);
    let mut vertical_model = AnswerModel::new(&vertical);
    assert_eq!(
        three_pair(&mut AnswerMethods::new(
            &vertical,
            &mut vertical_model,
            None
        )),
        Status::Advanced
    );
    assert_eq!(
        vertical_model.edge(vertical.h_id(2, 2)),
        EdgeState::Line
    );
    assert_eq!(
        vertical_model.edge(vertical.h_id(2, 4)),
        EdgeState::Line
    );
    for edge in [
        vertical.h_id(2, 3),
        vertical.h_id(1, 3),
        vertical.h_id(3, 3),
    ] {
        assert_eq!(vertical_model.edge(edge), EdgeState::Unknown);
    }
}

#[test]
fn diagonal_threes_fix_four_far_edges() {
    let board = board(2, 2, &[3, -1, -1, 3]);
    let mut model = AnswerModel::new(&board);
    let status =
        three_diagonal(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    for edge in [
        board.h_id(0, 0),
        board.v_id(0, 0),
        board.h_id(1, 2),
        board.v_id(2, 1),
    ] {
        assert_eq!(model.edge(edge), EdgeState::Line);
    }
}

#[test]
fn local_pattern_rejects_an_existing_opposite_edge() {
    let board = board(3, 3, &[-1, 3, -1, -1, 3, -1, -1, -1, -1]);
    let mut discovered = AnswerModel::new(&board);
    assert_eq!(
        local_pattern(&mut AnswerMethods::new(&board, &mut discovered, None)),
        Status::Advanced
    );
    let (edge, state) = discovered
        .edges()
        .iter()
        .copied()
        .enumerate()
        .find(|(_, state)| *state != EdgeState::Unknown)
        .expect("既知の局所パターンは少なくとも1辺を確定する");
    let opposite = match state {
        EdgeState::Line => EdgeState::Cross,
        EdgeState::Cross => EdgeState::Line,
        EdgeState::Unknown => unreachable!("確定辺だけを選んだ"),
    };
    let mut conflicting = AnswerModel::new(&board);
    set(&mut conflicting, &board, edge, opposite);
    assert_eq!(
        local_pattern(&mut AnswerMethods::new(
            &board,
            &mut conflicting,
            None
        )),
        Status::Broken
    );
}

#[test]
fn inside_outside_fixes_edges_from_remote_cell_relations() {
    let board = board(2, 1, &[-1; 2]);

    let mut same_model = AnswerModel::new(&board);
    set(
        &mut same_model,
        &board,
        board.h_id(0, 0),
        EdgeState::Line,
    );
    set(
        &mut same_model,
        &board,
        board.h_id(1, 0),
        EdgeState::Line,
    );
    assert_eq!(
        inside_outside(&mut AnswerMethods::new(&board, &mut same_model, None)),
        Status::Advanced
    );
    assert_eq!(same_model.edge(board.v_id(1, 0)), EdgeState::Cross);

    let mut different_model = AnswerModel::new(&board);
    set(
        &mut different_model,
        &board,
        board.h_id(0, 0),
        EdgeState::Line,
    );
    set(
        &mut different_model,
        &board,
        board.h_id(1, 0),
        EdgeState::Cross,
    );
    assert_eq!(
        inside_outside(&mut AnswerMethods::new(
            &board,
            &mut different_model,
            None
        )),
        Status::Advanced
    );
    assert_eq!(different_model.edge(board.v_id(1, 0)), EdgeState::Line);
}

#[test]
fn inside_outside_detects_conflicting_edge_relations() {
    let board = board(1, 1, &[-1]);
    let mut model = AnswerModel::new(&board);
    set(&mut model, &board, board.h_id(0, 0), EdgeState::Line);
    set(&mut model, &board, board.h_id(0, 1), EdgeState::Cross);
    assert_eq!(
        inside_outside(&mut AnswerMethods::new(&board, &mut model, None)),
        Status::Broken
    );
}

#[test]
fn diagonal_three_comparison_documents_missing_clue_relation_rule() {
    use crate::search::count_solutions;

    let board = board(2, 2, &[3, -1, -1, 3]);
    let expected = [
        board.h_id(0, 0),
        board.v_id(0, 0),
        board.h_id(1, 2),
        board.v_id(2, 1),
    ];
    let counted = count_solutions(&board, 10, 0);
    assert!(!counted.aborted);
    assert!(!counted.solutions.is_empty());
    for solution in &counted.solutions {
        for &edge in &expected {
            assert_eq!(solution[edge], EdgeState::Line);
        }
    }

    let mut standard_model = AnswerModel::new(&board);
    assert_eq!(
        three_diagonal(&mut AnswerMethods::new(
            &board,
            &mut standard_model,
            None
        )),
        Status::Advanced
    );
    for &edge in &expected {
        assert_eq!(standard_model.edge(edge), EdgeState::Line);
    }

    let mut relation_only_model = AnswerModel::new(&board);
    // 指定された内外手筋は確定辺だけを関係へ取り込むため、初期状態では
    // 3の個数制約が関係にならず、格子点推論を始める材料がない。
    assert_eq!(
        inside_outside(&mut AnswerMethods::new(
            &board,
            &mut relation_only_model,
            None
        )),
        Status::Stopped
    );
    for &edge in &expected {
        assert_eq!(relation_only_model.edge(edge), EdgeState::Unknown);
    }
}

#[test]
fn diagonal_three_zero_fixes_shared_corner_pair() {
    let board = board(2, 2, &[3, -1, -1, 0]);
    let mut model = AnswerModel::new(&board);
    let status =
        three_zero_diagonal(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    assert_eq!(model.edge(board.h_id(0, 1)), EdgeState::Line);
    assert_eq!(model.edge(board.v_id(1, 0)), EdgeState::Line);
}

#[test]
fn adjacent_three_zero_fixes_all_four_shared_constraints() {
    let board = board(2, 1, &[3, 0]);
    let mut model = AnswerModel::new(&board);
    let status =
        three_zero_adjacent(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    assert_eq!(model.edge(board.v_id(1, 0)), EdgeState::Cross);
    for edge in [board.h_id(0, 0), board.h_id(0, 1), board.v_id(0, 0)] {
        assert_eq!(model.edge(edge), EdgeState::Line);
    }
}

#[test]
fn corner_one_blocks_the_corner() {
    let board = board(2, 2, &[1, -1, -1, -1]);
    let mut model = AnswerModel::new(&board);
    let status = corner_clue(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    assert_eq!(model.edge(board.h_id(0, 0)), EdgeState::Cross);
    assert_eq!(model.edge(board.v_id(0, 0)), EdgeState::Cross);
}

#[test]
fn incoming_line_at_three_fixes_far_pair() {
    let board = board(3, 3, &[-1, -1, -1, -1, 3, -1, -1, -1, -1]);
    let mut model = AnswerModel::new(&board);
    set(&mut model, &board, board.h_id(0, 1), EdgeState::Line);
    let status =
        three_incoming(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    assert_eq!(model.edge(board.h_id(1, 2)), EdgeState::Line);
    assert_eq!(model.edge(board.v_id(2, 1)), EdgeState::Line);
}

#[test]
fn blocked_corner_at_one_blocks_cell_pair() {
    let board = board(3, 3, &[-1, -1, -1, -1, 1, -1, -1, -1, -1]);
    let mut model = AnswerModel::new(&board);
    set(&mut model, &board, board.h_id(0, 1), EdgeState::Cross);
    set(&mut model, &board, board.v_id(1, 0), EdgeState::Cross);
    let status =
        one_blocked_corner(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    assert_eq!(model.edge(board.h_id(1, 1)), EdgeState::Cross);
    assert_eq!(model.edge(board.v_id(1, 1)), EdgeState::Cross);
}

#[test]
fn blocked_corner_at_two_copies_far_edge() {
    let board = board(3, 3, &[-1, -1, -1, -1, 2, -1, -1, -1, -1]);
    let mut model = AnswerModel::new(&board);
    set(&mut model, &board, board.h_id(0, 1), EdgeState::Cross);
    set(&mut model, &board, board.v_id(1, 0), EdgeState::Cross);
    set(&mut model, &board, board.h_id(1, 2), EdgeState::Line);
    let status =
        two_blocked_corner(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    assert_eq!(model.edge(board.v_id(2, 1)), EdgeState::Line);
}

#[test]
fn general_corner_enumeration_finds_blocked_one() {
    let board = board(3, 3, &[-1, -1, -1, -1, 1, -1, -1, -1, -1]);
    let mut model = AnswerModel::new(&board);
    set(&mut model, &board, board.h_id(0, 1), EdgeState::Cross);
    set(&mut model, &board, board.v_id(1, 0), EdgeState::Cross);
    let status =
        clue_corner_pair(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    assert_eq!(model.edge(board.h_id(1, 1)), EdgeState::Cross);
    assert_eq!(model.edge(board.v_id(1, 1)), EdgeState::Cross);
}

#[test]
fn exact_and_forced_cell_rules_fix_remaining_edges() {
    let exact_board = board(2, 2, &[1, -1, -1, -1]);
    let mut exact_model = AnswerModel::new(&exact_board);
    set(
        &mut exact_model,
        &exact_board,
        exact_board.h_id(0, 0),
        EdgeState::Line,
    );
    assert_eq!(
        cell_exact(&mut AnswerMethods::new(
            &exact_board,
            &mut exact_model,
            None
        )),
        Status::Advanced
    );
    assert_eq!(
        exact_model.edge(exact_board.h_id(0, 1)),
        EdgeState::Cross
    );

    let forced_board = board(2, 2, &[3, -1, -1, -1]);
    let mut forced_model = AnswerModel::new(&forced_board);
    set(
        &mut forced_model,
        &forced_board,
        forced_board.h_id(0, 0),
        EdgeState::Cross,
    );
    assert_eq!(
        cell_forced(&mut AnswerMethods::new(
            &forced_board,
            &mut forced_model,
            None
        )),
        Status::Advanced
    );
    assert_eq!(
        forced_model.edge(forced_board.h_id(0, 1)),
        EdgeState::Line
    );
}

#[test]
fn vertex_rules_close_extend_and_kill() {
    let board = board(2, 2, &[-1; 4]);

    let mut close_model = AnswerModel::new(&board);
    set(&mut close_model, &board, board.h_id(0, 1), EdgeState::Line);
    set(&mut close_model, &board, board.v_id(1, 0), EdgeState::Line);
    assert_eq!(
        vertex_close(&mut AnswerMethods::new(&board, &mut close_model, None)),
        Status::Advanced
    );
    assert_eq!(close_model.edge(board.h_id(1, 1)), EdgeState::Cross);

    let mut extend_model = AnswerModel::new(&board);
    set(&mut extend_model, &board, board.h_id(0, 1), EdgeState::Line);
    set(&mut extend_model, &board, board.v_id(1, 0), EdgeState::Cross);
    set(&mut extend_model, &board, board.h_id(1, 1), EdgeState::Cross);
    assert_eq!(
        vertex_extend(&mut AnswerMethods::new(
            &board,
            &mut extend_model,
            None
        )),
        Status::Advanced
    );
    assert_eq!(extend_model.edge(board.v_id(1, 1)), EdgeState::Line);

    let mut dead_model = AnswerModel::new(&board);
    set(&mut dead_model, &board, board.h_id(0, 1), EdgeState::Cross);
    set(&mut dead_model, &board, board.v_id(1, 0), EdgeState::Cross);
    set(&mut dead_model, &board, board.h_id(1, 1), EdgeState::Cross);
    assert_eq!(
        vertex_dead(&mut AnswerMethods::new(&board, &mut dead_model, None)),
        Status::Advanced
    );
    assert_eq!(dead_model.edge(board.v_id(1, 1)), EdgeState::Cross);
}

#[test]
fn parity_fixes_last_crossing_edge() {
    let board = board(2, 1, &[-1; 2]);
    let mut model = AnswerModel::new(&board);
    set(&mut model, &board, board.h_id(0, 0), EdgeState::Line);
    let status =
        parity_line(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    assert_eq!(model.edge(board.h_id(0, 1)), EdgeState::Line);
}

#[test]
fn connectivity_fixes_unique_bridge() {
    let board = board(2, 1, &[-1; 2]);
    let mut model = AnswerModel::new(&board);
    set(&mut model, &board, board.v_id(0, 0), EdgeState::Line);
    set(&mut model, &board, board.v_id(2, 0), EdgeState::Line);
    set(&mut model, &board, board.h_id(0, 1), EdgeState::Cross);
    set(&mut model, &board, board.h_id(1, 1), EdgeState::Cross);
    let status =
        connect_line(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    assert_eq!(model.edge(board.h_id(0, 0)), EdgeState::Line);
    assert_eq!(model.edge(board.h_id(1, 0)), EdgeState::Line);
}

#[test]
fn premature_cell_loop_is_crossed_when_another_clue_needs_line() {
    let board = board(2, 2, &[-1, -1, -1, 3]);
    let mut model = AnswerModel::new(&board);
    set(&mut model, &board, board.h_id(0, 0), EdgeState::Line);
    set(&mut model, &board, board.v_id(0, 0), EdgeState::Line);
    set(&mut model, &board, board.h_id(0, 1), EdgeState::Line);
    let status =
        no_small_loop(&mut AnswerMethods::new(&board, &mut model, None));
    assert_eq!(status, Status::Advanced);
    assert_eq!(model.edge(board.v_id(1, 0)), EdgeState::Cross);
}

#[test]
fn random_boards_keep_every_technique_sound_from_empty_state() {
    const BOARD_COUNT: usize = 300;
    const MAX_ATTEMPTS: usize = 10_000;

    let techniques = all_techniques();
    let mut rng = Rng::new(0x5a17_2026);
    let mut accepted = 0;
    for attempt in 0..MAX_ATTEMPTS {
        let candidate = random_board(&mut rng);
        let Some(solutions) = complete_solutions(&candidate) else {
            continue;
        };
        let initial = vec![EdgeState::Unknown; candidate.edge_count()];
        for technique in techniques {
            check_technique_soundness(
                technique,
                &candidate,
                &solutions,
                &initial,
                accepted,
            );
        }
        accepted += 1;
        if accepted == BOARD_COUNT {
            break;
        }
        assert!(
            attempt + 1 < MAX_ATTEMPTS,
            "全解を列挙できる有解盤面を {BOARD_COUNT} 個採用できなかった"
        );
    }
    assert_eq!(
        accepted, BOARD_COUNT,
        "全解を列挙できる有解盤面を十分に採用できなかった"
    );
}

#[test]
fn random_partial_states_keep_every_technique_sound_and_firing() {
    const BOARD_COUNT: usize = 300;
    const MAX_ATTEMPTS: usize = 10_000;

    let techniques = all_techniques();
    let mut fired = vec![0usize; techniques.len()];
    let mut rng = Rng::new(0x71d6_2026);
    let mut accepted = 0;
    for attempt in 0..MAX_ATTEMPTS {
        let candidate = random_board(&mut rng);
        let Some(solutions) = complete_solutions(&candidate) else {
            continue;
        };
        for (technique_index, technique) in
            techniques.iter().copied().enumerate()
        {
            let solution = &solutions[rng.next_int(solutions.len())];
            let initial = random_partial_state(&mut rng, solution);
            let fixed = check_technique_soundness(
                technique,
                &candidate,
                &solutions,
                &initial,
                accepted,
            );
            if fixed > 0 {
                fired[technique_index] += 1;
            }
        }
        accepted += 1;
        if accepted == BOARD_COUNT {
            break;
        }
        assert!(
            attempt + 1 < MAX_ATTEMPTS,
            "全解を列挙できる有解盤面を {BOARD_COUNT} 個採用できなかった"
        );
    }
    assert_eq!(
        accepted, BOARD_COUNT,
        "全解を列挙できる有解盤面を十分に採用できなかった"
    );
    for (technique, &count) in techniques.iter().zip(&fired) {
        if technique.name == "connect_line" {
            // 完成解の閉路が非Cross辺グラフに残るため、その閉路上の辺は
            // 橋にならず、解と整合する途中状態ではこの手筋は発火しない。
            assert_eq!(
                count, 0,
                "connect_line が解と整合する途中状態で発火した"
            );
        } else {
            assert!(
                count > 0,
                "{} が途中状態の健全性検査で一度も発火しなかった; \
                 発火回数={:?}",
                technique.name,
                fired
            );
        }
    }
}
