# Slitherlink Kit — 設計

スリザーリンクのソルバーと自動生成器（Rust、std のみ）。構成は
[`yajilin-kit`](../yajilin-kit/README_JA.md) に倣い、生成の枠組みは
[NPGenerator 2007 リライト](../../vendor/npgenerator) の流儀（決定的な乱数、同一シード＝同一出力、
CLI と `verify.sh`）を引き継ぐ。

## 何をもとにしているか

| 参照元 | 使い方 |
|---|---|
| `PuzzleTools/sdvx/.../slither/SlitherSolver.java` (Java, 1117行) | 手筋（`numberSolve`/`nextSolve`/`oddSolve`/`connectWhiteSolve`/`finalSolve`）と生成方式（`SlitherGenerator`）の土台。手筋は**細分化して**移植する |
| `packages/solver-kit/src/solvers/slither.ts` (TS, 1142行) | 解の突合先 |
| `PuzzleTools/semiexp/cspuz_core/cspuz_rs_puzzles/src/puzzles/slitherlink.rs` | 制約モデルの確認用 |
| `PuzzleTools/pzprjs/src/variety-common/Encode.js` の `decode4Cell`/`encode4Cell` | puzz.link URL 仕様の正典 |
| `kits/yajilin-kit/rust/` | モジュール構成・CLI・難易度スコアの枠組み |

sdvx の手筋は「確定した盤面の検査」寄りで、人が使う定石（3-3、対角3、角の1 など）を持たない。
難易度をヒトの推論の量として測るには粒度が足りないので、**sdvx の手筋を個別の推論に割り、
そこへ標準定石を足す**方針を採る（両取り）。sdvx 由来の箇所は挙動を変えず、対応する Java の
メソッド名をコメントに残す。

## ソルバーが2つある理由

yajilin-kit と同じ二層構造にする。

| | 手筋ソルバー (`solver.rs`, `techniques/`) | 制約エンジン (`engine.rs`, `search.rs`) |
|---|---|---|
| モデル | 人間の解き方 | ルールが許すもの |
| 用途 | 難易度評価・解法の説明 | 生成・一意性の証明 |
| 完全性 | なし（手が尽きれば止まる） | あり（決定手続き） |

「解が一つだけ」のような**真であることが要求される**判定は、すべて制約エンジンが担う。

## 盤面と辺の表現

W 列 × H 行のセル。ヒントは `qnum ∈ {-1(空), 0, 1, 2, 3}`（puzz.link は 4 と `?`=-2 も表現できるので
デコードは受け付け、生成は 0..3 のみ）。

線は**格子点の間の辺**。線分の向きで呼び分ける。

- 横辺 `H(x, y)`: 頂点 (x,y)–(x+1,y) を結ぶ。`x ∈ [0, W)`, `y ∈ [0, H]` → `W*(H+1)` 本
- 縦辺 `V(x, y)`: 頂点 (x,y)–(x,y+1) を結ぶ。`x ∈ [0, W]`, `y ∈ [0, H)` → `(W+1)*H` 本

通し番号は横辺が先。`h_id(x,y) = y*W + x`、`v_id(x,y) = W*(H+1) + y*(W+1) + x`。

- セル (x,y) の4辺: 上 `H(x,y)` / 下 `H(x,y+1)` / 左 `V(x,y)` / 右 `V(x+1,y)`
- 頂点 (x,y) の4辺: 左 `H(x-1,y)` / 右 `H(x,y)` / 上 `V(x,y-1)` / 下 `V(x,y)`（盤外は存在しない）

辺の状態は `Edge { Unknown, Line, Cross }`。

> sdvx との対応: `yokoExtraWall[y][x]`（h行 × w+1列、セルの左右を塞ぐ壁）は本設計の `V(x,y)`、
> `tateExtraWall[y][x]`（h+1行 × w列）は `H(x,y)`。名前が入れ替わって見えるので移植時に注意。

## ルール

1. 数字セルの周囲4辺のうち、`Line` の本数がその数字に等しい
2. 各頂点の次数（接続する `Line` の本数）は 0 か 2
3. `Line` 全体がただ一つの閉路をなす（連結・分断なし）

## 制約エンジン（完全）

`engine.rs` に決定的な伝播、`search.rs` に探索を置く。

**伝播**（変化がなくなるまで繰り返す）

- `cell_saturation`: 数字セルで `line数 == 数字` なら残りを `Cross`、`cross数 == 4-数字` なら残りを `Line`。
  超過したら矛盾（sdvx `numberSolve`）
- `vertex_degree`: 頂点で `line数 == 2` なら残りを `Cross`、`line数 == 1 && cross数 == 2` なら残りを `Line`、
  `cross数 == 3` なら残りも `Cross`。`line数 > 2` または `line数 == 1 && cross数 == 3` は矛盾（sdvx `nextSolve`）
- `no_premature_loop`: `Line` の連結成分を union-find で持つ。両端が同じ成分に属する辺を `Line` にすると
  閉路が閉じるので、まだ未確定辺やヒント未充足が残っているなら `Cross` に確定
- `connectivity`: `Line` の成分が2つ以上あり、それらを繋ぎうる未確定辺が無ければ矛盾（sdvx `connectWhiteSolve`）

**探索**

`Line` の端点（次数1の頂点）があれば、そこから伸ばせる未確定辺を列挙して分岐する。端点が無ければ、
未確定辺のうち「隣接する確定辺・数字ヒントが最も多い」ものを選んで `Line`/`Cross` に二分岐。
それぞれの分岐で伝播 → 矛盾なら枝刈り。すべて確定したら単一閉路かを検証して解として数える。

`count_solutions(board, limit, max_nodes)` は解を `limit` 個まで集め、探索ノード数が `max_nodes` を
超えたら `aborted` を立てて打ち切る。一意性の判定は `!aborted && solutions.len() == 1`。

## 手筋ソルバー（難易度用）

`AnswerMethods` 相当の薄いラッパで辺を確定し、確定のたびに `Recorder` へ理由 (`Reason`) を記録する。
`Reason` ごとの重みの総和が難易度スコア (DP) の土台になる（yajilin-kit と同じ設計）。

### sdvx 由来（細分化して移植）

| 手筋 | 内容 | 出典 |
|---|---|---|
| `cell_exact` | 数字セルの `Line` 本数が数字に達した → 残り `Cross` | `numberSolve` |
| `cell_forced` | 残せる `Cross` が尽きた → 残り `Line` | `numberSolve` |
| `vertex_close` | 頂点の次数が 2 に達した → 残り `Cross` | `nextSolve` |
| `vertex_extend` | 次数1 で他2辺が `Cross` → 残り `Line` | `nextSolve` |
| `vertex_dead` | 3辺が `Cross` → 残りも `Cross` | `nextSolve` |
| `parity_line` | 行・列を横切る辺のパリティ（閉曲線は各直線を偶数回横切る）。sdvx は全確定時の検査のみだが、
未確定が1本だけならその1本を確定できる形に拡張する | `oddSolve` を拡張 |
| `connect_line` | 分断された `Line` 成分を繋ぐ唯一の経路を確定 | `connectWhiteSolve` |
| `no_small_loop` | 閉じると小ループになる辺を `Cross` | `finalSolve` |

### 標準定石（新規）

| 手筋 | 内容 |
|---|---|
| `zero_cell` | 0 の4辺すべて `Cross` |
| `three_pair` | 辺で隣り合う 3–3 → 両外側の2辺は常に `Line`。共有辺を使わず2セルを囲む長方形ループが盤面全体の完成解になる場合があるため、共有辺は無条件には確定しない。その小ループが完成解になれない場合だけ共有辺を `Line` にし、共有辺の両側へ伸びる辺を `Cross` にする |
| `three_diagonal` | 斜めに隣り合う 3–3 → 互いに遠い側の2辺ずつが `Line` |
| `three_zero_diagonal` | 斜めの 3–0 → 共有する隅は 0 側が塞がれているので線が通り抜けられない。3 側のその隅に接する2辺は「ともに `Line`」か「ともに `Cross`」だが、3 に許される `Cross` は1本だけなので**その隅に接する2辺が `Line`** |
| `three_zero_adjacent` | 辺で隣り合う 3–0 → 共有辺は 0 により `Cross`、よって 3 の残り3辺が `Line` |
| `corner_clue` | 角の 1 → 角の頂点に接する2辺は同時にしか使えず 1 には多すぎるので両方 `Cross` / 角の 3 → 同じ理由で両方 `Line` |
| `three_incoming` | 3 の隅に外から `Line` が入る → その隅に接するセルの2辺を両方 `Line` にすると頂点の次数が3になるので、3 の唯一の `Cross` はその隅側にある → **遠い2辺が `Line`** |
| `one_blocked_corner` | 1 の隅で外側の辺がすべて `Cross` → セル側の2辺は「ともに `Line`」か「ともに `Cross`」で、1 には2本は多すぎるので**両方 `Cross`** |
| `two_blocked_corner` | 2 の隅で外側の辺がすべて `Cross` → セル側の2辺は同時に使うか使わないかなので、**対角の隅を線が必ず通る**。対角側の2辺の一方が決まれば他方も決まる |
| `clue_corner_pair` | 上記の骨格の一般化。数字セルの各隅について「その隅を線が通るか」で場合分けし、1/2/3 共通に確定を取る |
| `inside_outside` | 内外の2彩色をパリティ付き union-find で管理し、判明済みの関係から辺を確定する（次節） |

各手筋は `fn(answer: &mut AnswerMethods) -> Status`（`Advanced` / `Stopped` / `Broken`）を返す
小さな純関数にし、`techniques/` に1ファイル1手筋で置く。

### 内外手筋（`inside_outside`）

各セルはループの**内側**か**外側**のいずれかであり、盤外は外側である。この2彩色は辺の状態と等価な情報を持つ。

- 隣接する2セル（盤外を含む）の間の辺が `Line` ⟺ 2セルの内外が**異なる**
- 同じ辺が `Cross` ⟺ 2セルの内外が**同じ**

そこで**パリティ付き union-find**（ノードは W×H 個のセル＋盤外を表す仮想セル1つ、重みは「同じ / 異なる」の2値）で
セル間の関係を管理する。辺が確定するたびに対応する関係を結合し、逆に**関係が既に判明している2セルの間の辺が
未確定なら、その辺を確定する**。この逆向きの推論が内外手筋の本体で、辺の局所的な伝播では届かない遠隔の
関係を使えるところに価値がある。同じ関係を2通りに要求されたら矛盾。

数字の制約も内外で書ける。セル c の四方の隣接セル（盤外含む）のうち「c と内外が異なる」ものの個数が
c の数字に等しい。関係が判明している隣接セルが増えるほど、残りの関係が確定する。

対角に隣り合うセルの関係も、共有する格子点の次数制約（0 か 2）から導ける場合がある。既に個別に実装した
斜めの定石（`three_diagonal`、`three_zero_diagonal` など）はこの枠組みから自然に導かれるはずなので、
両者が食い違わないことは手筋同士の整合性チェックとして使える。

探索（`search.rs`）でも同じパリティ union-find を伝播に加えると枝刈りが強くなる。巻き戻せる実装にすること。

### 仮置き（背理法）

手が尽きたら、未確定辺に `Line` / `Cross` を仮定して伝播し、矛盾した側の否定を確定する
（yajilin-kit の `try_solve` と同じ枠組み）。何手が仮置きを要したか (`trial_deductions`) と、
成功した最深の仮置きがどこまで伝播したか (`max_trial_count`) を記録する。

### 難易度

```
DP = Σ weight(reason) × count + 40 × trial_deductions + 25 × max_trial_count²
```

重みとバンド閾値は暫定値で置き、パズルスクエアの人手評価つきコーパスで較正する
（yajilin-kit は Spearman 0.79）。較正までは相対値としてのみ扱う。

### 較正

`calibrate` はコメント行を除く TSV を読み、入力順とは独立なワーカー割り当てで手筋ソルバーを走らせる。
結果は問題の入力位置へ戻してから集計するため、スレッドの完了順は相関や最適化へ影響しない。
要求スレッド数の既定値は `std::thread::available_parallelism()` とし、状態複製によるメモリ急増を
避けるため実働ワーカーは最大2、1500セルを超える問題は同時1問までとする。

各問題の特徴量は `Reason` ごとの確定辺数、`trial_deductions`、`max_trial_count²`。STOPPED は途中までの
DP に固定罰点と未確定辺数の重みを加え、BROKEN だけを実装不具合として除外する。人手評価と DP を
同順位の平均順位へ変換して Pearson 相関を取り、Spearman 相関とする。最適化は全非BROKEN問題を対象に
理由定義順の座標降下で、STOPPED の2係数を含む各非負整数パラメータの 0、1、現在値の分数倍・整数倍を
固定順に試す。相関が厳密に改善した候補だけを採用し、一巡で改善しなければ終了するので乱数を必要とせず
決定的になる。出力には完解問題だけとSTOPPED込みの相関を較正前後とも示し、クラス統計には完解率も示す。

大盤面で全辺を仮置きすると5分基準を満たせないため、較正時は各パスの辺 ID 順先頭28候補を既定上限とし、
そこで進まなければ STOPPED とする。上限は `--trial-limit` で変更でき、0は無制限。通常の `solve` は
従来どおり無制限であり、この上限の影響を受けない。

クラス統計の四分位数は線形補間で求める。隣接クラス境界は、投稿数が多いクラスへ寄らないよう両クラスの
誤分類率を等重みで最小化し、同点なら両中央値の中点に近い整数 DP を採る。intro/easy は difficulty 1 の
第1四分位数で分け、残る4境界を difficulty 1/2、2/3、3/4、4/5 に対応させる。

## ジェネレータ

### `generate-loop`（ループ先行）

1. **ランダムな単一閉路を1つ引く。** セルを「内側」「外側」に塗り分け、内側領域の境界を閉路とする。
   内側集合 S を空から成長させ、目標セル数に達するまでランダムに隣接セルを足していく。追加してよいのは
   次の3条件を保つ場合だけ:
   - S が連結（隣接セルを足すので自明）
   - S の補集合（盤外を含めて考える）が連結 — 崩れると閉路が2本になる
   - 追加セルの4隅のいずれにも「S のセルが対角の2つだけ」という配置が生じない — 生じると
     その格子点で線が4本集まり、単一閉路にならない

   この3条件を保つ限り、境界はちょうど1つの閉路になる。目標セル数は盤面の 35〜55% から引く

> sdvx の `SlitherGenerator` は「全辺をシャッフル順に走査し、伝播が矛盾しない側をランダムに採用する」
> 方式だが、これは小さな閉路が早い段階で閉じると残りの辺がすべて `Cross` に確定してしまい、盤面の
> 大半が空の解に落ちやすい（破綻時の全面やり直しも高くつく）。塗り分け方式なら閉路の大きさを
> 直接制御でき、やり直しも起きないので、こちらを採る。
2. 全セルに周囲の `Line` 本数を数字として書き込む（＝全マスヒントの、自明に一意な問題）
3. 盤面の線を消し、ヒントをシャッフル順に削除する。`--symmetry` 指定時は対称な組を削減単位にする。
   削除しても**一意なら削除を確定**、複数解になったら戻す。一意性の判定は制約エンジン
4. 手筋ソルバーで DP を測り、`--dp-min` / `--dp-max` の範囲外なら作り直す
5. `--refine N`: 近傍操作（削除済みヒントの復活と別ヒントの削除の交換）で DP を上げる山登りを N ラウンド

ヤジリンと違いスリザーリンクは**ヒントを消しても正解が変わらない**（ヒントは盤面の障害物ではない）ので、
yajilin-kit で必要だった「ヒントを置くたびに正解を引き直す」操作は不要になる。

### `generate-pattern`（ヒント配置先行）

ヒントを置ける位置を対称パターン（`none|rot2|rot4|mirror-h|mirror-v`）または `--pattern FILE` で
先に決め、そのセル以外の数字を落としてから 3〜5 を行う。sdvx の `HintPattern`（位置の集合のリストを
まとめて削る）に相当する削減単位を、対称の組ごとに作る。

## CLI

```
slither solve <problem> [--breakdown]   # 解答・難易度・盤面レンダリング
slither count <problem> [--limit N]     # 解の個数を数える（一意性の証明）
slither calibrate <corpus.tsv> [options] # 人手評価で難易度重みを較正
slither generate-loop [options]         # ループ先行方式で生成
slither generate-pattern [options]      # ヒント配置パターンから生成
slither bench [--count N] [--seed N]    # 生成・求解・計数の時間計測

<problem> はファイルパス、puzz.link URL、または "slither/W/H/body" 形式のコード。

  --seed N            乱数シード（既定 0）
  --size WxH          盤面サイズ（既定 10x10）
  --attempts N        リトライ上限、0 で無制限（既定 100）
  --dp-min N/--dp-max N  難易度の範囲。外れた問題は作り直す
  --max-nodes N       探索ノード上限、0 で無制限（既定 200000）
  --symmetry S        none|rot2|rot4|mirror-h|mirror-v
                      （generate-loop は既定 none、generate-pattern は既定 rot2）
  --pattern FILE      ヒント配置パターンを指定（パターンモード）
  --no-reduce         ヒント削減を行わない
  --exact-reduce      各削除を完全探索の一意性判定で決める（難問向け）
  --refine N          難易度を上げる山登りを N ラウンド行う（既定 0）
  --no-trial          仮置き（先読み）なしで解く
  --format F          url|code|text|grid（既定 grid）
  --out FILE          標準出力ではなくファイルへ書き出す
  --limit N           count の上限（既定 2）
  --count N           bench の反復回数（既定 10）
  --breakdown         solve で手筋別の回数・重み・小計を表示
  --threads N         calibrate の要求スレッド数（既定は利用可能な並列数）
  --rounds N          較正の座標降下ラウンド数（既定 20）
  --trial-limit N     較正の仮置き候補上限（既定 28、0 で無制限）
```

終了コード: `solve` は完解 0 / 手詰まり 2 / 矛盾・不正 1、`count` は一意 0 / それ以外 1、
`generate-*` は成功 0 / 打ち切り 2。

## puzz.link エンコード

`slither/W/H/<body>`。body は pzprjs の `decode4Cell` / `encode4Cell` と同一仕様。

デコード（1文字ずつ、`c` はセル位置）:

| 文字 | 意味 |
|---|---|
| `0`–`4` | `qnum = 値`、`c += 1` |
| `5`–`9` | `qnum = 値-5`、`c += 2`（1マス空きを挟む） |
| `a`–`e` | `qnum = 値-10`、`c += 3`（2マス空きを挟む） |
| `g`–`z` | `c += (base36値 - 16) + 1`（1〜20 マスの空き） |
| `.` | `qnum = -2`（`?`）、`c += 1` |

エンコードは逆手順。数字の**次のセル**が空なら `5+n`、**次の次**まで空なら `10+n` を使い、
空きが続く場合は `(count+15).toString(36)`（最大 20 マスずつ）で送る。
`slither_full` を表す末尾フラグ `/f` はデコード時に読み飛ばし、エンコードでは出力しない。

## モジュール構成

```
rust/
  Cargo.toml            # name = "slitherlink-kit", bin = "slither", std のみ
  verify.sh
  src/
    main.rs             # CLI
    lib.rs
    position.rs         # 座標
    board.rs            # 盤面・辺 ID
    random.rs           # 決定的 LCG（yajilin-kit と同一実装）
    puzzlink.rs         # URL / コードの相互変換
    format.rs           # テキスト入出力・盤面レンダリング
    engine.rs           # 制約エンジン（伝播）
    search.rs           # 探索・解数カウント
    unionfind.rs
    ordered.rs          # 決定的な順序つき集合
    status.rs           # Advanced / Stopped / Broken
    reasons.rs          # Reason と重み
    answer_model.rs     # 辺の状態
    answer_methods.rs   # 確定操作 + Recorder
    solver.rs           # 手筋ドライバ + 仮置き
    difficulty.rs       # DP とバンド
    solution.rs         # 解の抽出とルール検証
    generator.rs        # 生成
    techniques/         # 1ファイル1手筋
```

## 検証

- **ルール検証**: 生成・求解した解が3ルールをすべて満たすことを独立に検査する（`solution.rs`）
- **既存実装との突合**: 同じ問題を sdvx (Java) と solver-kit (TS) に解かせ、解と一意性判定を比較する
- **決定性**: 同一シードで同一出力になることを `verify.sh` で確認する
- **コーパス**: パズルスクエアから収集したスリザーリンクの問題を全件デコード・求解し、
  矛盾判定ゼロ・一意性の証明率を測る。人手評価との順位相関で手筋重みを較正する
