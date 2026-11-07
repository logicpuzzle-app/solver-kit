# SDVX → solver-kit 移植ステータス（最新確認）

## サマリ
- SDVX 側 177 ソルバー名に対して、solver-kit 側の実装名ベースでは未移植 0 件（テストファイル除外で比較）。
- solver-kit にのみ存在する実装/ファイル: `index`, `pentomino`, `skyscrapers`（拡張/補助実装）。
- ただし移植品質・手筋パリティは未検証のものが多く、ゴールデンテストが不足している。

## 差分比較のルール
- 比較対象:
  - SDVX: `sdvx/src/main/java/myamya/other/solver/<puzzle>` ディレクトリ名。
  - solver-kit: `solver-kit/src/solvers/*.ts`（`.test` は除外）。
- 結果:
  - `missing`: 0
  - `extra`: `index`, `pentomino`, `skyscrapers`

## 留意点
- 名称一致のみの粗い判定。ロジックの完全一致や手筋カバレッジは未確認。
- solver-kit 側は ES module + TypeScript。SDVX Java 実装の手筋が簡略化されている可能性がある。
- `src/__tests__` にあるテストは一部パズルのみ。大半のソルバーに対する動作確認は未整備。

## 推奨アクション
1) 代表パズルごとのゴールデンテストを追加し、SDVX版と挙動一致を検証（例: nurikabe, slither, sudoku, yajilinなど）。
2) 手筋抽象化/プラグイン化を進めつつ、未テストのソルバーに最小限の回帰テストを付与。
3) `extra` 実装（pentomino, skyscrapers）の位置づけを整理（拡張実装としてドキュメント化）。
