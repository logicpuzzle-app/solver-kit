import { CSPUZ_KINDS } from "./sdk/cspuz-kinds.js";

export const I18N = {
  "other_cspuz_puzzles": {"ja": "その他（対応パズル一覧を参照）", "en": "Others (see supported puzzles)"},
  "supported_puzzles": {"ja": "対応パズル（日英名）", "en": "Supported puzzles (Japanese / English)"},
  "cspuz_support": {"ja": "ナンバーリンクと、cspuz が対応する{n}種を解けます。うち数独・スリザーリンク・ヤジリン・ぬりかべ・美術館・ましゅは難易度も推定します。", "en": "Numberlink and the {n} types supported by cspuz. Difficulty is also estimated for Sudoku, Slitherlink, Yajilin, Nurikabe, Akari and Masyu."},
  "common_cells": {"ja": "確定しているマスのみ", "en": "Cells determined in all solutions"},
  "example_solution": {"ja": "解の一例", "en": "One example solution"},
  "undetermined": {"ja": "判定できず", "en": "Could not determine uniqueness"},
  "unsupported_puzzle": {"ja": "対応していないパズルです。", "en": "Unsupported puzzle type."},

  "lead": {
    "ja": "puzz.link の URL を貼ると、パズルを解いて唯一解かどうかと解答を示します。対応は{total}種です。数独・スリザーリンク・ヤジリン・ぬりかべ・美術館・ましゅは難易度も推定します。すべてブラウザ内(WebAssembly)で動きます。",
    "en": "Paste a puzz.link URL to solve the puzzle, check whether its solution is unique and view the answer. {total} puzzle types are supported. For Sudoku, Slitherlink, Yajilin, Nurikabe, Akari and Masyu, difficulty is also estimated. Everything runs in your browser (WebAssembly)."
  },
  "solve": {
    "ja": "解く",
    "en": "Solve"
  },
  "engine": {
    "ja": "エンジン",
    "en": "Engine"
  },
  "sat": {
    "ja": "並列SAT",
    "en": "Parallel SAT"
  },
  "dfs": {
    "ja": "行走査DFS",
    "en": "Row-scan DFS"
  },
  "portfolio": {
    "ja": "行走査DFS + 並列SAT の並走",
    "en": "Row-scan DFS and parallel SAT in parallel"
  },
  "workers": {
    "ja": "ワーカー数",
    "en": "Workers"
  },
  "auto": {
    "ja": "自動",
    "en": "Auto"
  },
  "settings": {
    "ja": "ナンバーリンクの設定",
    "en": "Numberlink settings"
  },
  "auto_choice": {
    "ja": "自動: {engine} · {threads} ワーカー",
    "en": "Auto: {engine} · {threads} workers"
  },
  "engine_hint": {
    "ja": "20×20 以下は行走査DFS が最速（puzsq の盤面で検証）。400 マスを超える盤面は行走査DFS と並列SAT を並走させ、先に解けた方を使う。既定は盤面サイズで自動選択。",
    "en": "Row-scan DFS is fastest up to 20×20 (verified on puzsq boards). Boards over 400 cells run row-scan DFS and parallel SAT side by side and use whichever finishes first. The default follows the board size."
  },
  "examples_intro": {
    "ja": "例(数独・スリザーリンク・ヤジリンは自動生成、ぬりかべとナンバーリンク 20×20 は",
    "en": "Examples (Sudoku, Slitherlink and Yajilin are generated; Nurikabe and 20×20 Numberlink are from "
  },
  "puzzle_square": {
    "ja": "パズルスクエア",
    "en": "Puzzle Square"
  },
  "examples_source": {
    "ja": "の実問題。括弧内が出典):",
    "en": "; sources are in parentheses):"
  },
  "sudoku": {
    "ja": "数独",
    "en": "Sudoku"
  },
  "yajilin": {
    "ja": "ヤジリン",
    "en": "Yajilin"
  },
  "slitherlink": {
    "ja": "スリザーリンク",
    "en": "Slitherlink"
  },
  "nurikabe": {
    "ja": "ぬりかべ",
    "en": "Nurikabe"
  },
  "akari": {
    "ja": "美術館",
    "en": "Akari"
  },
  "masyu": {
    "ja": "ましゅ",
    "en": "Masyu"
  },
  "solving": {
    "ja": "解析中…",
    "en": "Solving…"
  },
  "cancel": {
    "ja": "中断",
    "en": "Stop"
  },
  "details": {
    "ja": "詳細",
    "en": "Details"
  },
  "changelog": {
    "ja": "更新履歴",
    "en": "Changelog"
  },
  "source_code": {
    "ja": "ソースコード(MIT / 数独エンジンは GPL-3.0)",
    "en": "Source code (MIT / Sudoku engine GPL-3.0)"
  },
  "close": {
    "ja": "閉じる",
    "en": "Close"
  },
  "footer_intro": {
    "ja": "LogicPuzzle Solver は",
    "en": "LogicPuzzle Solver is a puzzle solver by "
  },
  "footer_outro": {
    "ja": "のパズルソルバーです。",
    "en": "."
  },
  "calibration_intro": {
    "ja": "難易度は",
    "en": "Difficulty ratings are estimates calibrated against human ratings on "
  },
  "calibration_outro": {
    "ja": "の人手評価との較正に基づく推定です。スリザーリンクとヤジリンは盤面の大きさで補正しますが、数独は 9×9 の較正をそのまま使うため、それ以外の大きさでは★がずれることがあります。",
    "en": ". Slitherlink and Yajilin ratings account for board size. Sudoku uses 9×9 calibration, so ratings for other sizes may be less accurate."
  },
  "puzzle": {
    "ja": "パズル",
    "en": "Puzzle"
  },
  "calibration": {
    "ja": "較正",
    "en": "Calibration"
  },
  "model": {
    "ja": "モデル",
    "en": "Model"
  },
  "rust_rewrite_license": {
    "ja": "の Rust リライト(GPL-3.0)",
    "en": " rewritten in Rust (GPL-3.0)"
  },
  "sudoku_calibration": {
    "ja": "211 問(9×9 が 85%)",
    "en": "211 puzzles (85% are 9×9)"
  },
  "slither_calibration": {
    "ja": "1,585 問",
    "en": "1,585 puzzles"
  },
  "nuri_calibration": {
    "ja": "1,234 問",
    "en": "1,234 puzzles"
  },
  "akari_calibration": {
    "ja": "2,591 問",
    "en": "2,591 puzzles"
  },
  "yajilin_calibration": {
    "ja": "8,822 問",
    "en": "8,822 puzzles"
  },
  "masyu_calibration": {
    "ja": "2,712 問",
    "en": "2,712 puzzles"
  },
  "unsupported": {
    "ja": "未対応",
    "en": "Not supported"
  },
  "numberlink": {
    "ja": "ナンバーリンク",
    "en": "Numberlink"
  },
  "news_numlin_title": {
    "ja": "ナンバーリンクに対応しました。",
    "en": "Added Numberlink support."
  },
  "news_numlin": {
    "ja": "解の有無と唯一性の判定、解答図を表示します。 難易度判定は未対応です。複数の Web Worker で並列に解きます。",
    "en": " Check whether a solution exists, whether it is unique, and view the answer. Difficulty ratings are not yet supported. Solving runs in parallel using multiple Web Workers."
  },
  "news_masyu_title": {
    "ja": "ましゅに対応しました。",
    "en": "Added Masyu support."
  },
  "news_masyu": {
    "ja": "2,716 問中 2,713 問(99.9%)を手筋で 解き切ります。人手評価との一致は 57.4%(±1 以内 97.2%)です。",
    "en": " Techniques solve 2,713 of 2,716 puzzles (99.9%). Difficulty ratings match human ratings in 57.4% of cases (97.2% within one star)."
  },
  "news_akari_title": {
    "ja": "美術館に対応しました。",
    "en": "Added Akari support."
  },
  "news_akari": {
    "ja": "照らされているマスを薄い色で示すので、 途中まで解けた盤面でも「まだ暗いのはどこか」が分かります。 人手評価との一致は 62.8%(±1 以内 98.6%)で、いま対応している中では最も高い精度です。 2,591 問中 2,585 問を手筋で解き切ります。",
    "en": " Lit cells have a pale background, making unlit areas visible even in partial solutions. Ratings match human ratings in 62.8% of cases (98.6% within one star), the highest accuracy among supported puzzles. Techniques solve 2,585 of 2,591 puzzles."
  },
  "news_multiple_title": {
    "ja": "解が複数ある問題に難易度をつけないようにしました。",
    "en": "Puzzles with multiple solutions no longer receive difficulty ratings."
  },
  "news_multiple": {
    "ja": "答えが 1 つに決まらない問題に「難しさ」は定義できないためです。 解の個数が確かめられなかったときは、複数あると決めつけずに難易度を出します。",
    "en": " Difficulty is undefined when a puzzle has no single answer. If the solution count cannot be confirmed, a rating is still shown without assuming there are multiple solutions."
  },
  "news_nurikabe_title": {
    "ja": "ぬりかべに対応しました。",
    "en": "Added Nurikabe support."
  },
  "news_nurikabe": {
    "ja": "パズルスクエアの 1,234 問で較正し、 93% を解けます。",
    "en": " Calibrated on 1,234 Puzzle Square puzzles; 93% can be solved."
  },
  "news_scale": {
    "ja": "あわせて、同じ難易度の中の細かい差が数値で分かるようにしました。これまでは推定が 段階ごとに固まっていて、同じ読みの深さの問題がどれも同じ値になっていました。 いまは 0.1 刻みのどこにも問題が入るよう、較正コーパスの分布で目盛りを割っています。",
    "en": "Numeric ratings now show finer differences within each difficulty level. Previously, puzzles requiring the same depth of reasoning received the same value. The scale now follows the calibration corpus distribution, allowing ratings at any 0.1 increment."
  },
  "news_stop_before": {
    "ja": "難しい盤面は仮置きを深く潜るため、解析に数十秒かかることがあります。 待てないときは",
    "en": "Hard puzzles may take tens of seconds as the solver explores deeper assumptions. To end the search, press "
  },
  "news_stop_after": {
    "ja": "を押してください。",
    "en": "."
  },
  "news_v5_before": {
    "ja": "ヤジリンの難易度を",
    "en": "Updated Yajilin difficulty ratings to "
  },
  "news_v5_after": {
    "ja": "に更新しました。難しさの主軸を「解くのに要った読みの段階」 に変えています。基本手筋だけで解けるのか、本数の勘定まで要るのか、仮置きが要るのか—— 人が難しさを言うときの区別をそのまま目盛りにしました。あわせて「手筋だけでどこまで進めたか」を 評価に加えています。人手評価との一致は 58.7% から 59.7% に上がりました。",
    "en": ". Ratings now primarily reflect the reasoning required: basic techniques, counting lines, or making assumptions. They also account for how far techniques alone can take the solution. Agreement with human ratings rose from 58.7% to 59.7%."
  },
  "news_v4_after": {
    "ja": "に更新しました。盤面の大きさに応じた補正が強すぎて、 小さい盤面を高く(6×6 で ★0.55 ぶん)、大きい盤面を低く見積もっていたのを補正し直しています。 どの盤面サイズでもずれは ★0.13 以内に収まり、人手評価との一致は 56% から 57% に上がりました。",
    "en": ". Corrected an excessive board-size adjustment that overrated small boards (by 0.55 stars for 6×6) and underrated large ones. The bias is now within 0.13 stars at every size, and agreement with human ratings rose from 56% to 57%."
  },
  "news_v3_after": {
    "ja": "に更新しました。v2 では最上位の目盛りを低く取りすぎて、 94 問が上限の 5.49 に張り付き、上位の順序が潰れていました。目盛りの上端を広げて 5 問まで減らしています。 ★の判定そのものは変わりません。",
    "en": ". In v2, 94 puzzles hit the 5.49 ceiling, obscuring differences among the hardest puzzles. Expanding the upper scale reduced that number to five. Star classifications are unchanged."
  },
  "news_v2_before": {
    "ja": "ヤジリンの",
    "en": "Updated the Yajilin "
  },
  "news_v2_title": {
    "ja": "難易度モデルを v2 に更新",
    "en": "difficulty model to v2"
  },
  "news_v2_after": {
    "ja": "しました。カット偶奇の手筋 (盤面を直線で分けたとき境界を横切る線は偶数、かつ両側に必ず通るマスがあれば 2 本以上) をソルバーに追加し、パズルスクエアの 8,814 問で再較正しています。 人手評価との完全一致は 47% から 56% に上がりました。",
    "en": ". Added cut-parity reasoning: a straight cut crosses an even number of lines, with at least two if both sides contain cells the loop must visit. Recalibrated on 8,814 Puzzle Square puzzles. Exact agreement with human ratings rose from 47% to 56%."
  },
  "news_workers": {
    "ja": "解答中に固まらないよう、解く処理を Web Worker に分離しました。あわせて 難易度バー・解析中アニメーションを追加しています。",
    "en": "Moved solving into a Web Worker to keep the page responsive. Added a difficulty bar and a solving animation."
  },
  "news_slither_title": {
    "ja": "スリザーリンクに対応",
    "en": "Added Slitherlink support"
  },
  "news_slither": {
    "ja": "しました。数独・スリザーリンク・ヤジリンの 3 種を ★1〜5 の推定つきで解けます。",
    "en": ". Sudoku, Slitherlink and Yajilin can be solved with estimated ratings of one to five stars."
  },
  "news_launch": {
    "ja": "LogicPuzzle Solver を公開しました。",
    "en": "Launched LogicPuzzle Solver."
  },
  "title": {
    "ja": "LogicPuzzle Solver — {total}種のパズルに対応",
    "en": "LogicPuzzle Solver — {total} puzzle types"
  },
  "description": {
    "ja": "puzz.link の URL から{total}種のパズルを解き、唯一解かどうかと解答を示すソルバー。数独など6種は難易度も推定。ブラウザ内で動作。",
    "en": "Solve {total} puzzle types from a puzz.link URL, check uniqueness and view the answer. Difficulty is also estimated for six types including Sudoku. Runs in your browser."
  },
  "og_title": {
    "ja": "LogicPuzzle Solver — {total}種のパズルに対応",
    "en": "LogicPuzzle Solver — {total} puzzle types"
  },
  "og_description": {
    "ja": "puzz.link の URL から{total}種のパズルを解き、唯一解かどうかと解答を示します。数独など6種は難易度も推定。",
    "en": "Solve {total} puzzle types from a puzz.link URL and check uniqueness. Difficulty is also estimated for six types including Sudoku."
  },
  "placeholder": {
    "ja": "https://puzz.link/p?sudoku/9/9/… または p?numlin/15/15/…",
    "en": "https://puzz.link/p?sudoku/9/9/… or p?numlin/15/15/…"
  },
  "puzzle_url": {
    "ja": "問題URL",
    "en": "Puzzle URL"
  },
  "source_374": {
    "ja": "パズルスクエア #374 by K.N.Y.",
    "en": "Puzzle Square #374 by K.N.Y."
  },
  "source_5505": {
    "ja": "パズルスクエア #5505 by 結城",
    "en": "Puzzle Square #5505 by 結城"
  },
  "source_3720": {
    "ja": "パズルスクエア #3720 by mlph",
    "en": "Puzzle Square #3720 by mlph"
  },
  "source_127124": {
    "ja": "パズルスクエア #127124 by 名無し",
    "en": "Puzzle Square #127124 by 名無し"
  },
  "source_2592": {
    "ja": "パズルスクエア #2592 by willow",
    "en": "Puzzle Square #2592 by willow"
  },
  "language": {
    "ja": "言語",
    "en": "Language"
  },
  "solver_failed": {
    "ja": "ソルバーの実行に失敗しました",
    "en": "The solver failed to run."
  },
  "solving_button": {
    "ja": "解析中",
    "en": "Solving…"
  },
  "stopped_error": {
    "ja": "中断・エラー",
    "en": "Stopped / error"
  },
  "multiple_solutions": {
    "ja": "解が複数あります",
    "en": "Multiple solutions"
  },
  "unique_solution": {
    "ja": "唯一解",
    "en": "Unique solution"
  },
  "no_solution": {
    "ja": "解がありません",
    "en": "No solution"
  },
  "numlin_difficulty": {
    "ja": "難易度判定は未対応(解の有無と唯一性のみ)",
    "en": "Difficulty ratings are not yet supported (solutions and uniqueness only)"
  },
  "answer": {
    "ja": "解答図",
    "en": "Answer"
  },
  "problem": {
    "ja": "問題図",
    "en": "Puzzle"
  },
  "board_size": {
    "ja": "盤面サイズ",
    "en": "Board size"
  },
  "answers_limit": {
    "ja": "解の数(上限 2)",
    "en": "Solutions (up to 2)"
  },
  "detour_note": {
    "ja": "経路の形が異なる解は 1 つですが、赤の破線のように線を迂回させた別解があります",
    "en": "Only one solution differs in path topology, but a path can be rerouted as shown by the red dashed line"
  },
  "at_least_two": {
    "ja": "2 以上",
    "en": "2 or more"
  },
  "winner": {
    "ja": "先着",
    "en": "Finished first"
  },
  "plain_sat": {
    "ja": "単体 SAT",
    "en": "Plain SAT"
  },
  "cube_split": {
    "ja": "cube 分割",
    "en": "Cubes"
  },
  "elapsed": {
    "ja": "解析時間",
    "en": "Elapsed"
  },
  "direction": {
    "ja": "方向",
    "en": "Direction"
  },
  "steps": {
    "ja": "ステップ数",
    "en": "Steps"
  },
  "cubes": {
    "ja": "キューブ数",
    "en": "Cubes"
  },
  "multiple_short": {
    "ja": "複数解",
    "en": "Multiple solutions"
  },
  "none_short": {
    "ja": "解なし",
    "en": "No solution"
  },
  "uniqueness_stopped": {
    "ja": "唯一解の確認は打ち切り",
    "en": "Uniqueness check stopped early"
  },
  "board": {
    "ja": "盤面",
    "en": "Board"
  },
  "dp_techniques": {
    "ja": "DP(手筋のみ)",
    "en": "DP (techniques only)"
  },
  "unresolved": {
    "ja": "手筋で未確定",
    "en": "Unresolved by techniques"
  },
  "dp_adjusted": {
    "ja": "DP(補正後)",
    "en": "DP (adjusted)"
  },
  "solution_count": {
    "ja": "解の個数",
    "en": "Solutions"
  },
  "difficulty_model": {
    "ja": "難易度モデル",
    "en": "Difficulty model"
  },
  "sudoku_engine": {
    "ja": "NPGenerator V2.0.2 (Rust リライト)",
    "en": "NPGenerator V2.0.2 (Rust rewrite)"
  },
  "partial_solution": {
    "ja": "完解できず(表示は途中まで)",
    "en": "Could not finish (partial solution shown)"
  },
  "dp_raw": {
    "ja": "DP(生スコア)",
    "en": "DP (raw score)"
  },
  "dpn_normalized": {
    "ja": "DPN(正規化)",
    "en": "DPN (normalized)"
  },
  "band": {
    "ja": "バンド",
    "en": "Band"
  },
  "solver_status": {
    "ja": "ソルバー状態",
    "en": "Solver status"
  },
  "unrated": {
    "ja": "判定不能",
    "en": "Unable to rate"
  },
  "reasoning": {
    "ja": "要った読み",
    "en": "Reasoning required"
  },
  "within_level": {
    "ja": "段階内のスコア",
    "en": "Score within level"
  },
  "basic": {
    "ja": "基本手筋",
    "en": "Basic techniques"
  },
  "row_column_counts": {
    "ja": "行・列の本数",
    "en": "Row and column line counts"
  },
  "cut_parity": {
    "ja": "切り口のパリティ",
    "en": "Cut parity"
  },
  "line_count_theory": {
    "ja": "線の本数の理論",
    "en": "Line-count reasoning"
  },
  "assumptions": {
    "ja": "仮置き",
    "en": "Assumptions"
  },
  "techniques_incomplete": {
    "ja": "手筋では未完",
    "en": "Techniques insufficient"
  },
  "unknown": {
    "ja": "不明",
    "en": "Unknown"
  },
  "circle_degree": {
    "ja": "丸の基本と次数",
    "en": "Circle basics and vertex degrees"
  },
  "white_turns": {
    "ja": "白丸の曲がりと小ループ禁",
    "en": "White-circle turns and avoiding small loops"
  },
  "connectivity_parity": {
    "ja": "連結性とカット偶奇",
    "en": "Connectivity and cut parity"
  },
  "circle_cases": {
    "ja": "丸まわりの場合分け",
    "en": "Case analysis around circles"
  },
  "shallow": {
    "ja": "浅い仮置き",
    "en": "Shallow assumptions"
  },
  "nested": {
    "ja": "入れ子の仮置き",
    "en": "Nested assumptions"
  },
  "clues_lamps": {
    "ja": "数字と相互照射禁",
    "en": "Clues and preventing lamps from lighting each other"
  },
  "rescue": {
    "ja": "救出",
    "en": "Rescue"
  },
  "placement_contradiction": {
    "ja": "置くと破綻",
    "en": "Contradictory placements"
  },
  "clue_cases": {
    "ja": "数字まわりの場合分け",
    "en": "Case analysis around clues"
  },
  "lighting_cases": {
    "ja": "照らし手の場合分け",
    "en": "Case analysis for lighting cells"
  },
  "around_clues": {
    "ja": "数字のまわり",
    "en": "Around clues"
  },
  "counting": {
    "ja": "数え上げ",
    "en": "Counting"
  },
  "connectivity": {
    "ja": "連結性",
    "en": "Connectivity"
  },
  "shape_enumeration": {
    "ja": "形の列挙",
    "en": "Shape enumeration"
  },
  "numlin_failed": {
    "ja": "ナンバーリンクの解析に失敗しました: {error}",
    "en": "Numberlink solving failed: {error}"
  },
  "search_incomplete": {
    "ja": "{n} (探索未完了)",
    "en": "{n} (search incomplete)"
  },
  "sudoku_remaining": {
    "ja": "手筋で残り {n} マス(紫=仮置きで確定)",
    "en": "{n} cells left by techniques (purple = resolved by assumptions)"
  },
  "sudoku_board": {
    "ja": "{n}×{n}(ブロック {w}×{h})",
    "en": "{n}×{n} ({w}×{h} blocks)"
  },
  "cells": {
    "ja": "{n} マス",
    "en": "{n} cells"
  },
  "remaining_cells": {
    "ja": "手筋では {n} マス残る(表示は途中まで)",
    "en": "{n} cells unresolved by techniques (partial solution shown)"
  },
  "remaining_edges": {
    "ja": "手筋では辺が {n} 本残る(表示は途中まで)",
    "en": "{n} edges unresolved by techniques (partial solution shown)"
  },
  "partial_solution_filled": {
    "ja": "手筋では完解できず(盤面は cspuz の解答)",
    "en": "Techniques could not finish (board shows the cspuz answer)"
  },
  "remaining_cells_filled": {
    "ja": "手筋では {n} マス残る(盤面は cspuz の解答)",
    "en": "{n} cells unresolved by techniques (board shows the cspuz answer)"
  },
  "remaining_edges_filled": {
    "ja": "手筋では辺が {n} 本残る(盤面は cspuz の解答)",
    "en": "{n} edges unresolved by techniques (board shows the cspuz answer)"
  },
  "progress_dfs": {
    "ja": "解析中… 方向レース {done}/{total} · {threads} ワーカー · {seconds} s",
    "en": "Solving… Racing directions {done}/{total} · {threads} workers · {seconds} s"
  },
  "progress_dfs_continuation": {
    "ja": "解析中… 方向 {direction} を探索中{estimate} · {seconds} s",
    "en": "Solving… Searching direction {direction}{estimate} · {seconds} s"
  },
  "progress_sat": {
    "ja": "解析中… {done}/{total}{estimate} · {threads} ワーカー · {seconds} s",
    "en": "Solving… {done}/{total}{estimate} · {threads} workers · {seconds} s"
  },
  "progress_estimate": {
    "ja": " · 推定 {n}%",
    "en": " · estimated {n}%"
  },
  "error_engine": {
    "ja": "ナンバーリンクのエンジンが不明です。",
    "en": "Unknown Numberlink engine."
  },
  "error_workers": {
    "ja": "ワーカー数は1〜64で指定してください。",
    "en": "Workers must be 1..64."
  },
  "error_url": {
    "ja": "puzz.link のナンバーリンクURLを入力してください。",
    "en": "Enter a puzz.link Numberlink URL (or p?numlin/… path)."
  },
  "error_hints": {
    "ja": "問題データが不正です。サイズ・符号・数字のペアを確認してください。",
    "en": "Invalid puzzle hints. Check dimensions, encoding and clue pairs."
  },
  "error_dimensions": {
    "ja": "盤面サイズがこのエンジンの上限を超えています。",
    "en": "Board dimensions exceed this engine’s limits."
  },
  "error_pairs": {
    "ja": "このエンジンの数字ペアは254組までです。",
    "en": "This engine supports at most 254 clue pairs."
  },
  "error_memory": {
    "ja": "メモリが不足しています。ワーカー数を減らしてください。",
    "en": "Insufficient memory. Reduce workers."
  },
  "error_load": {
    "ja": "ソルバーを読み込めませんでした。ページを再読み込みしてください。",
    "en": "Could not load the solver. Reload the page and try again."
  }
};

const validLang = lang => lang === "ja" || lang === "en";
let language = new URLSearchParams(location.search).get("lang");
if (!validLang(language)) {
  try { language = localStorage.getItem("solver-lang"); } catch {}
}
if (!validLang(language)) language = navigator.language?.startsWith("ja") ? "ja" : "en";

export function currentLang() { return language; }

export function t(key, vars = {}) {
  return I18N[key][language].replace(/\{(\w+)\}/g, (match, name) => vars[name] ?? (name === "n" ? CSPUZ_KINDS.length : name === "total" ? CSPUZ_KINDS.length + 1 : match));
}

export function setLang(lang) {
  if (!validLang(lang)) return;
  language = lang;
  try { localStorage.setItem("solver-lang", lang); } catch {}
  applyStatic();
}

export function applyStatic() {
  document.documentElement.lang = language;
  document.title = t("title");
  document.querySelector('meta[name="description"]').content = t("description");
  for (const property of ["og:title", "og:description"]) {
    document.querySelector(`meta[property="${property}"]`).content = t(property.replace(":", "_"));
  }
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const attr of ["placeholder", "title", "aria-label"]) {
    for (const node of document.querySelectorAll(`[data-i18n-${attr}]`)) {
      node.setAttribute(attr, t(node.getAttribute(`data-i18n-${attr}`)));
    }
  }
  for (const input of document.querySelectorAll('[name="language"]')) input.checked = input.value === language;
}
