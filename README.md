# solver-kit

パズルのソルバーと難易度判定。

| ディレクトリ | 中身 |
|---|---|
| [`packages/solver-kit/`](packages/solver-kit/) | 制約伝播＋バックトラックの抽象ソルバー(TypeScript、npm パッケージ `@logicpuzzle-app/solver-kit`) |
| [`kits/`](kits/) | パズル種ごとの**手筋ソルバー + 難易度判定**(Rust / TypeScript / Python) |
| [`web/`](web/) | [solver.logicpuzzle.app](https://solver.logicpuzzle.app) — puzz.link の URL を解いて難易度を推定するブラウザツール |
| [`vendor/npgenerator/`](https://github.com/logicpuzzle-app/npgenerator) | submodule。数独エンジン(GPL-3.0) |
| [`REJECTED_JA.md`](REJECTED_JA.md) | **試して効かなかった案の記録** |

```sh
git clone --recursive git@github.com:logicpuzzle-app/solver-kit.git
```

submodule を忘れたら `git submodule update --init`。

## ソルバーが2種類ある理由

**`packages/solver-kit` は「解けるか」を、`kits/` は「どの手筋で解けるか」を担当する。**
目的が違うので実装も分けてある。

| | 手筋ソルバー(`kits/`) | 制約エンジン(`packages/solver-kit`) |
|---|---|---|
| 用途 | 難易度の評価・解法の説明 | 一意性の証明・生成 |
| 出力 | どの手筋が何回発火したか | 解が何通りあるか |

状態は共有しない。解の検証も独立に実装してあり、片方のバグがもう片方に伝染しない。

## kits の現状

puzsq(パズルスクエア)の人手評価つきコーパスで較正している。

| | 言語 | 較正 | 完解率 | 人手評価との完全一致 | モデル |
|---|---|---:|---:|---:|---|
| [ヤジリン](kits/yajilin-kit/README_JA.md) | Rust / TS / Python | 8,822 問 | — | **59.9%** | v5 |
| [スリザーリンク](kits/slitherlink-kit/README_JA.md) | Rust | 1,585 問 | — | — | v1 |
| [ぬりかべ](kits/nurikabe-kit/README_JA.md) | Rust | 1,234 問 | **86.1%** | 58.0% | v1 |
| [美術館](kits/akari-kit/README_JA.md) | Rust | 2,591 問 | **99.8%** | **62.8%** | v1 |
| [へやわけ](kits/heyawake-kit/README_JA.md) | Rust | 6,890 問 | 80.6% | **60.4%** | v1 |

ヤジリンは3ポートが**同じ入力に対してバイト単位で同じ出力**を返す。整数演算だけで
書いてあり、ゴールデン(`kits/yajilin-kit/typescript/testdata/expected/`)が正典。

## 難易度の考え方

**主軸は「その問題を解くのに要った読みの段階」。**手間の合計(手筋の発火数や
仮置きの回数)は、同じ段階の中で順序をつけるためだけに使う。

人間は「基本手筋だけ」「数え上げまで要る」「仮置きが要る」という言い方で難しさを表す。
手筋ソルバーは安い段階から始めて止まったら 1 段ずつ上げるので、**到達した最大の段階が
そのまま「その問題を解くのに最低限必要な手筋の集合」**になる。

較正して確かめてある。ヤジリンの 5-fold CV 一致率:

| モデル | 一致率 |
|---|---:|
| 手間だけ | 57.4% |
| 段階を主軸に | 58.7% |
| ＋「手筋だけでどこまで進めたか」 | **59.7%** |

手筋の発火数そのものは難易度をほとんど説明しない。10×10 の完解問題で申告★1/★2/★3 の
発火数の中央値を並べると、どの手筋も ±10% 以内で重なる — **発火数は難易度ではなく
盤面の広さで決まっている。**

## 開発のきまり

- **規則の採否は好みでなく計測で決める。** 効かなかったものは残さず、理由と数字を
  [REJECTED_JA.md](REJECTED_JA.md) に書く。やることの追跡は
  [Issues](https://github.com/logicpuzzle-app/solver-kit/issues)
- **指標は4つ見る。** 完解率は階段関数なので手筋1つの効果が見えにくい。
  確定率・仮置きなし完解率・段階の分布を併せて見る
- **3言語ポートはバイト単位で一致させる。** 整数演算のみ。ゴールデンは
  `make-golden.sh` で再生成し、各言語の `verify.sh` を通す
- **手筋を足したら `trace` で1問追う。** 盤面を書き換えながら判定して古い連結情報を
  使うバグを、これで見つけた

## テスト

```sh
cargo test --release --manifest-path kits/nurikabe-kit/rust/Cargo.toml   # 各 kit
cd kits/yajilin-kit/typescript && sh verify.sh                            # 3ポートの一致
cd packages/solver-kit && npm run test:run                                # TS ライブラリ
```

CI([`.github/workflows/ci.yml`](.github/workflows/ci.yml))が同じものを回す。

## 移植元について

各キットの設計書に出てくる `PuzzleTools/sdvx`、`PuzzleTools/gridkit`、
`PuzzleTools/semiexp`、`PuzzleTools/pzprjs` は**このリポジトリの外にある参照実装**。
手筋の移植元や puzz.link URL 仕様の正典として参照しているだけで、ビルドには要らない。

## ライセンス

MIT（[`LICENSE`](LICENSE)）。ただし `vendor/npgenerator` は GPL-3.0-or-later（元の NPGenerator 2007 由来）で、
それを含む `solver_wasm`（`web/wasm`）は GPL-3.0-or-later で配布する。
移植元・同梱物のクレジット（cspuz_core、Glucose / MiniSat、rowscan_dfs、cspuz-solver2、myamya 氏の sdvx）は
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) を参照。

## 公開リポジトリについて

難易度の較正に使った投稿問題のコーパス（`kits/*/testdata/corpus.tsv` など）は、問題の権利が各作者にあるため含めていない。
`fetch_corpus.py` などの取得・較正スクリプトはそのまま置いてあるが、コーパスが無いと動かない。
