use std::collections::{HashMap, HashSet};
use std::env;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::process::ExitCode;
use std::thread;
use std::time::Instant;

use slitherlink_kit::answer_model::AnswerModel;
use slitherlink_kit::board::Board;
use slitherlink_kit::engine::{ConstraintEngine, EdgeState};
use slitherlink_kit::format::format_board;
use slitherlink_kit::random::Rng;
use slitherlink_kit::solution::validate_solution;
use slitherlink_kit::solver::{run_all, SolveOptions, SolveStatus};

const USAGE: &str = r#"usage: discover --size WxH [options]

options:
  --size WxH          局所セル領域（幅・高さとも1〜4）
  --threads N         ワーカースレッド数
  --limit N           コード順の代表元を先頭からN個だけ処理
  --sample N          固定シードで代表元をN個サンプリング
  --seed N            --sample のシード（既定値: 1）
  --max-clues N       ヒント数N個以下の配置だけを完全列挙
  --known FILES       既知パターン。カンマ区切り、複数回指定可
  --ignore-solver     新規判定で既存19手筋を使わない
  --emit-novel FILE   新規パターンだけをバイナリで保存
  --out FILE          新規パターンだけをTSVで保存
  --soundness N       健全性検査数（既定値: 全件。0 も全件）
  --full              12セル以上を無制限に全探索すると明示
  -h, --help          このヘルプを表示
"#;

const NOVEL_MAGIC: &[u8; 8] = b"SLPNOV01";
const NOVEL_HEADER_BYTES: usize = 20;
const NOVEL_RECORD_BYTES: usize = 32;

#[derive(Clone, Debug)]
struct Options {
    width: usize,
    height: usize,
    threads: usize,
    limit: Option<usize>,
    sample: Option<usize>,
    seed: i64,
    max_clues: Option<usize>,
    known: Vec<String>,
    ignore_solver: bool,
    emit_novel: Option<String>,
    out: Option<String>,
    soundness: usize,
    full: bool,
}

fn parse_size(text: &str) -> Result<(usize, usize), String> {
    let (width, height) = text
        .split_once('x')
        .or_else(|| text.split_once('X'))
        .ok_or_else(|| "--size は WxH 形式で指定してください".to_string())?;
    let width: usize = width
        .parse()
        .map_err(|_| "--size の幅は整数で指定してください")?;
    let height: usize = height
        .parse()
        .map_err(|_| "--size の高さは整数で指定してください")?;
    // 幅または高さが 1 の領域には内部格子点が存在しないが、
    // 数字制約・境界格子点の次数上限・小ループ禁止はそのまま使える。
    // 探索側はこれを一般に扱えるので、下限を 1 まで下げて階層を細かく取れるようにする。
    if !(1..=4).contains(&width) || !(1..=4).contains(&height) {
        return Err("--size の幅・高さは1〜4で指定してください".into());
    }
    Ok((width, height))
}

fn parse_args(args: &[String]) -> Result<Option<Options>, String> {
    if args.iter().any(|argument| argument == "-h" || argument == "--help") {
        return Ok(None);
    }
    let mut size = None;
    let mut threads = thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1);
    let mut limit = None;
    let mut sample = None;
    let mut seed = 1i64;
    let mut max_clues = None;
    let mut known = Vec::new();
    let mut ignore_solver = false;
    let mut emit_novel = None;
    let mut out = None;
    // 全件でも 3x3 の 41,482 件が 44 秒で終わるので、既定を全件にする。
    // サンプリングでは、誤りがサンプルから漏れると検出できない。
    let mut soundness = usize::MAX;
    let mut full = false;
    let mut index = 0;
    while index < args.len() {
        let name = &args[index];
        index += 1;
        if name == "--full" {
            full = true;
            continue;
        }
        if name == "--ignore-solver" {
            ignore_solver = true;
            continue;
        }
        let value = match name.as_str() {
            "--size"
            | "--threads"
            | "--limit"
            | "--sample"
            | "--seed"
            | "--max-clues"
            | "--known"
            | "--emit-novel"
            | "--out"
            | "--soundness" => args
                .get(index)
                .ok_or_else(|| format!("{name} には値が必要です"))?,
            _ => return Err(format!("不明なオプションです: {name}")),
        };
        index += 1;
        match name.as_str() {
            "--size" => size = Some(parse_size(value)?),
            "--threads" => {
                threads = value
                    .parse()
                    .map_err(|_| "--threads は正の整数で指定してください")?;
                if threads == 0 {
                    return Err("--threads は正の整数で指定してください".into());
                }
            }
            "--limit" => {
                let parsed = value
                    .parse()
                    .map_err(|_| "--limit は正の整数で指定してください")?;
                if parsed == 0 {
                    return Err("--limit は正の整数で指定してください".into());
                }
                limit = Some(parsed);
            }
            "--sample" => {
                let parsed = value
                    .parse()
                    .map_err(|_| "--sample は正の整数で指定してください")?;
                if parsed == 0 {
                    return Err("--sample は正の整数で指定してください".into());
                }
                sample = Some(parsed);
            }
            "--seed" => {
                seed = value
                    .parse()
                    .map_err(|_| "--seed は64ビット整数で指定してください")?;
            }
            "--max-clues" => {
                max_clues = Some(
                    value
                        .parse()
                        .map_err(|_| "--max-clues は非負整数で指定してください")?,
                );
            }
            "--known" => {
                known.extend(
                    value
                        .split(',')
                        .filter(|path| !path.is_empty())
                        .map(str::to_string),
                );
            }
            "--emit-novel" => emit_novel = Some(value.clone()),
            "--out" => out = Some(value.clone()),
            "--soundness" => {
                soundness = value
                    .parse()
                    .map_err(|_| "--soundness は非負整数で指定してください")?;
            }
            _ => unreachable!("値付きの既知オプションだけを処理する"),
        }
    }
    let (width, height) = size.ok_or_else(|| "--size は必須です".to_string())?;
    let selection_count =
        usize::from(limit.is_some()) + usize::from(sample.is_some());
    if selection_count > 1 {
        return Err("--limit と --sample は併用できません".into());
    }
    if sample.is_some() && max_clues.is_some() {
        return Err("--sample と --max-clues は併用できません".into());
    }
    if max_clues.is_some_and(|maximum| maximum > width * height) {
        return Err("--max-clues はセル数以下で指定してください".into());
    }
    if width * height >= 12
        && limit.is_none()
        && sample.is_none()
        && max_clues.is_none()
        && !full
    {
        return Err(
            "12セル以上の無制限探索には --full が必要です。先に --limit 100000 で見積もってください"
                .into(),
        );
    }
    Ok(Some(Options {
        width,
        height,
        threads,
        limit,
        sample,
        seed,
        max_clues,
        known,
        ignore_solver,
        emit_novel,
        out,
        soundness,
        full,
    }))
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
struct EdgeMasks {
    lines: u64,
    crosses: u64,
}

impl EdgeMasks {
    fn assigned(self) -> u64 {
        self.lines | self.crosses
    }

    fn count(self) -> usize {
        self.assigned().count_ones() as usize
    }

    fn state(self, edge: usize) -> EdgeState {
        let bit = 1u64 << edge;
        if self.lines & bit != 0 {
            EdgeState::Line
        } else if self.crosses & bit != 0 {
            EdgeState::Cross
        } else {
            EdgeState::Unknown
        }
    }

    fn insert(&mut self, edge: usize, state: EdgeState) -> Result<(), String> {
        let bit = 1u64 << edge;
        match state {
            EdgeState::Line => {
                if self.crosses & bit != 0 {
                    return Err(format!("辺{edge}のLine/Crossが衝突しました"));
                }
                self.lines |= bit;
            }
            EdgeState::Cross => {
                if self.lines & bit != 0 {
                    return Err(format!("辺{edge}のLine/Crossが衝突しました"));
                }
                self.crosses |= bit;
            }
            EdgeState::Unknown => {}
        }
        Ok(())
    }

    fn merge(&mut self, other: Self) -> Result<(), String> {
        if self.lines & other.crosses != 0 || self.crosses & other.lines != 0 {
            return Err("既知パターン同士の確定辺が衝突しました".into());
        }
        self.lines |= other.lines;
        self.crosses |= other.crosses;
        Ok(())
    }
}

#[derive(Clone)]
struct LocalGeometry {
    width: usize,
    height: usize,
    edge_count: usize,
    all_edges: u64,
    cell_edges: Vec<u64>,
    vertex_edges: Vec<u64>,
    internal_vertices: Vec<u64>,
    boundary_vertices: Vec<u64>,
    branch_order: Vec<usize>,
    same_shape_kinds: Vec<usize>,
    cell_transforms: Vec<Vec<usize>>,
    powers_of_five: Vec<u64>,
}

impl LocalGeometry {
    fn new(width: usize, height: usize) -> Self {
        let board =
            Board::empty(width, height).expect("2〜4セルの局所盤面を作れる");
        let edge_count = board.edge_count();
        assert!(edge_count <= 64, "局所辺マスクはu64に収まる");
        let cell_edges: Vec<u64> = (0..height)
            .flat_map(|y| {
                let board = &board;
                (0..width).map(move |x| {
                    board
                        .cell_edges(x, y)
                        .into_iter()
                        .fold(0u64, |mask, edge| mask | 1u64 << edge)
                })
            })
            .collect();
        let mut vertex_edges = Vec::new();
        let mut internal_vertices = Vec::new();
        let mut boundary_vertices = Vec::new();
        for y in 0..=height {
            for x in 0..=width {
                let mask = board
                    .vertex_edges(x, y)
                    .into_iter()
                    .fold(0u64, |value, edge| value | 1u64 << edge);
                vertex_edges.push(mask);
                if x > 0 && x < width && y > 0 && y < height {
                    internal_vertices.push(mask);
                } else {
                    boundary_vertices.push(mask);
                }
            }
        }
        let mut branch_order: Vec<_> = (0..edge_count).collect();
        branch_order.sort_unstable_by_key(|&edge| {
            let bit = 1u64 << edge;
            let score = cell_edges
                .iter()
                .chain(&internal_vertices)
                .chain(&boundary_vertices)
                .filter(|&&mask| mask & bit != 0)
                .count();
            (usize::MAX - score, edge)
        });
        let same_shape_kinds = if width == height {
            (0..8).collect()
        } else {
            vec![0, 2, 4, 6]
        };
        let cell_transforms = same_shape_kinds
            .iter()
            .map(|&kind| Self::cell_mapping(width, height, kind))
            .collect();
        let mut powers_of_five = vec![1u64; width * height];
        for index in 1..powers_of_five.len() {
            powers_of_five[index] = powers_of_five[index - 1] * 5;
        }
        Self {
            width,
            height,
            edge_count,
            all_edges: (1u64 << edge_count) - 1,
            cell_edges,
            vertex_edges,
            internal_vertices,
            boundary_vertices,
            branch_order,
            same_shape_kinds,
            cell_transforms,
            powers_of_five,
        }
    }

    fn target_size(width: usize, height: usize, kind: usize) -> (usize, usize) {
        if kind % 4 % 2 == 0 {
            (width, height)
        } else {
            (height, width)
        }
    }

    fn transform_cell(
        width: usize,
        height: usize,
        kind: usize,
        x: usize,
        y: usize,
    ) -> (usize, usize) {
        let rotation = kind % 4;
        let reflected = kind >= 4;
        let (target_width, _) = Self::target_size(width, height, kind);
        let (mut tx, ty) = match rotation {
            0 => (x, y),
            1 => (height - 1 - y, x),
            2 => (width - 1 - x, height - 1 - y),
            3 => (y, width - 1 - x),
            _ => unreachable!("回転は4通り"),
        };
        if reflected {
            tx = target_width - 1 - tx;
        }
        (tx, ty)
    }

    fn transform_vertex(
        width: usize,
        height: usize,
        kind: usize,
        x: usize,
        y: usize,
    ) -> (usize, usize) {
        let rotation = kind % 4;
        let reflected = kind >= 4;
        let (target_width, _) = Self::target_size(width, height, kind);
        let (mut tx, ty) = match rotation {
            0 => (x, y),
            1 => (height - y, x),
            2 => (width - x, height - y),
            3 => (y, width - x),
            _ => unreachable!("回転は4通り"),
        };
        if reflected {
            tx = target_width - tx;
        }
        (tx, ty)
    }

    fn cell_mapping(width: usize, height: usize, kind: usize) -> Vec<usize> {
        let (target_width, _) = Self::target_size(width, height, kind);
        (0..width * height)
            .map(|source| {
                let x = source % width;
                let y = source / width;
                let (tx, ty) =
                    Self::transform_cell(width, height, kind, x, y);
                ty * target_width + tx
            })
            .collect()
    }

    fn transformed_edge(
        width: usize,
        height: usize,
        kind: usize,
        edge: usize,
    ) -> usize {
        let horizontal = width * (height + 1);
        let (first, second) = if edge < horizontal {
            let x = edge % width;
            let y = edge / width;
            ((x, y), (x + 1, y))
        } else {
            let offset = edge - horizontal;
            let x = offset % (width + 1);
            let y = offset / (width + 1);
            ((x, y), (x, y + 1))
        };
        let first = Self::transform_vertex(
            width, height, kind, first.0, first.1,
        );
        let second = Self::transform_vertex(
            width, height, kind, second.0, second.1,
        );
        let (target_width, target_height) =
            Self::target_size(width, height, kind);
        if first.1 == second.1 {
            first.1 * target_width + first.0.min(second.0)
        } else {
            target_width * (target_height + 1)
                + first.1.min(second.1) * (target_width + 1)
                + first.0
        }
    }

    fn h_id(&self, x: usize, y: usize) -> usize {
        y * self.width + x
    }

    fn v_id(&self, x: usize, y: usize) -> usize {
        self.width * (self.height + 1) + y * (self.width + 1) + x
    }

    fn decode_clues(&self, mut code: u64) -> Vec<i8> {
        (0..self.width * self.height)
            .map(|_| {
                let digit = (code % 5) as i8;
                code /= 5;
                digit - 1
            })
            .collect()
    }

    fn transformed_code_with_mapping(code: u64, mapping: &[usize]) -> u64 {
        let mut remaining = code;
        let mut powers = vec![1u64; mapping.len()];
        for index in 1..powers.len() {
            powers[index] = powers[index - 1] * 5;
        }
        let mut transformed = 0;
        for &target in mapping {
            let digit = remaining % 5;
            remaining /= 5;
            transformed += digit * powers[target];
        }
        transformed
    }

    fn transformed_code(&self, code: u64, mapping: &[usize]) -> u64 {
        let mut remaining = code;
        let mut transformed = 0;
        for &target in mapping {
            let digit = remaining % 5;
            remaining /= 5;
            transformed += digit * self.powers_of_five[target];
        }
        transformed
    }

    fn canonical_code(&self, code: u64) -> u64 {
        self.cell_transforms
            .iter()
            .map(|mapping| self.transformed_code(code, mapping))
            .min()
            .expect("恒等変換を含む")
    }

    fn orbit_size(&self, code: u64) -> usize {
        self.cell_transforms
            .iter()
            .map(|mapping| self.transformed_code(code, mapping))
            .collect::<HashSet<_>>()
            .len()
    }

    fn total_configurations(&self) -> u64 {
        5u64.pow((self.width * self.height) as u32)
    }

    fn selected_configuration_count(&self, max_clues: Option<usize>) -> u64 {
        let Some(maximum) = max_clues else {
            return self.total_configurations();
        };
        let cells = self.width * self.height;
        (0..=maximum)
            .map(|count| {
                binomial(cells, count) * 4u64.pow(count as u32)
            })
            .sum()
    }

    fn fixed_configuration_count(
        &self,
        mapping: &[usize],
        max_clues: Option<usize>,
    ) -> u64 {
        let mut visited = vec![false; mapping.len()];
        let mut cycles = Vec::new();
        for start in 0..mapping.len() {
            if visited[start] {
                continue;
            }
            let mut length = 0;
            let mut current = start;
            while !visited[current] {
                visited[current] = true;
                length += 1;
                current = mapping[current];
            }
            cycles.push(length);
        }
        let Some(maximum) = max_clues else {
            return 5u64.pow(cycles.len() as u32);
        };
        let mut counts = vec![0u64; maximum + 1];
        counts[0] = 1;
        for length in cycles {
            let mut next = counts.clone();
            for clue_count in length..=maximum {
                next[clue_count] += counts[clue_count - length] * 4;
            }
            counts = next;
        }
        counts.into_iter().sum()
    }

    fn representative_total(&self, max_clues: Option<usize>) -> u64 {
        let fixed: u64 = self
            .cell_transforms
            .iter()
            .map(|mapping| {
                self.fixed_configuration_count(mapping, max_clues)
            })
            .sum();
        fixed / self.cell_transforms.len() as u64
    }

    fn representative_codes(&self, options: &Options) -> Vec<u64> {
        if let Some(sample_size) = options.sample {
            return self.sample_representatives(sample_size, options.seed);
        }
        if let Some(maximum) = options.max_clues {
            let mut configurations = Vec::new();
            generate_sparse_codes(
                0,
                self.width * self.height,
                0,
                maximum,
                0,
                1,
                &mut configurations,
            );
            let mut representatives: Vec<_> = configurations
                .into_iter()
                .filter(|&code| self.canonical_code(code) == code)
                .collect();
            representatives.sort_unstable();
            if let Some(limit) = options.limit {
                representatives.truncate(limit);
            }
            return representatives;
        }
        let mut representatives = Vec::new();
        for code in 0..self.total_configurations() {
            if self.canonical_code(code) == code {
                representatives.push(code);
                if options
                    .limit
                    .is_some_and(|maximum| representatives.len() == maximum)
                {
                    break;
                }
            }
        }
        representatives
    }

    fn sample_representatives(&self, count: usize, seed: i64) -> Vec<u64> {
        let target =
            count.min(self.representative_total(None) as usize);
        let mut rng = Rng::new(seed);
        let mut selected = HashSet::with_capacity(target);
        while selected.len() < target {
            let random = (rng.next(32) << 32) | rng.next(32);
            let code = random % self.total_configurations();
            selected.insert(self.canonical_code(code));
        }
        let mut result: Vec<_> = selected.into_iter().collect();
        result.sort_unstable();
        result
    }

    fn force_masks(
        assigned: &mut u64,
        lines: &mut u64,
        forced_lines: u64,
        forced_crosses: u64,
    ) -> bool {
        if forced_lines & forced_crosses != 0
            || forced_lines & *assigned & !*lines != 0
            || forced_crosses & *lines != 0
        {
            return false;
        }
        *assigned |= forced_lines | forced_crosses;
        *lines |= forced_lines;
        true
    }

    fn closed_loop_edges(&self, lines: u64) -> Option<u64> {
        let mut remaining = lines;
        while remaining != 0 {
            let mut component = 1u64 << remaining.trailing_zeros();
            loop {
                let before = component;
                for &vertex in &self.vertex_edges {
                    if vertex & component != 0 {
                        component |= vertex & lines;
                    }
                }
                if component == before {
                    break;
                }
            }
            let closed = self
                .vertex_edges
                .iter()
                .filter(|&&vertex| vertex & component != 0)
                .all(|&vertex| (vertex & component).count_ones() == 2);
            if closed {
                return Some(component);
            }
            remaining &= !component;
        }
        None
    }

    fn propagate(
        &self,
        clues: &[i8],
        assigned: &mut u64,
        lines: &mut u64,
    ) -> bool {
        loop {
            let before = *assigned;
            let mut forced_lines = 0u64;
            let mut forced_crosses = 0u64;
            for (&clue, &mask) in clues.iter().zip(&self.cell_edges) {
                if clue < 0 {
                    continue;
                }
                let line_count = (*lines & mask).count_ones() as i8;
                let unknown = (mask & !*assigned).count_ones() as i8;
                if line_count > clue || line_count + unknown < clue {
                    return false;
                }
                if line_count == clue {
                    forced_crosses |= mask & !*assigned;
                } else if line_count + unknown == clue {
                    forced_lines |= mask & !*assigned;
                }
            }
            for &mask in &self.internal_vertices {
                let line_count = (*lines & mask).count_ones();
                let unknown_mask = mask & !*assigned;
                let unknown = unknown_mask.count_ones();
                let degree_zero_possible = line_count == 0;
                let degree_two_possible =
                    line_count <= 2 && line_count + unknown >= 2;
                if !degree_zero_possible && !degree_two_possible {
                    return false;
                }
                if degree_zero_possible && !degree_two_possible {
                    forced_crosses |= unknown_mask;
                } else if !degree_zero_possible {
                    if line_count == 2 {
                        forced_crosses |= unknown_mask;
                    } else if line_count + unknown == 2 {
                        forced_lines |= unknown_mask;
                    }
                }
            }
            for &mask in &self.boundary_vertices {
                let line_count = (*lines & mask).count_ones();
                if line_count > 2 {
                    return false;
                }
                if line_count == 2 {
                    forced_crosses |= mask & !*assigned;
                }
            }
            if let Some(closed_loop) = self.closed_loop_edges(*lines) {
                // 境界格子点を含め、成分上の全格子点が次数2なら領域内で
                // 閉路が完成している。境界に次数1が残る成分はここに入らず、
                // 盤面外へ伸びる可能性を保つ。
                if *lines & !closed_loop != 0 {
                    return false;
                }
                forced_crosses |= self.all_edges & !closed_loop;
            }
            if !Self::force_masks(
                assigned,
                lines,
                forced_lines,
                forced_crosses,
            ) {
                return false;
            }
            if *assigned == before {
                return true;
            }
        }
    }

    fn find_solution_cached(
        &self,
        clues: &[i8],
        fixed: Option<(usize, bool)>,
        dead: &mut HashSet<(u64, u64)>,
    ) -> Option<u64> {
        let mut assigned = 0u64;
        let mut lines = 0u64;
        if let Some((edge, line)) = fixed {
            assigned |= 1u64 << edge;
            if line {
                lines |= 1u64 << edge;
            }
        }
        self.search(clues, assigned, lines, dead)
    }

    fn search(
        &self,
        clues: &[i8],
        mut assigned: u64,
        mut lines: u64,
        dead: &mut HashSet<(u64, u64)>,
    ) -> Option<u64> {
        if !self.propagate(clues, &mut assigned, &mut lines) {
            return None;
        }
        if assigned == self.all_edges {
            return Some(lines);
        }
        let key = (assigned, lines);
        if dead.contains(&key) {
            return None;
        }
        let edge = self
            .branch_order
            .iter()
            .copied()
            .find(|&candidate| assigned & (1u64 << candidate) == 0)
            .expect("未確定辺が残っている");
        let bit = 1u64 << edge;
        let solution = self
            .search(clues, assigned | bit, lines | bit, dead)
            .or_else(|| self.search(clues, assigned | bit, lines, dead));
        if solution.is_none() {
            dead.insert(key);
        }
        solution
    }

    fn forced_edges(&self, clues: &[i8]) -> Option<EdgeMasks> {
        let mut dead = HashSet::new();
        let baseline = self.find_solution_cached(clues, None, &mut dead)?;
        let mut forced = EdgeMasks::default();
        let mut witnessed_flexible = 0u64;
        for edge in 0..self.edge_count {
            let bit = 1u64 << edge;
            if witnessed_flexible & bit != 0 {
                continue;
            }
            let baseline_is_line = baseline & bit != 0;
            match self.find_solution_cached(
                clues,
                Some((edge, !baseline_is_line)),
                &mut dead,
            ) {
                Some(alternative) => {
                    witnessed_flexible |= baseline ^ alternative;
                }
                None => {
                    forced
                        .insert(
                            edge,
                            if baseline_is_line {
                                EdgeState::Line
                            } else {
                                EdgeState::Cross
                            },
                        )
                        .expect("単一の基準解から確定辺を作る");
                }
            }
        }
        Some(forced)
    }
}

fn binomial(n: usize, k: usize) -> u64 {
    let k = k.min(n - k);
    (0..k).fold(1u64, |value, index| {
        value * (n - index) as u64 / (index + 1) as u64
    })
}

fn generate_sparse_codes(
    position: usize,
    cells: usize,
    clue_count: usize,
    maximum: usize,
    code: u64,
    power: u64,
    output: &mut Vec<u64>,
) {
    if position == cells {
        output.push(code);
        return;
    }
    generate_sparse_codes(
        position + 1,
        cells,
        clue_count,
        maximum,
        code,
        power * 5,
        output,
    );
    if clue_count < maximum {
        for digit in 1..=4 {
            generate_sparse_codes(
                position + 1,
                cells,
                clue_count + 1,
                maximum,
                code + digit * power,
                power * 5,
                output,
            );
        }
    }
}

#[derive(Clone, Debug)]
struct Pattern {
    code: u64,
    orbit_size: usize,
    clues: Vec<i8>,
    prior: EdgeMasks,
    novel: EdgeMasks,
}

impl Pattern {
    fn clue_count(&self) -> usize {
        self.clues.iter().filter(|&&clue| clue >= 0).count()
    }
}

#[derive(Clone, Debug)]
struct KnownGroup {
    width: usize,
    height: usize,
    patterns: HashMap<u64, EdgeMasks>,
}

#[derive(Clone, Debug, Default)]
struct KnownPatterns {
    groups: Vec<KnownGroup>,
    file_records: usize,
}

impl KnownPatterns {
    fn load(paths: &[String]) -> Result<Self, String> {
        let mut expanded: HashMap<(usize, usize), HashMap<u64, EdgeMasks>> =
            HashMap::new();
        let mut file_records = 0;
        for path in paths {
            let bytes =
                fs::read(path).map_err(|error| format!("{path}: {error}"))?;
            if bytes.len() < NOVEL_HEADER_BYTES || &bytes[..8] != NOVEL_MAGIC {
                return Err(format!("{path}: 新規パターンファイルではありません"));
            }
            let width = bytes[8] as usize;
            let height = bytes[9] as usize;
            let geometry = LocalGeometry::new(width, height);
            if bytes[10] as usize != geometry.edge_count || bytes[11] != 0 {
                return Err(format!("{path}: ヘッダーの辺数が不正です"));
            }
            let count = read_u64(&bytes, 12)? as usize;
            let expected = NOVEL_HEADER_BYTES + count * NOVEL_RECORD_BYTES;
            if bytes.len() != expected {
                return Err(format!(
                    "{path}: ファイル長が不正です（{}、期待値{expected}）",
                    bytes.len()
                ));
            }
            file_records += count;
            for record in 0..count {
                let offset = NOVEL_HEADER_BYTES + record * NOVEL_RECORD_BYTES;
                let code = read_u64(&bytes, offset)?;
                let lines = read_u64(&bytes, offset + 16)?;
                let crosses = read_u64(&bytes, offset + 24)?;
                if lines & crosses != 0
                    || (lines | crosses) & !geometry.all_edges != 0
                {
                    return Err(format!(
                        "{path}: レコード{record}の辺マスクが不正です"
                    ));
                }
                let source = EdgeMasks { lines, crosses };
                for kind in 0..8 {
                    let (target_width, target_height) =
                        LocalGeometry::target_size(width, height, kind);
                    let mapping =
                        LocalGeometry::cell_mapping(width, height, kind);
                    let transformed_code =
                        LocalGeometry::transformed_code_with_mapping(
                            code, &mapping,
                        );
                    let transformed =
                        transform_masks(width, height, source, kind);
                    let entry = expanded
                        .entry((target_width, target_height))
                        .or_default()
                        .entry(transformed_code)
                        .or_default();
                    entry.merge(transformed).map_err(|error| {
                        format!("{path}: 対称展開後の衝突: {error}")
                    })?;
                }
            }
        }
        let mut groups: Vec<_> = expanded
            .into_iter()
            .map(|((width, height), patterns)| KnownGroup {
                width,
                height,
                patterns,
            })
            .collect();
        groups.sort_unstable_by_key(|group| (group.width, group.height));
        Ok(Self {
            groups,
            file_records,
        })
    }

    fn expanded_entries(&self) -> usize {
        self.groups
            .iter()
            .map(|group| group.patterns.len())
            .sum()
    }

    fn apply(
        &self,
        geometry: &LocalGeometry,
        clues: &[i8],
        padded: &Board,
        answer: &mut AnswerModel,
    ) -> Result<usize, String> {
        let mut changes = 0;
        for group in &self.groups {
            if group.width > geometry.width || group.height > geometry.height {
                continue;
            }
            for start_y in 0..=geometry.height - group.height {
                for start_x in 0..=geometry.width - group.width {
                    let code = subwindow_code(
                        geometry,
                        clues,
                        start_x,
                        start_y,
                        group.width,
                        group.height,
                    );
                    let Some(&masks) = group.patterns.get(&code) else {
                        continue;
                    };
                    for edge in 0..edge_count(group.width, group.height) {
                        let state = masks.state(edge);
                        if state == EdgeState::Unknown {
                            continue;
                        }
                        let local_edge = subwindow_to_local_edge(
                            geometry,
                            start_x,
                            start_y,
                            group.width,
                            group.height,
                            edge,
                        );
                        let padded_edge =
                            local_to_padded_edge(geometry, padded, local_edge);
                        if answer
                            .set_edge(padded, padded_edge, state)
                            .map_err(|error| {
                                format!(
                                    "既知パターン適用時に矛盾しました: {error}"
                                )
                            })?
                        {
                            changes += 1;
                        }
                    }
                }
            }
        }
        Ok(changes)
    }

    #[cfg(test)]
    fn from_patterns(
        width: usize,
        height: usize,
        patterns: &[Pattern],
    ) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!(
            "slitherlink-discover-{}-{}-{}.bin",
            std::process::id(),
            width,
            height
        ));
        write_novel_file(
            path.to_str().expect("一時パスはUTF-8"),
            width,
            height,
            patterns,
        )?;
        let loaded = Self::load(&[path.to_string_lossy().into_owned()]);
        let _ = fs::remove_file(path);
        loaded
    }
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, String> {
    let encoded: [u8; 8] = bytes
        .get(offset..offset + 8)
        .ok_or_else(|| "u64の読み取り位置がファイル外です".to_string())?
        .try_into()
        .expect("8バイトを確認済み");
    Ok(u64::from_le_bytes(encoded))
}

fn transform_masks(
    width: usize,
    height: usize,
    masks: EdgeMasks,
    kind: usize,
) -> EdgeMasks {
    let mut result = EdgeMasks::default();
    for edge in 0..edge_count(width, height) {
        let state = masks.state(edge);
        if state == EdgeState::Unknown {
            continue;
        }
        let target =
            LocalGeometry::transformed_edge(width, height, kind, edge);
        result
            .insert(target, state)
            .expect("対称変換は辺を一対一に写す");
    }
    result
}

fn edge_count(width: usize, height: usize) -> usize {
    width * (height + 1) + (width + 1) * height
}

fn subwindow_code(
    geometry: &LocalGeometry,
    clues: &[i8],
    start_x: usize,
    start_y: usize,
    width: usize,
    height: usize,
) -> u64 {
    let mut code = 0;
    let mut power = 1;
    for y in 0..height {
        for x in 0..width {
            let clue =
                clues[(start_y + y) * geometry.width + start_x + x];
            code += (clue + 1) as u64 * power;
            power *= 5;
        }
    }
    code
}

fn subwindow_to_local_edge(
    geometry: &LocalGeometry,
    start_x: usize,
    start_y: usize,
    width: usize,
    height: usize,
    edge: usize,
) -> usize {
    let horizontal = width * (height + 1);
    if edge < horizontal {
        geometry.h_id(start_x + edge % width, start_y + edge / width)
    } else {
        let offset = edge - horizontal;
        geometry.v_id(
            start_x + offset % (width + 1),
            start_y + offset / (width + 1),
        )
    }
}

#[cfg(test)]
fn transform_pattern(
    geometry: &LocalGeometry,
    pattern: &Pattern,
    kind: usize,
) -> Pattern {
    let mapping =
        LocalGeometry::cell_mapping(geometry.width, geometry.height, kind);
    let code =
        LocalGeometry::transformed_code_with_mapping(pattern.code, &mapping);
    let (width, height) =
        LocalGeometry::target_size(geometry.width, geometry.height, kind);
    let target_geometry = LocalGeometry::new(width, height);
    Pattern {
        code,
        orbit_size: pattern.orbit_size,
        clues: target_geometry.decode_clues(code),
        prior: transform_masks(
            geometry.width,
            geometry.height,
            pattern.prior,
            kind,
        ),
        novel: transform_masks(
            geometry.width,
            geometry.height,
            pattern.novel,
            kind,
        ),
    }
}

#[derive(Default)]
struct WorkerResult {
    representatives: usize,
    represented_configurations: u64,
    satisfiable_representatives: usize,
    satisfiable_configurations: u64,
    contradiction_representatives: usize,
    contradiction_configurations: u64,
    forced_representatives: usize,
    forced_configurations: u64,
    solver_broken_representatives: usize,
    solver_broken_configurations: u64,
    novel_representatives: usize,
    novel_configurations: u64,
    novel_edge_total: usize,
    patterns: Vec<Pattern>,
}

fn padded_board(geometry: &LocalGeometry, clues: &[i8]) -> Board {
    let width = geometry.width + 4;
    let height = geometry.height + 4;
    let mut padded_clues = vec![-1; width * height];
    for y in 0..geometry.height {
        for x in 0..geometry.width {
            padded_clues[(y + 2) * width + x + 2] =
                clues[y * geometry.width + x];
        }
    }
    Board::new(width, height, padded_clues).expect("余白付き盤面を作れる")
}

fn verification_board(geometry: &LocalGeometry, clues: &[i8]) -> Board {
    // 余白は上下左右に 2 マスずつ確保する。7x7 に固定すると 4x4 の領域では
    // 余白が 1 マスになり、ループが外へ回り込めずに解が消える。
    // 実際 203./0.../3..3/.... は 7x7 では解 0 個だが、8x8 以上なら解 2 個ある。
    let width = geometry.width + 4;
    let height = geometry.height + 4;
    let mut padded_clues = vec![-1; width * height];
    let start_x = (width - geometry.width) / 2;
    let start_y = (height - geometry.height) / 2;
    for y in 0..geometry.height {
        for x in 0..geometry.width {
            padded_clues[(y + start_y) * width + x + start_x] =
                clues[y * geometry.width + x];
        }
    }
    Board::new(width, height, padded_clues)
        .expect("健全性検査用の余白付き盤面を作れる")
}

fn local_to_padded_edge(
    geometry: &LocalGeometry,
    padded: &Board,
    edge: usize,
) -> usize {
    let padding_x = (padded.cols - geometry.width) / 2;
    let padding_y = (padded.rows - geometry.height) / 2;
    let horizontal = geometry.width * (geometry.height + 1);
    if edge < horizontal {
        padded.h_id(
            edge % geometry.width + padding_x,
            edge / geometry.width + padding_y,
        )
    } else {
        let offset = edge - horizontal;
        padded.v_id(
            offset % (geometry.width + 1) + padding_x,
            offset / (geometry.width + 1) + padding_y,
        )
    }
}

fn compare_known(
    geometry: &LocalGeometry,
    clues: &[i8],
    known: &KnownPatterns,
    ignore_solver: bool,
) -> (EdgeMasks, bool) {
    let board = padded_board(geometry, clues);
    let (answer, solver_broken) = if ignore_solver {
        let mut answer = AnswerModel::new(&board);
        loop {
            match known.apply(geometry, clues, &board, &mut answer) {
                Ok(0) => break (answer, false),
                Ok(_) => {}
                Err(_) => {
                    return (EdgeMasks::default(), true);
                }
            }
        }
    } else {
        let mut initial = None;
        loop {
            let mut current = run_all(
                &board,
                initial,
                SolveOptions {
                    no_trial: true,
                    max_passes: 0,
                    no_local_pattern: true,
                },
            );
            if current.status == SolveStatus::Broken {
                break (current.answer, true);
            }
            match known.apply(geometry, clues, &board, &mut current.answer) {
                Ok(0) => break (current.answer, false),
                Ok(_) => initial = Some(current.answer),
                Err(_) => {
                    return (EdgeMasks::default(), true);
                }
            }
        }
    };
    let mut existing = EdgeMasks::default();
    for edge in 0..geometry.edge_count {
        let padded_edge = local_to_padded_edge(geometry, &board, edge);
        existing
            .insert(edge, answer.edge(padded_edge))
            .expect("盤面の各辺は一つの状態だけを持つ");
    }
    (existing, solver_broken)
}

fn analyze_range(
    geometry: &LocalGeometry,
    known: &KnownPatterns,
    codes: &[u64],
    ignore_solver: bool,
) -> WorkerResult {
    let mut result = WorkerResult::default();
    for &code in codes {
        let orbit_size = geometry.orbit_size(code);
        result.representatives += 1;
        result.represented_configurations += orbit_size as u64;
        let clues = geometry.decode_clues(code);
        let Some(forced) = geometry.forced_edges(&clues) else {
            result.contradiction_representatives += 1;
            result.contradiction_configurations += orbit_size as u64;
            continue;
        };
        result.satisfiable_representatives += 1;
        result.satisfiable_configurations += orbit_size as u64;
        if forced.count() == 0 {
            continue;
        }
        result.forced_representatives += 1;
        result.forced_configurations += orbit_size as u64;
        let (existing, solver_broken) =
            compare_known(geometry, &clues, known, ignore_solver);
        if solver_broken {
            result.solver_broken_representatives += 1;
            result.solver_broken_configurations += orbit_size as u64;
            continue;
        }
        let novel = EdgeMasks {
            lines: forced.lines & !existing.lines,
            crosses: forced.crosses & !existing.crosses,
        };
        assert_eq!(
            existing.assigned() & novel.assigned(),
            0,
            "priorとnovelの辺は重複しない"
        );
        if novel.count() == 0 {
            continue;
        }
        result.novel_representatives += 1;
        result.novel_configurations += orbit_size as u64;
        result.novel_edge_total += novel.count();
        result.patterns.push(Pattern {
            code,
            orbit_size,
            clues,
            prior: existing,
            novel,
        });
    }
    result
}

fn discover(
    geometry: &LocalGeometry,
    known: &KnownPatterns,
    codes: &[u64],
    requested_threads: usize,
    ignore_solver: bool,
) -> WorkerResult {
    if codes.is_empty() {
        return WorkerResult::default();
    }
    let worker_count = requested_threads.min(codes.len()).max(1);
    let chunk_size = codes.len().div_ceil(worker_count);
    let workers: Vec<WorkerResult> = thread::scope(|scope| {
        let handles: Vec<_> = codes
            .chunks(chunk_size)
            .map(|chunk| {
                scope.spawn(|| {
                    analyze_range(geometry, known, chunk, ignore_solver)
                })
            })
            .collect();
        handles
            .into_iter()
            .map(|handle| {
                handle.join().expect("探索ワーカーが正常終了する")
            })
            .collect()
    });
    let mut combined = WorkerResult::default();
    for mut worker in workers {
        combined.representatives += worker.representatives;
        combined.represented_configurations +=
            worker.represented_configurations;
        combined.satisfiable_representatives +=
            worker.satisfiable_representatives;
        combined.satisfiable_configurations +=
            worker.satisfiable_configurations;
        combined.contradiction_representatives +=
            worker.contradiction_representatives;
        combined.contradiction_configurations +=
            worker.contradiction_configurations;
        combined.forced_representatives += worker.forced_representatives;
        combined.forced_configurations += worker.forced_configurations;
        combined.solver_broken_representatives +=
            worker.solver_broken_representatives;
        combined.solver_broken_configurations +=
            worker.solver_broken_configurations;
        combined.novel_representatives += worker.novel_representatives;
        combined.novel_configurations += worker.novel_configurations;
        combined.novel_edge_total += worker.novel_edge_total;
        combined.patterns.append(&mut worker.patterns);
    }
    combined
        .patterns
        .sort_unstable_by_key(|pattern| pattern.code);
    combined
}

fn known_pattern_checks(geometry: &LocalGeometry) -> Result<String, String> {
    if geometry.width != 2 || geometry.height != 2 {
        return Ok("KNOWN_CHECK skipped (2x2でのみ実行)\n".into());
    }
    let diagonal_three = vec![3, -1, -1, 3];
    let forced = geometry
        .forced_edges(&diagonal_three)
        .ok_or_else(|| "斜め3-3が矛盾配置になりました".to_string())?;
    let expected = [
        geometry.h_id(0, 0),
        geometry.v_id(0, 0),
        geometry.h_id(1, 2),
        geometry.v_id(2, 1),
    ];
    if expected
        .iter()
        .any(|&edge| forced.state(edge) != EdgeState::Line)
    {
        return Err(
            "three_diagonal の遠い4辺をLineとして再発見できませんでした"
                .into(),
        );
    }
    let diagonal_three_zero = vec![3, -1, -1, 0];
    let forced = geometry
        .forced_edges(&diagonal_three_zero)
        .ok_or_else(|| "斜め3-0が矛盾配置になりました".to_string())?;
    let expected = [geometry.h_id(0, 1), geometry.v_id(1, 0)];
    if expected
        .iter()
        .any(|&edge| forced.state(edge) != EdgeState::Line)
    {
        return Err(
            "three_zero_diagonal の共有隅側2辺をLineとして再発見できませんでした"
                .into(),
        );
    }
    Ok("KNOWN_CHECK three_diagonal=PASS three_zero_diagonal=PASS\n".into())
}

fn code_from_clues(clues: &[i8]) -> u64 {
    clues.iter().rev().fold(0u64, |code, &clue| {
        code * 5 + (clue + 1) as u64
    })
}

fn basic_pattern_check(
    geometry: &LocalGeometry,
    patterns: &[Pattern],
    name: &str,
    clues: &[i8],
    expected: EdgeMasks,
) -> Result<(), String> {
    let code = code_from_clues(clues);
    let canonical = geometry.canonical_code(code);
    let pattern = patterns
        .iter()
        .find(|pattern| pattern.code == canonical)
        .ok_or_else(|| {
            format!("{name} が2x2の新規結果に現れませんでした")
        })?;
    let found = geometry.same_shape_kinds.iter().any(|&kind| {
        let mapping = LocalGeometry::cell_mapping(
            geometry.width,
            geometry.height,
            kind,
        );
        LocalGeometry::transformed_code_with_mapping(code, &mapping)
            == canonical
            && {
                let transformed = transform_masks(
                    geometry.width,
                    geometry.height,
                    expected,
                    kind,
                );
                pattern.novel.lines & transformed.lines == transformed.lines
                    && pattern.novel.crosses & transformed.crosses
                        == transformed.crosses
            }
    });
    if !found {
        return Err(format!(
            "{name} の期待辺が2x2の新規結果に含まれませんでした"
        ));
    }
    Ok(())
}

fn basic_pattern_checks(
    geometry: &LocalGeometry,
    patterns: &[Pattern],
    enabled: bool,
) -> Result<String, String> {
    if !enabled || geometry.width != 2 || geometry.height != 2 {
        return Ok(String::new());
    }
    basic_pattern_check(
        geometry,
        patterns,
        "zero_around",
        &[0, -1, -1, -1],
        EdgeMasks {
            lines: 0,
            crosses: geometry.cell_edges[0],
        },
    )?;
    basic_pattern_check(
        geometry,
        patterns,
        "three_adjacent",
        &[3, 3, -1, -1],
        EdgeMasks {
            lines: (1u64 << geometry.v_id(0, 0))
                | (1u64 << geometry.v_id(2, 0)),
            crosses: 0,
        },
    )?;
    basic_pattern_check(
        geometry,
        patterns,
        "three_diagonal",
        &[3, -1, -1, 3],
        EdgeMasks {
            lines: (1u64 << geometry.h_id(0, 0))
                | (1u64 << geometry.v_id(0, 0))
                | (1u64 << geometry.h_id(1, 2))
                | (1u64 << geometry.v_id(2, 1)),
            crosses: 0,
        },
    )?;
    basic_pattern_check(
        geometry,
        patterns,
        "three_zero_diagonal",
        &[3, -1, -1, 0],
        EdgeMasks {
            lines: (1u64 << geometry.h_id(0, 1))
                | (1u64 << geometry.v_id(1, 0)),
            crosses: 0,
        },
    )?;
    Ok(
        "BASIC_CHECK zero_around=PASS three_adjacent=PASS \
three_diagonal=PASS three_zero_diagonal=PASS\n"
            .into(),
    )
}

fn global_solution_exists(
    board: &Board,
    fixed: Option<(usize, EdgeState)>,
    preferred_edges: &[usize],
) -> bool {
    let mut engine = ConstraintEngine::new(board);
    if let Some((edge, state)) = fixed {
        if engine.set_edge(edge, state).is_err() {
            return false;
        }
    }
    global_search(board, &mut engine, preferred_edges)
}

fn global_search(
    board: &Board,
    engine: &mut ConstraintEngine<'_>,
    preferred_edges: &[usize],
) -> bool {
    if engine.propagate().is_err() {
        return false;
    }
    if !engine.has_unknown_edges() {
        return validate_solution(board, engine.edges()).is_empty();
    }
    if let Some(edge) = preferred_edges
        .iter()
        .copied()
        .find(|&edge| engine.edges()[edge] == EdgeState::Unknown)
    {
        for state in [EdgeState::Line, EdgeState::Cross] {
            let checkpoint = engine.checkpoint();
            if engine.set_edge(edge, state).is_ok()
                && global_search(board, engine, preferred_edges)
            {
                engine.rollback(checkpoint);
                return true;
            }
            engine.rollback(checkpoint);
        }
        false
    } else if let Some(candidates) = engine.endpoint_candidates() {
        for &chosen in &candidates {
            let checkpoint = engine.checkpoint();
            let branch = engine.set_edge(chosen, EdgeState::Line).and_then(|_| {
                for &other in &candidates {
                    if other != chosen {
                        engine.set_edge(other, EdgeState::Cross)?;
                    }
                }
                Ok(())
            });
            if branch.is_ok()
                && global_search(board, engine, preferred_edges)
            {
                engine.rollback(checkpoint);
                return true;
            }
            engine.rollback(checkpoint);
        }
        false
    } else {
        let edge = engine.best_unknown_edge();
        for state in [EdgeState::Line, EdgeState::Cross] {
            let checkpoint = engine.checkpoint();
            if engine.set_edge(edge, state).is_ok()
                && global_search(board, engine, preferred_edges)
            {
                engine.rollback(checkpoint);
                return true;
            }
            engine.rollback(checkpoint);
        }
        false
    }
}

#[derive(Default)]
struct SoundnessResult {
    checked_patterns: usize,
    checked_edges: usize,
    zero_solution_patterns: usize,
}

fn verify_soundness(
    geometry: &LocalGeometry,
    patterns: &[Pattern],
    maximum: usize,
) -> Result<SoundnessResult, String> {
    let mut result = SoundnessResult::default();
    let target = maximum.min(patterns.len());
    let mut order: Vec<_> = (0..patterns.len()).collect();
    Rng::new(1).shuffle(&mut order);
    for index in order.into_iter().take(target) {
        let pattern = &patterns[index];
        if pattern.prior.assigned() & pattern.novel.assigned() != 0 {
            return Err(format!("prior/novel重複: code={}", pattern.code));
        }
        let board = verification_board(geometry, &pattern.clues);
        let preferred_edges: Vec<_> = (0..geometry.edge_count)
            .map(|edge| local_to_padded_edge(geometry, &board, edge))
            .collect();
        if !global_solution_exists(&board, None, &preferred_edges) {
            result.zero_solution_patterns += 1;
            return Err(format!(
                "健全性違反（余白付き盤面に解なし）: code={} clues={}",
                pattern.code,
                clue_text(geometry, &pattern.clues)
            ));
        }
        for edge in 0..geometry.edge_count {
            let state = if pattern.prior.state(edge) != EdgeState::Unknown {
                pattern.prior.state(edge)
            } else {
                pattern.novel.state(edge)
            };
            if state == EdgeState::Unknown {
                continue;
            }
            let opposite = match state {
                EdgeState::Line => EdgeState::Cross,
                EdgeState::Cross => EdgeState::Line,
                EdgeState::Unknown => unreachable!("未確定辺を除外済み"),
            };
            let padded_edge = local_to_padded_edge(geometry, &board, edge);
            if global_solution_exists(
                &board,
                Some((padded_edge, opposite)),
                &preferred_edges,
            ) {
                return Err(format!(
                    "健全性違反: code={} edge={} expected={state:?}",
                    pattern.code,
                    edge_label(geometry, edge)
                ));
            }
            result.checked_edges += 1;
        }
        result.checked_patterns += 1;
    }
    Ok(result)
}

fn write_novel_file(
    path: &str,
    width: usize,
    height: usize,
    patterns: &[Pattern],
) -> Result<(), String> {
    let file =
        File::create(path).map_err(|error| format!("{path}: {error}"))?;
    let mut writer = BufWriter::new(file);
    writer
        .write_all(NOVEL_MAGIC)
        .and_then(|_| {
            writer.write_all(&[
                width as u8,
                height as u8,
                edge_count(width, height) as u8,
                0,
            ])
        })
        .and_then(|_| writer.write_all(&(patterns.len() as u64).to_le_bytes()))
        .map_err(|error| format!("{path}: {error}"))?;
    for pattern in patterns {
        writer
            .write_all(&pattern.code.to_le_bytes())
            .and_then(|_| {
                writer.write_all(&[
                    pattern.orbit_size as u8,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                    0,
                ])
            })
            .and_then(|_| writer.write_all(&pattern.novel.lines.to_le_bytes()))
            .and_then(|_| {
                writer.write_all(&pattern.novel.crosses.to_le_bytes())
            })
            .map_err(|error| format!("{path}: {error}"))?;
    }
    writer.flush().map_err(|error| format!("{path}: {error}"))
}

fn edge_label(geometry: &LocalGeometry, edge: usize) -> String {
    let horizontal = geometry.width * (geometry.height + 1);
    if edge < horizontal {
        format!(
            "H({},{})",
            edge % geometry.width,
            edge / geometry.width
        )
    } else {
        let offset = edge - horizontal;
        format!(
            "V({},{})",
            offset % (geometry.width + 1),
            offset / (geometry.width + 1)
        )
    }
}

fn clue_text(geometry: &LocalGeometry, clues: &[i8]) -> String {
    clues
        .chunks(geometry.width)
        .map(|row| {
            row.iter()
                .map(|&clue| {
                    if clue < 0 {
                        '.'
                    } else {
                        char::from_digit(clue as u32, 10).expect("0〜3")
                    }
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn state_text(geometry: &LocalGeometry, states: EdgeMasks) -> String {
    (0..geometry.edge_count)
        .filter_map(|edge| match states.state(edge) {
            EdgeState::Unknown => None,
            EdgeState::Line => {
                Some(format!("{}=L", edge_label(geometry, edge)))
            }
            EdgeState::Cross => {
                Some(format!("{}=X", edge_label(geometry, edge)))
            }
        })
        .collect::<Vec<_>>()
        .join(";")
}

fn write_tsv(
    path: &str,
    geometry: &LocalGeometry,
    patterns: &[Pattern],
) -> Result<(), String> {
    let file =
        File::create(path).map_err(|error| format!("{path}: {error}"))?;
    let mut writer = BufWriter::new(file);
    writeln!(writer, "code\torbit\tclues\tprior\tnovel")
        .map_err(|error| format!("{path}: {error}"))?;
    for pattern in patterns {
        writeln!(
            writer,
            "{}\t{}\t{}\t{}\t{}",
            pattern.code,
            pattern.orbit_size,
            clue_text(geometry, &pattern.clues),
            state_text(geometry, pattern.prior),
            state_text(geometry, pattern.novel),
        )
        .map_err(|error| format!("{path}: {error}"))?;
    }
    writer.flush().map_err(|error| format!("{path}: {error}"))
}

fn masks_as_states(geometry: &LocalGeometry, masks: EdgeMasks) -> Vec<EdgeState> {
    (0..geometry.edge_count)
        .map(|edge| masks.state(edge))
        .collect()
}

fn example_explanation(pattern: &Pattern) -> &'static str {
    if pattern.clue_count() <= 2 {
        "各新規辺を逆に仮定すると、数字制約・格子点次数・小ループ禁止の伝播で全枝が矛盾する。"
    } else {
        "説明不明。機械的には小ループ禁止を含む局所DFSで各新規辺の逆が全枝で矛盾することを確認した。"
    }
}

fn render_examples(
    geometry: &LocalGeometry,
    patterns: &[Pattern],
    maximum: usize,
) -> String {
    let mut selected: Vec<_> = patterns.iter().collect();
    selected.sort_unstable_by(|left, right| {
        left.clue_count()
            .cmp(&right.clue_count())
            .then_with(|| right.novel.count().cmp(&left.novel.count()))
            .then_with(|| left.code.cmp(&right.code))
    });
    let mut text = format!("EXAMPLES {}\n", selected.len().min(maximum));
    for (index, pattern) in selected.into_iter().take(maximum).enumerate() {
        let board = Board::new(
            geometry.width,
            geometry.height,
            pattern.clues.clone(),
        )
        .expect("局所盤面を作れる");
        text.push_str(&format!(
            "\nEXAMPLE {} code={} orbit={} clues={} novel_edges={}\n{}\n{}",
            index + 1,
            pattern.code,
            pattern.orbit_size,
            clue_text(geometry, &pattern.clues),
            pattern.novel.count(),
            example_explanation(pattern),
            format_board(&board, &masks_as_states(geometry, pattern.novel)),
        ));
    }
    text
}

fn selection_name(options: &Options) -> &'static str {
    if options.sample.is_some() {
        "sample"
    } else if options.max_clues.is_some() {
        "max_clues"
    } else if options.limit.is_some() {
        "limit"
    } else {
        "full"
    }
}

fn run(options: Options) -> Result<(), String> {
    let started = Instant::now();
    let geometry = LocalGeometry::new(options.width, options.height);
    let known_check = known_pattern_checks(&geometry)?;
    let known = KnownPatterns::load(&options.known)?;
    let expected_configurations =
        geometry.selected_configuration_count(options.max_clues);
    let expected_representatives =
        geometry.representative_total(options.max_clues);
    let enumeration_started = Instant::now();
    let codes = geometry.representative_codes(&options);
    let enumeration_ms = enumeration_started.elapsed().as_millis();
    let orbit_sum: u64 = codes
        .iter()
        .map(|&code| geometry.orbit_size(code) as u64)
        .sum();
    let exhaustive = options.sample.is_none()
        && options.limit.is_none()
        && (options.max_clues.is_some() || options.full || options.width * options.height < 12);
    if exhaustive
        && (codes.len() as u64 != expected_representatives
            || orbit_sum != expected_configurations)
    {
        return Err(format!(
            "対称性検算に失敗しました: representatives={}/{} orbit_sum={}/{}",
            codes.len(),
            expected_representatives,
            orbit_sum,
            expected_configurations
        ));
    }
    let discovery_started = Instant::now();
    let result =
        discover(
            &geometry,
            &known,
            &codes,
            options.threads,
            options.ignore_solver,
        );
    let discovery_ms = discovery_started.elapsed().as_millis();
    // 基本定石の検算は「2x2 を単独で調べたとき」にだけ意味がある。
    // 1x1 や 1x2 を既知として渡すと、0 の周囲や隣接 3–3 はそちらへ移るため、
    // 2x2 の新規結果に現れないのが正しい挙動になる。
    let basic_check = basic_pattern_checks(
        &geometry,
        &result.patterns,
        options.ignore_solver && options.known.is_empty(),
    )?;
    let soundness_started = Instant::now();
    let soundness =
        verify_soundness(&geometry, &result.patterns, options.soundness)?;
    let soundness_ms = soundness_started.elapsed().as_millis();
    if let Some(path) = &options.emit_novel {
        write_novel_file(
            path,
            geometry.width,
            geometry.height,
            &result.patterns,
        )?;
    }
    if let Some(path) = &options.out {
        write_tsv(path, &geometry, &result.patterns)?;
    }
    let average_novel_edges = if result.novel_representatives == 0 {
        0.0
    } else {
        result.novel_edge_total as f64
            / result.novel_representatives as f64
    };
    let prior_representatives = result
        .patterns
        .iter()
        .filter(|pattern| pattern.prior.count() > 0)
        .count();
    let prior_edge_total: usize = result
        .patterns
        .iter()
        .map(|pattern| pattern.prior.count())
        .sum();
    let average_prior_edges = if prior_representatives == 0 {
        0.0
    } else {
        prior_edge_total as f64 / prior_representatives as f64
    };
    let per_representative_ms = if result.representatives == 0 {
        0.0
    } else {
        discovery_ms as f64 / result.representatives as f64
    };
    let estimated_full_ms =
        per_representative_ms * geometry.representative_total(None) as f64;
    println!(
        "DISCOVER size={}x{} edges={} transforms={} threads={} selection={} ignore_solver={}",
        geometry.width,
        geometry.height,
        geometry.edge_count,
        geometry.same_shape_kinds.len(),
        options.threads.min(codes.len()).max(1),
        selection_name(&options),
        options.ignore_solver,
    );
    print!("{known_check}");
    print!("{basic_check}");
    println!(
        "KNOWN files={} records={} expanded_entries={}",
        options.known.len(),
        known.file_records,
        known.expanded_entries()
    );
    println!(
        "SYMMETRY representatives={} configurations={} status=PASS method=Burnside",
        expected_representatives, expected_configurations
    );
    println!(
        "ENUMERATED representatives={} orbit_sum={} exhaustive={}",
        result.representatives, result.represented_configurations, exhaustive
    );
    println!(
        "SATISFIABLE representatives={} configurations={}",
        result.satisfiable_representatives,
        result.satisfiable_configurations
    );
    println!(
        "CONTRADICTORY representatives={} configurations={}",
        result.contradiction_representatives,
        result.contradiction_configurations
    );
    println!(
        "FORCED representatives={} configurations={}",
        result.forced_representatives, result.forced_configurations
    );
    println!(
        "NOVEL representatives={} configurations={} average_edges={average_novel_edges:.6}",
        result.novel_representatives, result.novel_configurations
    );
    println!(
        "PRIOR representatives={prior_representatives} average_edges={average_prior_edges:.6}"
    );
    println!(
        "SOLVER_BROKEN representatives={} configurations={}",
        result.solver_broken_representatives,
        result.solver_broken_configurations
    );
    println!(
        "SOUNDNESS requested={} patterns={} edges={} zero_solution_patterns={}",
        options.soundness,
        soundness.checked_patterns,
        soundness.checked_edges,
        soundness.zero_solution_patterns
    );
    println!(
        "ESTIMATE per_representative_ms={per_representative_ms:.9} full_representatives={} full_discovery_ms={estimated_full_ms:.0} full_discovery_hours={:.3}",
        geometry.representative_total(None),
        estimated_full_ms / 3_600_000.0
    );
    println!(
        "TIME enumeration_ms={enumeration_ms} discovery_ms={discovery_ms} soundness_ms={soundness_ms} total_ms={}",
        started.elapsed().as_millis()
    );
    if let Some(path) = &options.emit_novel {
        println!("NOVEL_FILE path={path} records={}", result.patterns.len());
    }
    if let Some(path) = &options.out {
        println!("OUT path={path} records={}", result.patterns.len());
    }
    print!("{}", render_examples(&geometry, &result.patterns, 5));
    Ok(())
}

fn main() -> ExitCode {
    let args: Vec<_> = env::args().skip(1).collect();
    match parse_args(&args) {
        Ok(None) => {
            print!("{USAGE}");
            ExitCode::SUCCESS
        }
        Ok(Some(options)) => match run(options) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("{error}");
                ExitCode::from(1)
            }
        },
        Err(error) => {
            eprintln!("{error}");
            eprint!("{USAGE}");
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn brute_force_consensus(
        geometry: &LocalGeometry,
        clues: &[i8],
    ) -> Option<EdgeMasks> {
        let mut solutions = Vec::new();
        for lines in 0..=geometry.all_edges {
            let cells_valid = clues
                .iter()
                .zip(&geometry.cell_edges)
                .all(|(&clue, &mask)| {
                    clue < 0 || (lines & mask).count_ones() == clue as u32
                });
            let internal_valid = geometry
                .internal_vertices
                .iter()
                .all(|&mask| matches!((lines & mask).count_ones(), 0 | 2));
            let boundary_valid = geometry
                .boundary_vertices
                .iter()
                .all(|&mask| (lines & mask).count_ones() <= 2);
            let loop_valid = geometry
                .closed_loop_edges(lines)
                .is_none_or(|component| component == lines);
            if cells_valid && internal_valid && boundary_valid && loop_valid {
                solutions.push(lines);
            }
        }
        let first = *solutions.first()?;
        let mut consensus = EdgeMasks::default();
        for edge in 0..geometry.edge_count {
            let bit = 1u64 << edge;
            let first_line = first & bit != 0;
            if solutions
                .iter()
                .all(|&solution| (solution & bit != 0) == first_line)
            {
                consensus
                    .insert(
                        edge,
                        if first_line {
                            EdgeState::Line
                        } else {
                            EdgeState::Cross
                        },
                    )
                    .expect("全解の合意は矛盾しない");
            }
        }
        Some(consensus)
    }

    fn test_options(width: usize, height: usize) -> Options {
        Options {
            width,
            height,
            threads: 1,
            limit: None,
            sample: None,
            seed: 1,
            max_clues: None,
            known: Vec::new(),
            ignore_solver: false,
            emit_novel: None,
            out: None,
            soundness: 0,
            full: false,
        }
    }

    #[test]
    fn known_two_by_two_rules_are_rediscovered() {
        let geometry = LocalGeometry::new(2, 2);
        assert!(known_pattern_checks(&geometry).is_ok());
    }

    #[test]
    fn closed_loop_rejects_a_separate_line() {
        let geometry = LocalGeometry::new(2, 2);
        let closed_loop = (1u64 << geometry.h_id(0, 0))
            | (1u64 << geometry.h_id(0, 1))
            | (1u64 << geometry.v_id(0, 0))
            | (1u64 << geometry.v_id(1, 0));
        let separate_line = 1u64 << geometry.h_id(1, 2);
        let mut assigned = closed_loop | separate_line;
        let mut lines = assigned;
        assert!(!geometry.propagate(
            &[-1, -1, -1, -1],
            &mut assigned,
            &mut lines
        ));
    }

    #[test]
    fn boundary_degree_one_does_not_close_a_component() {
        let geometry = LocalGeometry::new(2, 2);
        let open_line = 1u64 << geometry.h_id(0, 0);
        assert_eq!(geometry.closed_loop_edges(open_line), None);
    }

    #[test]
    fn invalid_three_by_three_example_is_contradictory() {
        let geometry = LocalGeometry::new(3, 3);
        let clues = [1, 2, 1, 3, -1, 3, -1, 3, -1];
        assert_eq!(geometry.forced_edges(&clues), None);
    }

    #[test]
    fn every_two_by_two_result_matches_brute_force() {
        let geometry = LocalGeometry::new(2, 2);
        for code in 0..5u64.pow(4) {
            let clues = geometry.decode_clues(code);
            assert_eq!(
                geometry.forced_edges(&clues),
                brute_force_consensus(&geometry, &clues),
                "code={code} clues={clues:?}"
            );
        }
    }

    #[test]
    fn square_and_rectangle_symmetry_cover_all_configurations() {
        for (width, height) in [(2, 2), (2, 3), (3, 3)] {
            let geometry = LocalGeometry::new(width, height);
            let options = test_options(width, height);
            let representatives = geometry.representative_codes(&options);
            assert_eq!(
                representatives.len() as u64,
                geometry.representative_total(None)
            );
            assert_eq!(
                representatives
                    .iter()
                    .map(|&code| geometry.orbit_size(code) as u64)
                    .sum::<u64>(),
                geometry.total_configurations()
            );
        }
    }

    #[test]
    fn sparse_symmetry_counts_are_exact() {
        let geometry = LocalGeometry::new(3, 4);
        let mut options = test_options(3, 4);
        options.max_clues = Some(2);
        let representatives = geometry.representative_codes(&options);
        assert_eq!(
            representatives.len() as u64,
            geometry.representative_total(Some(2))
        );
        assert_eq!(
            representatives
                .iter()
                .map(|&code| geometry.orbit_size(code) as u64)
                .sum::<u64>(),
            geometry.selected_configuration_count(Some(2))
        );
    }

    #[test]
    fn rectangle_rotation_swaps_dimensions_and_preserves_edges() {
        let geometry = LocalGeometry::new(2, 3);
        let pattern = Pattern {
            code: 1,
            orbit_size: 4,
            clues: geometry.decode_clues(1),
            prior: EdgeMasks::default(),
            novel: EdgeMasks {
                lines: 1,
                crosses: 1 << (geometry.edge_count - 1),
            },
        };
        let rotated = transform_pattern(&geometry, &pattern, 1);
        assert_eq!(rotated.clues.len(), 6);
        assert_eq!(rotated.novel.count(), 2);
        assert!(rotated.novel.lines & rotated.novel.crosses == 0);
    }

    #[test]
    fn cumulative_two_by_two_patterns_remove_their_own_novelty() {
        let geometry = LocalGeometry::new(2, 2);
        let options = test_options(2, 2);
        let codes = geometry.representative_codes(&options);
        let first =
            discover(
                &geometry,
                &KnownPatterns::default(),
                &codes,
                1,
                false,
            );
        assert_eq!(first.novel_representatives, 7);
        assert_eq!(first.novel_configurations, 30);
        let known =
            KnownPatterns::from_patterns(2, 2, &first.patterns).unwrap();
        let second = discover(&geometry, &known, &codes, 1, false);
        assert_eq!(second.novel_representatives, 0);
        assert_eq!(second.novel_configurations, 0);
    }

    #[test]
    fn ignoring_solver_rediscovers_basic_two_by_two_patterns() {
        let geometry = LocalGeometry::new(2, 2);
        let options = test_options(2, 2);
        let codes = geometry.representative_codes(&options);
        let result = discover(
            &geometry,
            &KnownPatterns::default(),
            &codes,
            1,
            true,
        );
        assert!(result
            .patterns
            .iter()
            .all(|pattern| pattern.prior.count() == 0));
        assert!(
            basic_pattern_checks(&geometry, &result.patterns, true).is_ok()
        );
    }

    #[test]
    fn cumulative_options_are_parsed() {
        let args = [
            "--size",
            "3x4",
            "--limit",
            "100000",
            "--known",
            "a.bin,b.bin",
            "--ignore-solver",
            "--emit-novel",
            "c.bin",
        ]
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
        let options = parse_args(&args)
            .expect("累積探索オプションを解釈できる")
            .expect("ヘルプではない");
        assert_eq!((options.width, options.height), (3, 4));
        assert_eq!(options.limit, Some(100_000));
        assert_eq!(options.known, ["a.bin", "b.bin"]);
        assert!(options.ignore_solver);
        assert_eq!(options.emit_novel.as_deref(), Some("c.bin"));
        assert_eq!(options.soundness, usize::MAX);
    }
}
