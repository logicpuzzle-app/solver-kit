//! Unit tests for the contracts the golden-output comparison cannot localise.
//!
//! `verify.sh` proves the three ports agree, but when it fails it says only "these bytes
//! differ". These tests pin the individual behaviours a port has to reproduce — above all
//! the ones that look like bugs and are deliberate.

use yajilin_kit::board::{create_board, to_id, to_pos};
use yajilin_kit::difficulty::{
    band, difficulty, puzsq_rating, puzsq_rating_hundredths, size_scale, SIZE_SCALE_UNIT,
    UNFINISHED_BASE,
};
use yajilin_kit::engine::*;
use yajilin_kit::position::Position;
use yajilin_kit::puzzlink::{decode_url, encode_body, encode_code};
use yajilin_kit::random::Rng;
use yajilin_kit::reasons;
use yajilin_kit::search::{count_solutions, propagation_coverage};
use yajilin_kit::solution::{extract_solution, validate_solution, Solution};
use yajilin_kit::solver::{run_all, SolveOptions, SolveStatus};
use yajilin_kit::unionfind::UnionFind;

const PUBLISHED: &str = "yajilin/10/10/r31d32k22b31d23b31k33r12c40c13n";

#[test]
fn unionfind_keeps_the_nan_size_semantics() {
    // size() of a root that was never registered is NaN in the original, so the
    // union-by-size comparison in connect() is always false. Deductions depend on the
    // resulting tree shape, so the behaviour is reproduced rather than fixed.
    let mut uf = UnionFind::default();
    assert!(uf.connect(1, 2));
    // With both sizes unknown the swap never happens, so the first argument stays root.
    assert_eq!(uf.root(2), 1);
    assert!(uf.is_union(1, 2));
    assert!(!uf.connect(1, 2));
}

#[test]
fn unionfind_copies_without_sharing() {
    let mut uf = UnionFind::default();
    uf.connect(1, 2);
    let mut copy = uf.clone();
    copy.connect(2, 3);
    assert!(copy.is_union(1, 3));
    assert!(!uf.is_union(1, 3));
}

#[test]
fn cell_ids_round_trip() {
    for pos in [
        Position { x: 0, y: 0 },
        Position { x: 9, y: 9 },
        Position { x: 255, y: 255 },
    ] {
        assert_eq!(to_pos(to_id(pos)), pos);
    }
}

#[test]
fn puzzlink_round_trips_every_corpus_form() {
    for code in [
        PUBLISHED,
        "yajilin/10/10/a21a24a24a21a2343s42s41s41s43i",
        "yajilin/b/10/10/o0.e43j30a0.a0.a0.d2.k0.f20a0.a0.a3.b42za32",
    ] {
        let board = decode_url(code).expect("decodes");
        let again = decode_url(&encode_code(&board)).expect("decodes");
        assert_eq!(again.cols, board.cols);
        assert_eq!(again.rows, board.rows);
        for (a, b) in again.cell.iter().zip(board.cell.iter()) {
            assert_eq!((a.qdir, a.qnum), (b.qdir, b.qnum));
        }
    }
}

#[test]
fn puzzlink_accepts_urls_and_bare_codes() {
    let bare = decode_url(PUBLISHED).expect("decodes");
    let full = decode_url(&format!("https://puzz.link/p?{PUBLISHED}")).expect("decodes");
    assert_eq!(bare.cols, full.cols);
    assert_eq!(bare.rows, full.rows);
    for (a, b) in bare.cell.iter().zip(full.cell.iter()) {
        assert_eq!((a.qdir, a.qnum), (b.qdir, b.qnum));
    }
}

#[test]
fn puzzlink_skips_variant_flags() {
    let parsed = decode_url("yajilin/b/10/12/a10").expect("decodes");
    assert_eq!(parsed.cols, 10);
    assert_eq!(parsed.rows, 12);
}

#[test]
fn puzzlink_encodes_an_empty_board_as_skips() {
    // 100 empty cells: three full runs of 26 ('z') and a remainder of 22 ('v').
    assert_eq!(encode_body(&create_board(10, 10)), "zzzv");
}

#[test]
fn puzzlink_rejects_other_puzzle_types() {
    assert!(decode_url("masyu/10/10/abc").is_err());
}

/// An independent 128-bit implementation of the published algorithm; the shipped one
/// splits the state into 24-bit halves for speed, so this is a real cross-check.
struct ReferenceRng {
    state: u64,
}

impl ReferenceRng {
    fn new(seed: u64) -> Self {
        Self {
            state: (seed ^ 0x5DEE_CE66D) & ((1 << 48) - 1),
        }
    }
    fn next(&mut self, bits: u32) -> u64 {
        self.state = self
            .state
            .wrapping_mul(0x5DEE_CE66D)
            .wrapping_add(0xB)
            & ((1 << 48) - 1);
        self.state >> (48 - bits)
    }
}

#[test]
fn rng_matches_the_reference_stream() {
    for seed in [0u64, 1, 42, 2_147_483_647] {
        let mut rng = Rng::new(seed as i64);
        let mut reference = ReferenceRng::new(seed);
        for i in 0..500u32 {
            let bits = 1 + (i % 32);
            assert_eq!(rng.next(bits) as u64, reference.next(bits), "seed {seed}");
        }
    }
}

#[test]
fn rng_next_int_stays_in_range() {
    let mut rng = Rng::new(7);
    for bound in [1usize, 2, 3, 16, 1000] {
        for _ in 0..200 {
            assert!(rng.next_int(bound) < bound);
        }
    }
}

#[test]
fn rng_shuffle_is_a_reproducible_permutation() {
    let mut a: Vec<i32> = (0..8).collect();
    let mut b = a.clone();
    Rng::new(3).shuffle(&mut a);
    Rng::new(3).shuffle(&mut b);
    assert_eq!(a, b);
    let mut sorted = a.clone();
    sorted.sort();
    assert_eq!(sorted, (0..8).collect::<Vec<i32>>());
}

#[test]
fn validate_accepts_the_solver_answer() {
    let board = decode_url(PUBLISHED).expect("decodes");
    let outcome = run_all(&board, None, SolveOptions::default());
    assert_eq!(outcome.status, SolveStatus::Completed);
    let solution = extract_solution(&outcome.answer);
    assert!(validate_solution(&board, &solution).is_empty());
}

#[test]
fn validate_rejects_an_empty_answer() {
    let board = decode_url(PUBLISHED).expect("decodes");
    assert!(!validate_solution(&board, &Solution::default()).is_empty());
}

#[test]
fn validate_rejects_adjacent_blacks() {
    let board = create_board(3, 3);
    let mut solution = Solution::default();
    solution.blacks.insert(to_id(Position { x: 0, y: 0 }));
    solution.blacks.insert(to_id(Position { x: 1, y: 0 }));
    assert!(!validate_solution(&board, &solution).is_empty());
}

#[test]
fn engine_forces_neighbours_of_a_black_cell() {
    let mut engine = create_engine(&create_board(4, 4));
    set_cell(&mut engine, 5, CELL_BLACK); // (1,1)
    assert!(propagate_engine(&mut engine));
    for neighbour in [1usize, 4, 6, 9] {
        assert_eq!(engine.cell[neighbour], CELL_LINE);
    }
    for d in 0..4 {
        let edge = engine.incident[5 * 4 + d];
        assert_eq!(engine.edge[edge as usize], EDGE_BLANK);
    }
}

#[test]
fn engine_reports_adjacent_blacks_as_a_contradiction() {
    let mut engine = create_engine(&create_board(4, 4));
    set_cell(&mut engine, 5, CELL_BLACK);
    set_cell(&mut engine, 6, CELL_BLACK);
    assert!(!propagate_engine(&mut engine));
}

#[test]
fn engine_uses_the_arrow_bound_to_force_cells() {
    // A left-pointing 2 at (3,1) of a 5x3 board sees three cells. Three cells hold at most
    // two non-adjacent blacks and only one way round, so both ends are forced black and
    // the middle onto the loop. An even-length run would leave a real choice and force
    // nothing, which is why the ray here is deliberately odd.
    let mut board = create_board(5, 3);
    board.cell[8].qdir = 3;
    board.cell[8].qnum = 2;
    let mut engine = create_engine(&board);
    propagate_engine(&mut engine);
    assert_eq!(engine.cell[7], CELL_BLACK);
    assert_eq!(engine.cell[5], CELL_BLACK);
    assert_eq!(engine.cell[6], CELL_LINE);
}

#[test]
fn coverage_is_between_nothing_and_everything() {
    let board = decode_url(PUBLISHED).expect("decodes");
    let coverage = propagation_coverage(&board);
    assert!(coverage > 0);
    assert!(coverage <= 10 * 10 + 2 * 10 * 9);
}

#[test]
fn published_puzzles_have_exactly_one_solution() {
    for code in [PUBLISHED, "yajilin/10/10/a21a24a24a21a2343s42s41s41s43i"] {
        let board = decode_url(code).expect("decodes");
        let result = count_solutions(&board, 2, 200_000);
        assert!(!result.aborted);
        assert_eq!(result.solutions.len(), 1, "{code}");
    }
}

#[test]
fn an_empty_board_has_many_solutions() {
    let result = count_solutions(&create_board(6, 6), 2, 200_000);
    assert_eq!(result.solutions.len(), 2);
}

#[test]
fn difficulty_bands_increase_with_the_score() {
    // v5: the label is derived from the estimated rating, so the thresholds live on the
    // rating scale. Pick one score inside each band rather than hard-coding raw numbers.
    assert_eq!(band(0), "intro");
    assert_eq!(band(238), "easy");
    assert_eq!(band(1_000_504), "medium");
    assert_eq!(band(4_001_372), "hard");
    assert_eq!(band(4_002_295), "expert");
    assert_eq!(band(4_004_209), "fiendish");
}

#[test]
fn difficulty_bands_never_go_backwards() {
    let order = ["intro", "easy", "medium", "hard", "expert", "fiendish"];
    let rank = |name: &str| order.iter().position(|it| *it == name).unwrap();
    let mut last = 0;
    for score in (0..6_000_000).step_by(4_099) {
        let here = rank(band(score));
        assert!(here >= last, "band went backwards at {score}");
        last = here;
    }
}

#[test]
fn puzzle_square_rating_uses_integer_interpolation() {
    // v5 anchors. The middle three are the interval-DP boundaries; 4.50 is pinned to the
    // start of stage 6 (the solver could not finish) and 5.49 to that stage's 99th centile.
    assert_eq!(puzsq_rating_hundredths(-1), 50);
    assert_eq!(puzsq_rating_hundredths(0), 50);
    assert_eq!(puzsq_rating_hundredths(238), 150);
    assert_eq!(puzsq_rating_hundredths(4_001_304), 250);
    assert_eq!(puzsq_rating_hundredths(4_004_722), 350);
    assert_eq!(puzsq_rating_hundredths(5_000_000), 450);
    assert_eq!(puzsq_rating_hundredths(5_032_429), 549);
    assert_eq!(puzsq_rating_hundredths(5_032_430), 549);
    assert_eq!(puzsq_rating(4_001_304), 2.5);
    // Interpolation is linear between anchors and stays integral.
    assert_eq!(puzsq_rating_hundredths(4_003_013), 300);
}

#[test]
fn size_scale_restates_scores_at_10x10_scale() {
    assert_eq!(size_scale(100), SIZE_SCALE_UNIT);
    assert!(size_scale(64) > SIZE_SCALE_UNIT);
    assert!(size_scale(289) < SIZE_SCALE_UNIT);
    assert_eq!(size_scale(81), 4410);
    assert_eq!(size_scale(144), 3605);
    for cells in 25..1400 {
        assert!(size_scale(cells) >= size_scale(cells + 1));
    }
    assert_eq!(size_scale(1), size_scale(25));
    assert_eq!(size_scale(99999), size_scale(1400));
}

#[test]
fn difficulty_scores_a_published_puzzle() {
    let board = decode_url(PUBLISHED).expect("decodes");
    let outcome = run_all(&board, None, SolveOptions::default());
    let score = difficulty(&outcome, &board);
    assert!(score > 0 && score < 100_000);
}

#[test]
fn difficulty_puts_a_floor_under_puzzles_that_needed_a_counting_theorem() {
    // The gate is on the technique being present at all, not on how much it produced, so
    // a single use of the invisible wall has to lift an otherwise trivial score.
    let board = decode_url(PUBLISHED).expect("decodes");
    let mut outcome = run_all(&board, None, SolveOptions::default());
    let plain = difficulty(&outcome, &board);
    assert!(plain < 1200);
    outcome
        .recorder
        .counts
        .insert(reasons::INVISIBLE_WALL_BY_COUNT, 1);
    assert_eq!(difficulty(&outcome, &board), 1200);
    // A reason with no gate of its own leaves the score where it was.
    outcome
        .recorder
        .counts
        .remove(reasons::INVISIBLE_WALL_BY_COUNT);
    outcome.recorder.counts.insert(reasons::SMALL_LOOP_BAN, 1);
    assert!(difficulty(&outcome, &board) < 1200);
}
