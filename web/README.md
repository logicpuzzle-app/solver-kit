# solver-web — LogicPuzzle Solver

puzz.link の URL を貼ると、ブラウザ内(Rust → WebAssembly)で解くツール。数独・スリザーリンク・ヤジリン・ぬりかべ・美術館・ましゅは難易度も推定する。cspuz の141種は唯一性判定と解答に対応（上記6種を含む）。ナンバーリンクも解の有無・唯一性判定と解答図に対応。

- 本番: https://solver.logicpuzzle.app
  (App Hosting URL: https://solver--puzzle-square.asia-east1.hosted.app)
- 数独: `vendor/npgenerator`(NPGenerator V2.0.2 Rust リライト、GPL-3.0)
- ヤジリン: `kits/yajilin-kit`(難易度 v5)
- スリザーリンク: `kits/slitherlink-kit`
- ぬりかべ: `kits/nurikabe-kit`
- 美術館: `kits/akari-kit`
- ましゅ: `kits/masyu-kit`
- ナンバーリンク: cspuz_core fork の SAT cube-and-conquer / rowscan_dfs の Row-scan DFS(ともに MIT、難易度判定なし)
- 一般パズル: cspuz_core（MIT、プリビルド済み wasm を共有）
- 生成機能は初期スコープ外(エンジン側には存在する)

## 構成

```
wasm/         Rust クレート(npgen と kits/* を path 依存でラップ)
web/          静的フロントエンド(素の HTML/JS/CSS + web/pkg の wasm)
web/worker.js wasm 実行用 Web Worker(重い盤面でも UI が固まらない。
              実行中の再送信は worker を作り直して前の処理を打ち切る)
server.js     App Hosting 用の express 静的サーバー
scripts/parity.mjs  ネイティブ CLI と wasm の出力一致検証

**wasm を作り直したら parity を取ること。** 同じソースから作っていても、
ビルド直後の書き込み途中のバイナリを掴むとずれた結果が出る
(実際に一度、古いバイナリを見て「DP が食い違う」と誤診した)。
```

## 難易度判定

- 3 種とも yajilin-kit と同じ流儀の小数レーティング(例: ★4(4.28))を表示する。
  ★の切り替わる境界(バンド閾値)を x.5 に置いた線形補間で、四捨五入すると★に一致する。
- **数独**: npgen の DP(手筋のみ・仮置きなし)+ 手詰まりペナルティ
  `DP_eff = DP + 700 × 未確定マス数`。★バンド閾値 887 / 10,404 / 23,257 / 42,401。
  較正記録は `../tmp/npgen-puzsq-sudoku-fit.md`(puzsq 211 問、Spearman 0.79)。
  npgen の answer_kind は生成用の手筋ベース判定なので使わず、解の個数は
  wasm 側のバックトラックで厳密に数える(上限 500 万ノード)。
- **ヤジリン**: yajilin-kit の較正済みスコアと puzsq 1〜5 レーティング推定(難易度モデル v4 =
  カット偶奇手筋+サイズ補正の再当てはめ、puzsq 8,822 問、完全一致 57.4%)。詳細欄にモデル版を表示。
- **スリザーリンク**: slitherlink-kit の正規化スコア DPN とバンド(1,585 問、Spearman 0.74)。
  バンド→★対応: intro/easy=★1, medium=★2, hard=★3, expert=★4, fiendish=★5。
  手詰まり時のみ探索で唯一解判定(CLI と同じ 200,000 ノード上限)。

## ビルド

wasm は**ローカルでプリビルドしてコミットする**(App Hosting のビルド環境は Node のみ)。

```
cd wasm
wasm-pack build --release --target web --out-dir ../web/pkg
```

ローカル確認:

```
npm install && npm start   # http://localhost:8964
```

パリティ検証(数独はpuzsq較正コーパス全211問、ヤジリンはコーパスから40問サンプル):

```
node scripts/parity.mjs <sudoku-raw.json> <results.tsv> 40
```

## ナンバーリンク

Numberlink URL を入力すると、解くボタンの隣に設定アイコン(⚙)が出る。既定ではエンジンも
ワーカー数も**自動**で、設定パネルはアイコンを押したときだけ開く(`?engine=` / `?threads=` が
URL にあるときは開いた状態で表示)。
自動のエンジンは盤面サイズで選ぶ: 400 セル以下(20×20 まで)は Row-scan DFS、それより大きい
盤面は SAT cube-and-conquer(2026-11-07 の puzsq 20×20 以下のコーパス計測で DFS が全盤面で最速、
25×25 の g34/pp26 では SAT が速い)。自動のワーカー数は `min(navigator.hardwareConcurrency || 4, 8)`
を 1/2/4/8 に丸めた値。パネルのトグルは「自動 / 並列SAT / 行走査DFS」「自動 / 1 / 2 / 4 / 8」で、
パネルには自動が選ぶ組み合わせも表示する。`?engine=dfs&threads=4` で事前選択でき(`threads` は
必ず 1/2/4/8 に丸める)、`url` も指定できる。最後の選択は localStorage の `numlin-engine` /
`numlin-threads` に保存する("auto" も保存値になる)。

`web/numlin.js` がページ内の Scheduler を駆動し、module Web Worker で探索する。
SAT は選択したワーカー数で cube を探索する。既定では400セル以下(20×20まで)で
単体 SAT Worker を1個追加し、即時に競争させる(layout C)。それより大きい盤面は
cube のみ(layout A)。結果のワーカー数は追加分を含む実際の作成数を表示する。
DFS は8方向を比較して有望な方向の探索を継続する。選択したワーカー数は並列に
方向を開始する上限で、比較済みの状態を保持するため、全方向の比較では累計8個を作成する。
結果にはこの実際の作成数を表示する。メモ化は24ビット(1ワーカーあたり128 MiB)。
探索継続中は推定進捗率を表示する。DFS の推定値は探索木を二進分数で粗く評価したもので、
大きく外れることがあり、残り時間の推定ではない。
中断・問題の切り替え・ページ離脱で両エンジンの Worker を終了する。

解答図には最初の解を表示する。SAT は解数を上限2まで数え、DFS は全解を数えるため
表示を「2 以上」に抑える。**難易度判定は未対応**。
SAT は既定の shortcut 正規化・strong cube rules・wedge SAT rules に基づく判定であり、
正規化前の幾何学的に異なる全経路を数えるものではない。
既存の `web/pkg` のRustエンジンとは独立しており、SharedArrayBufferやCOOP/COEPは不要。

- SAT: **cspuz_core fork · SAT cube-and-conquer (MIT)**。2026-11-07 から cube の釣り合い検証は
  2 分割ではなく 32 子の分割推定と DFS 進捗率推定で行う(隠れた大きな cube を実行前に割る)。
  `web/numlin/LICENSE-cspuz_core.txt` に上流およびSATバックエンドのライセンスを同梱。
  `numlin_web/build.sh --sat-only` でプリビルドし、`numlin_web/www/` から
  `scheduler.js`、`worker.js`、`answer.js`、`cspuz_solver_backend.js`、
  `cspuz_solver_backend.wasm` をまとめて `web/numlin/` にコピーする。
- DFS: **rowscan_dfs · Row-scan DFS (MIT, wand125)**。
  公開リポジトリ https://github.com/wand125/rowscan_dfs をソースとし、
  `numlin_web/build.sh --dfs-only` でプリビルドする。`numlin_web/www/` から
  `dfs_solver.js`、`dfs_solver.wasm`、`dfs_worker.js`、`dfs_scheduler.js` を
  `web/numlin/` にコピーし、`cmp` で一致を確認する。
  `rowscan_dfs/LICENSE` を `web/numlin/LICENSE-rowscan_dfs.txt` に同梱する。

ビルドは `nice -n 15`、Cargo 4 jobs。コピーしたエンジンファイルを直接編集しない。
ライセンスも再確認し、ローカルサーバーでmodule Worker・解答図・中断を検証する。
SAT の既存の実装・検証記録は `NUMLIN-INTEGRATION.md` を参照。

`npm start` の起動後、Node 22以降とChromeがあれば `node scripts/numlin-check.mjs` で
専用headlessブラウザの統合検証を実行できる。`BASE` で接続先、`CHROME` で実行ファイルを
指定する。`SKIP_LARGE=1` は20×20の完走のみ省略し、中断・切り替えは検証する。

## デプロイ(Firebase App Hosting)

プロジェクト `puzzle-square`、バックエンド `solver`(asia-east1、ローカルソースデプロイ)。

```
firebase deploy --only apphosting --project puzzle-square
```

カスタムドメイン `solver.logicpuzzle.app` は Firebase コンソール
(App Hosting → solver → ドメインを追加)+ Cloud DNS(logicpuzzle.app ゾーン)にレコード追加。

## 外部サイトから使う（SDK v1）

Puzsq などの別オリジンから、ビルドなしで ES module を読み込める。解析は呼び出し元の
ブラウザ内で実行し、Worker・wasm は solver の配信元から取得する。

```js
const sdk = await import(/* webpackIgnore: true */
  "https://solver.logicpuzzle.app/sdk/v1/index.js");

if (sdk.supportedKind(url)) {
  const controller = new AbortController();
  const result = await sdk.solve(url, {
    signal: controller.signal,
    onProgress: progress => console.log(progress),
    engine: "auto",
    threads: "auto",
  });
  console.log(result);
  const svg = sdk.renderAnswer(result, { labels: { answer: "解答", problem: "問題" } });
  container.replaceChildren(...(svg ? [svg] : []));
  // controller.abort() で中止できる。
}
```

- `VERSION`: SDK のバージョン文字列（現在 `"1.3.0"`）。
- `supportedKind(url)`: `sudoku` / `slitherlink` / `yajilin` / `nurikabe` / `akari` /
  `masyu` / `numlin`、または生成一覧の `key`、未対応なら `null`。
  `key` は元ソースのモジュール名（例: `star_battle`、URL は `starbattle`）。
  種別の検出だけを行い、盤面のパース・解析は行わない。
  puzz.link URL と `p?kind/...`・クエリ部分を受け付ける。
  スリザーリンクの URL は `slither`、ましゅは `mashu` / `masyu` / `pearl` に対応する。
- `solve(url, { signal, onProgress, engine = "auto", threads = "auto" } = {})`:
  `Promise<SolveResult>`。`engine` は `auto` / `sat` / `dfs`、`threads` は `auto` または
  1〜64 の整数（DFS は同時実行最大8）。両オプションはナンバーリンクだけに適用する。
  自動選択は上記「ナンバーリンク」節と同じ。`onProgress` もナンバーリンクのみで、
  `{status, engine, done, total, percent, threads, wall_ms}`、DFS はさらに `stage, direction` を受け取る。
  `percent` は推定不能な間 `null`。コールバックの例外は解析に影響しない。
- `renderAnswer(result, { doc = document, labels = {} } = {})`: `SVGSVGElement | null`。
  `solve()` の結果から解答盤面を生成する。解が表示できない場合は本体ページと同じ問題盤面・
  途中盤面を返す。`status !== "ok"`・`raw` がない・描画できない場合は `null`。
  `labels.answer` / `labels.problem` は `aria-label`（既定値は `"Answer"` / `"Problem"`）。
  `doc` には生成先の Document を指定できる。SVG は白背景と描画属性を持ち、solver の CSS や
  i18n の読み込みは不要。`viewBox` と既存の上限幅を持つため、呼び出し側の CSS で
  `svg { max-width: 100%; height: auto; }` を指定して縮小できる。

```ts
type SolveResult = {
  kind: string | null; // 既存7種の名前、または CSPUZ_KINDS の key
  status: "ok" | "unsupported" | "invalid" | "aborted" | "error";
  solutions: "0" | "1" | "2+" | "?" | null;
  rating: number | null;
  stars: 1 | 2 | 3 | 4 | 5 | null;
  difficultyVersion: number | null;
  elapsedMs: number;
  engine: "kit" | "numlin" | "cspuz" | "cspuz-fallback";
  answerKind: "full" | "example" | "common" | null;
  displayName: { ja: string; en: string } | null;
  error?: string;
  errorKey?: string;
  raw: object;
};
```

`ok` は解析が正常に終了したことを表し、唯一解や解の存在を保証しない。解数は `solutions` を
見る。`?` は解数探索の上限到達または判定不能、`null` は解析結果がない場合。`rating` は
`raw.rating_hundredths / 100`、`stars` はその四捨五入を1〜5へ制限した値。
唯一解が確認できない場合（0解・複数解・探索打ち切り）とナンバーリンクでは両方 `null`。
`difficultyVersion` はパズルごとの難易度モデル版（ナンバーリンクや結果なしは `null`）。
`elapsedMs` は呼び出しから終了までの経過時間（Worker の初期ロードを含む）。
`raw` はエンジンの詳細結果で、種別ごとに形式が異なる。
種別を検出できなかった入力では `kind` は `null`。

非対応種別は `unsupported`、パース失敗・不正なオプションは `invalid`、signal の中止は
`aborted`、Worker・wasm のロード失敗などは `error` で返し、通常は Promise を reject しない。
同じ SDK モジュールで再び `solve` を呼ぶと前の呼び出しは `aborted` になる。
一般パズルは中止時に Worker を終了し、次の解析で作り直す。ナンバーリンクも全 Worker を解放する。

### SDK 1.2.0 の cspuz 対応

既存7種を維持し、一般パズルを追加した。現在の生成一覧は141種（うち列挙対応4種）、
既存6種との重複を除く追加は135種。ナンバーリンクを含む対応種別は計142種。
日英名の一覧は本体の「対応パズル」と `web/sdk/cspuz-kinds.js` を参照する。

- `engine`: 既存6種は `kit`、ナンバーリンクは `numlin`、一般パズルは `cspuz`。
  既存6種の独自探索が `solutions: "?"` になった場合だけ cspuz で再判定し、
  `solutions` を置き換えて `cspuz-fallback` を返す。この場合も難易度は `null`。
### SDK 1.3.0 の cspuz 再判定

既存6種で独自ソルバーが解ききれないとき、cspuz で解き直す。判定は `fallbackReason`（`sdk/solver.js`）。

| 独自ソルバーの結果 | 処理 | 返す結果 |
|---|---|---|
| `invalid` / `error`（読めない・動かない） | cspuz で解く | cspuz が `ok` なら `engine: "cspuz-fallback"` の cspuz 結果。失敗なら独自ソルバーの結果のまま |
| `solutions: "?"`（唯一性探索が上限） | cspuz で再判定 | 1.2.0 と同じ（`cspuz-fallback`、難易度 `null`） |
| 唯一解だが手筋で盤面が埋まらない（`unknown` / `unsolved` / `STOPPED`。数独は仮置きで埋まるので対象外） | cspuz で解答盤面を得る | `engine: "kit"` と推定難易度はそのまま。`raw.fallback = { engine: "cspuz", board }`、`answerKind: "full"`、`renderAnswer` は cspuz の盤面を描く |

cspuz を呼ぶときは、cspuz が知らない種類名（`pearl` など）を cspuz の key に置き換える。

- `answerKind`: 描画される盤面が完全解なら `full`、複数の解から1つを表示すれば `example`、
  共通確定マス・途中盤面だけなら `common`、解なし・結果なしなら `null`。
- `displayName`: 種別の日英名。名前を持たない結果では `null`。
- cspuz の解数は `isUnique: true` → `"1"`、`false` → `"2+"`、
  `hasAnswer: false` → `"0"`、その他 → `"?"`。`rating` / `stars` / `difficultyVersion` は `null`。
- cspuz の `raw` は `{ engine: "cspuz", board, example? }`。
  `board` は共通確定マスの Board、列挙できれば `example` に解の一例を格納する。
  列挙の `example` は差分だけなので、`renderAnswer` はその上に `board` の共通マス・手掛かりを重ねる。
  `example` がなければ `board` だけを描画する。
  fallback の `raw` には独自エンジンの詳細も保持する。

一覧はリポジトリルートから再生成する。**wasm 更新時は必ず実行すること。**
Rust・wasm のビルドや依存の追加は不要。

```sh
node web/scripts/gen-cspuz-kinds.mjs
# ソースの配置が異なる場合
node web/scripts/gen-cspuz-kinds.mjs /path/to/cspuz_core/cspuz_solver_backend/src/puzzle/mod.rs
```

`puzzle_list!(puzz_link, ...)` から種類・別名・日英名・列挙フラグを読み取り、配信する
`web/numlin/cspuz_solver_backend.wasm` を Node で呼び出して検証する。kudamono・penpa-edit は対象外。
バックエンドは種別の dispatch 後に URL をデコードするため、数値でない盤面寸法を渡し、
既知種の `invalid url` と未知種の `unknown puzzle type` を区別する。
solve/enumerate の両方に既知・未知の対照を置き、曖昧な応答は生成エラーにする。
列挙フラグもソースだけを信用せず実 wasm の dispatch で判定する。
生成物の先頭に生成日時と wasm の SHA-256 を記録する。

### クレジット

一般パズルのソルバーは [cspuz_core](https://github.com/semiexp/cspuz_core)（MIT）。
配信 wasm に含まれる依存ライセンスは `web/numlin/LICENSE-cspuz_core.txt` を参照。
`web/cspuz-board.js` は
[puzzle-webapp の puzzle-board](https://github.com/semiexp/puzzle-webapp/tree/main/packages/puzzle-board)
の `renderBoardItems` / item 描画を DOM API に移植した。
**MIT License, Copyright (c) 2025 semiexp**。
旧移植の [cspuz-solver2 の puzzle-board](https://github.com/semiexp/cspuz-solver2/tree/main/packages/puzzle-board)
由来の部分（MIT, Copyright (c) 2022 semiexp）も含む。両方のクレジットと許諾文の全文は移植ファイル先頭に保持する。
全 item と `grid` / `outer_grid` / `dots` / `empty` を扱い、React・外部 CSS は不要。

CORS は次を完全一致で許可する:

- `https://puzsq.logicpuzzle.app`
- `https://puzsq-v3.logicpuzzle.app`
- `https://puzsq-dev-lhbvc.logicpuzzle.app`
- `https://puzsq-v3-dev-q32zfgk.logicpuzzle.app`
- `http://localhost:任意ポート` / `http://127.0.0.1:任意ポート`

追加する場合は solver サーバーの環境変数に
`SOLVER_CORS_ORIGINS=https://preview.example.com,https://another.example.com` を設定する。
GET / HEAD を許可し、OPTIONS は204を返す。資格情報付きリクエストは不要。
呼び出し側で CSP を設定している場合は `worker-src` に `blob:`、スクリプト・wasm の取得先に
solver オリジンを許可する必要がある（wasm 実行に必要な CSP も含む）。
Blob の module Worker は絶対 URL の `import` で起動する。
Worker のモジュール読み込みは非同期なので、Blob URL は生成直後に破棄せず、最初の応答・
エラー・terminate の時点で revoke する。別オリジン起動とこの解放経路は `sdk-check.mjs` で確認する。

SDK v1 の公開 API と正規化フィールドは後方互換を壊さない方針。破壊的変更は `/sdk/v2/` に追加する。
`raw` はエンジン固有の診断・描画用であり、安定した連携には正規化フィールドを使う。

ライセンス: **solver_wasm は GPL-3.0-or-later**（数独側の依存を含む）。
**numlin・cspuz は MIT**（同梱の各 LICENSE と SAT バックエンドのライセンスも参照）。
SDK 経由の利用でも依存エンジンのライセンス条件を確認すること。

ローカルで別オリジンの手動確認:

```sh
# リポジトリルートから、それぞれ別ターミナルで実行
node web/server.js                # http://localhost:8964/
node web/scripts/sdk-host.mjs     # http://localhost:8965/
```

ホストページで URL を入力して解答盤面・解析結果の JSON・中止を確認できる。
`?sdk=http%3A%2F%2Flocalhost%3A8964%2Fsdk%2Fv1%2Findex.js` で読み込み先を変更できる。
自動検証は `node web/scripts/sdk-check.mjs`（Node 22以降）。両サーバーと専用 headless Chrome を
起動・終了し、既存7種の例題の SVG・CSS 非依存の描画・CORS・中止と再解析・本体画面の
SVG 構造（変更前の要素数・viewBox・width）を確認する。
SDK 1.2.0 では別オリジンでの cspuz 12種、複数解（例示/共通マス）、解なし、全 item と
全 defaultStyle、Worker の中止・上書き・読込失敗と復帰、独自探索上限から実 cspuz への
fallback、日英表示と対応一覧も検証する。テスト URL は `scripts/fixtures/cspuz-puzzles.json`
に収録し、出典は cspuz_core のテスト。
8964 / 8965 が使用中なら空きポートを使い、既存サーバーには触れない。
`SOLVER_PORT` / `SDK_HOST_PORT` で希望ポート、`CHROME` で Chrome 実行ファイルを指定できる。
成功は exit 0、失敗は exit 1、Chrome がない・起動できない場合は理由を表示して exit 2。

### 今回の実装・検証記録

[solver-kit#17](https://github.com/logicpuzzle-app/solver-kit/issues/17) 対応。
`feat/cspuz-general`（main から作成）、変更は `web/` のみ、コミットなし。
2026-11-07: `node web/scripts/sdk-check.mjs` は PASS（Node v24.22.1、Chrome 157）。
既存 wasm を使用し、Rust・wasm は再ビルドしていない。描画で省略した item はない。
