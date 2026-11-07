pub mod answer_methods;
pub mod answer_model;
pub mod board;
pub mod calibrate;
pub mod difficulty;
pub mod engine;
pub mod format;
pub mod generator;
pub mod ordered;
pub mod parity_union_find;
pub mod position;
pub mod puzzlink;
pub mod random;
pub mod reasons;
pub mod search;
pub mod solution;
pub mod solver;
pub mod status;
pub mod techniques;
pub mod unionfind;

#[cfg(test)]
mod tests {
    use crate::answer_methods::AnswerMethods;
    use crate::answer_model::AnswerModel;
    use crate::engine::EdgeState;
    use crate::puzzlink::{decode_url, encode_code};
    use crate::search::count_solutions;
    use crate::solution::validate_solution;
    use crate::solver::{run_all, SolveOptions, SolveStatus};
    use crate::status::Status;
    use crate::techniques::local_pattern::local_pattern;

    const LARGE: &str =
        "slither/10/10/bda7d2dcgbhdbbb6d3abdgd8bbbcdhdgc3d7cdcc";
    const SMALL: &str = "slither/5/5/cbcbcddad";

    #[test]
    fn puzzlink_round_trip_preserves_board() {
        for code in [LARGE, SMALL] {
            let board = decode_url(code).expect("デコードに成功する");
            let encoded = encode_code(&board);
            let decoded = decode_url(&encoded).expect("再デコードに成功する");
            assert_eq!(decoded, board);
        }

        let board = decode_url("slither/3/1/0").expect("短い本体をデコードできる");
        let encoded = encode_code(&board);
        let decoded = decode_url(&encoded).expect("正規化後に再デコードできる");
        assert_eq!(decoded, board);
        assert_ne!(encoded, "slither/3/1/0");
    }

    #[test]
    fn canonical_puzzlink_codes_round_trip_exactly() {
        for code in [LARGE, SMALL] {
            let board = decode_url(code).expect("デコードに成功する");
            assert_eq!(encode_code(&board), code);
        }
    }

    #[test]
    fn short_body_leaves_trailing_cells_empty() {
        let board = decode_url("slither/3/1/0").expect("短い本体をデコードできる");
        assert_eq!(board.clues, vec![0, -1, -1]);
    }

    #[test]
    fn data_after_last_cell_is_ignored() {
        let board =
            decode_url("slither/1/1/0invalid").expect("盤面末尾より後のデータは無視される");
        assert_eq!(board.clues, vec![0]);
    }

    #[test]
    fn small_problem_clues() {
        let board = decode_url(SMALL).expect("デコードに成功する");
        assert_eq!((board.cols, board.rows), (5, 5));
        let rows: Vec<Vec<i8>> = board.clues.chunks(5).map(<[i8]>::to_vec).collect();
        assert_eq!(
            rows,
            vec![
                vec![2, -1, -1, 1, -1],
                vec![-1, 2, -1, -1, 1],
                vec![-1, -1, 2, -1, -1],
                vec![3, -1, -1, 3, -1],
                vec![-1, 0, -1, -1, 3],
            ]
        );
    }

    #[test]
    fn small_problem_has_expected_unique_solution() {
        let board = decode_url(SMALL).expect("デコードに成功する");
        let result = count_solutions(&board, 2, 0);
        assert!(!result.aborted, "{SMALL} の探索が打ち切られた");
        assert_eq!(result.solutions.len(), 1, "{SMALL} が一意でない");

        let mut expected = vec![EdgeState::Cross; board.edge_count()];
        for (y, xs) in [
            (0, &[0, 1, 2, 3, 4][..]),
            (1, &[1, 2][..]),
            (2, &[2][..]),
            (3, &[3][..]),
            (4, &[0, 2][..]),
            (5, &[4][..]),
        ] {
            for &x in xs {
                expected[board.h_id(x, y)] = EdgeState::Line;
            }
        }
        for (y, xs) in [
            (0, &[0, 5][..]),
            (1, &[0, 1, 3, 5][..]),
            (2, &[0, 1, 2, 5][..]),
            (3, &[0, 1, 2, 3, 4, 5][..]),
            (4, &[4, 5][..]),
        ] {
            for &x in xs {
                expected[board.v_id(x, y)] = EdgeState::Line;
            }
        }

        assert_eq!(result.solutions[0], expected);
        assert!(validate_solution(&board, &result.solutions[0]).is_empty());
    }

    #[test]
    fn large_problem_has_one_valid_solution() {
        let board = decode_url(LARGE).expect("デコードに成功する");
        let result = count_solutions(&board, 2, 0);
        assert!(!result.aborted, "{LARGE} の探索が打ち切られた");
        assert_eq!(result.solutions.len(), 1, "{LARGE} が一意でない");
        assert!(validate_solution(&board, &result.solutions[0]).is_empty());
    }

    #[test]
    fn technique_solver_agrees_with_constraint_engine() {
        for code in [
            "slither/5/5/j33h2j2g2i2h33j",
            "slither/5/5/2i0a2h2i2a0i2",
            LARGE,
        ] {
            let board = decode_url(code).expect("デコードに成功する");
            let counted = count_solutions(&board, 1_000, 0);
            assert!(!counted.aborted, "{code} の探索が打ち切られた");
            let outcome = run_all(
                &board,
                None,
                SolveOptions {
                    no_trial: false,
                    max_passes: 0,
                    no_local_pattern: false,
                },
            );
            if counted.solutions.is_empty() {
                assert_eq!(
                    outcome.status,
                    SolveStatus::Broken,
                    "{code} は解なしなのに手筋層が矛盾を検出しなかった"
                );
                continue;
            }
            assert_ne!(
                outcome.status,
                SolveStatus::Broken,
                "{code} に解があるのに矛盾した"
            );
            for (edge, &state) in outcome.answer.edges().iter().enumerate() {
                if state != EdgeState::Unknown {
                    assert!(
                        counted
                            .solutions
                            .iter()
                            .all(|solution| solution[edge] == state),
                        "{code} の辺 {edge} が制約エンジンの解と食い違う"
                    );
                }
            }
            if outcome.status == SolveStatus::Completed {
                assert_eq!(counted.solutions.len(), 1);
                assert_eq!(outcome.answer.edges(), counted.solutions[0]);
            }
        }
    }

    #[test]
    fn technique_solver_matches_confirmed_unique_corpus() {
        let corpus = include_str!("../../testdata/unique-problems.txt");
        for code in corpus
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
        {
            let board = decode_url(code).expect("デコードに成功する");
            let counted = count_solutions(&board, 2, 0);
            assert!(!counted.aborted, "{code} の探索が打ち切られた");
            assert_eq!(counted.solutions.len(), 1, "{code} が一意でない");
            let outcome = run_all(
                &board,
                None,
                SolveOptions {
                    no_trial: true,
                    max_passes: 0,
                    no_local_pattern: false,
                },
            );
            assert_ne!(outcome.status, SolveStatus::Broken, "{code} で矛盾した");
            let unique = &counted.solutions[0];
            for (edge, &state) in outcome.answer.edges().iter().enumerate() {
                if state != EdgeState::Unknown {
                    assert_eq!(
                        state, unique[edge],
                        "{code} の辺 {edge} が唯一解と食い違う"
                    );
                }
            }
            if outcome.status == SolveStatus::Completed {
                assert_eq!(outcome.answer.edges(), unique);
            }
        }
    }

    #[test]
    fn local_pattern_edges_match_confirmed_unique_solutions() {
        let corpus = include_str!("../../testdata/unique-problems.txt");
        for code in corpus
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
        {
            let board = decode_url(code).expect("デコードに成功する");
            let counted = count_solutions(&board, 2, 0);
            assert!(!counted.aborted, "{code} の探索が打ち切られた");
            assert_eq!(counted.solutions.len(), 1, "{code} が一意でない");
            let unique = &counted.solutions[0];
            let mut model = AnswerModel::new(&board);
            let status =
                local_pattern(&mut AnswerMethods::new(&board, &mut model, None));
            assert_ne!(status, Status::Broken, "{code} で局所表が矛盾した");
            for (edge, &state) in model.edges().iter().enumerate() {
                if state != EdgeState::Unknown {
                    assert_eq!(
                        state, unique[edge],
                        "{code} の辺 {edge} を局所表が唯一解と逆に確定した"
                    );
                }
            }
        }
    }
}
