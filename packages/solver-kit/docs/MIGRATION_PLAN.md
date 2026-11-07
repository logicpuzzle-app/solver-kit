# SDVX → TypeScript 移植計画

## 概要

| 項目 | 数 |
|------|-----|
| SDVX Javaソルバー総数 | 177 |
| 移植済み | 177 |
| 未移植 | 0 |
| **移植率** | **100%** |

## 移植完了バッチ

全31パズルの移植が完了しました。

### Batch A (日本語系パズル) ✓ 完了
| パズル | 説明 | 状態 |
|--------|------|--------|
| nagare | 流れ - Flow puzzle | ✓ |
| nagenawa | 投げ縄 - Lasso puzzle | ✓ |
| yosenabe | 寄せ鍋 - Hot pot puzzle | ✓ |
| wafusuma | 和室 - Japanese room | ✓ |
| yajitatami | 矢印畳 - Arrow tatami | ✓ |

### Batch B (接続・リンク系) ✓ 完了
| パズル | 説明 | 状態 |
|--------|------|--------|
| shwolf | Sheep and Wolves | ✓ |
| whitelink | White Link | ✓ |
| walllogic | Wall Logic | ✓ |
| sukima | 隙間 - Gap puzzle | ✓ |
| sukororoom | Sukoro Room | ✓ |

### Batch C (ループ・ライン系) ✓ 完了
| パズル | 説明 | 状態 |
|--------|------|--------|
| maxi | Maxi Loop | ✓ |
| lither | Lither | ✓ |
| simplegako | Simple Gako | ✓ |
| nondango | Non-Dango | ✓ |
| nibunnogo | 二分の五 | ✓ |

### Batch D (特殊系) ✓ 完了
| パズル | 説明 | 状態 |
|--------|------|--------|
| tajmahal | Taj Mahal | ✓ |
| voxas | Voxas | ✓ |
| putteria | Putteria | ✓ |
| rassi | Rassi | ✓ |
| sbl | SBL | ✓ |

### Batch E (その他1) ✓ 完了
| パズル | 説明 | 状態 |
|--------|------|--------|
| familyphoto | Family Photo | ✓ |
| hurdle | Hurdle | ✓ |
| kazunori | Kazunori | ✓ |
| kissing | Kissing | ✓ |
| league | League | ✓ |

### Batch F (その他2) ✓ 完了
| パズル | 説明 | 状態 |
|--------|------|--------|
| linedozen | Line Dozen | ✓ |
| mukkonn | Mukkonn | ✓ |
| nurimulti | Nurimulti | ✓ |
| ovotovata | Ovotovata | ✓ |
| sashikazune | Sashikazune | ✓ |
| wittgen | Wittgen | ✓ |

## 実装ガイドライン

### 必須インターフェース
```typescript
// FieldState インターフェース
interface FieldState<T> {
  height: number;
  width: number;
  clone(): T;
  getStateDump(): string;
  isSolved(): boolean;
  solveAndCheck(): boolean;
}

// BaseSolver を継承
class XxxSolver extends BaseSolver<XxxField> {
  protected getBranchCandidates(state: XxxField): BranchCandidate<XxxField>[];
}
```

### ファイル構成
```
src/solvers/
├── xxx.ts          # パズルソルバー実装
└── index.ts        # export追加
```

### 実装手順
1. SDVXのJavaソルバーを読む
2. ルールを理解
3. TypeScript実装
4. index.tsにexport追加
5. `npm run build` でビルド確認

### 共通パターン

#### 塗り分け系 (Shading)
```typescript
import { CellState, Position, posKey, DIRECTIONS, adjacent } from '../core/types.js';
import { FieldState, Grid } from '../core/field.js';
```

#### 壁配置系 (Wall)
```typescript
import { WallState, Position, posKey } from '../core/types.js';
```

#### 数字配置系 (Number placement)
```typescript
private numbersCand: number[][][];  // 各セルの候補数字
```

#### 部屋系 (Room-based)
```typescript
interface Room {
  positions: Set<string>;
  // ...
}
private rooms: Room[];
```

## 進捗トラッキング

| バッチ | 状態 | 完了数 |
|--------|------|--------|
| Batch A | ✓ 完了 | 5/5 |
| Batch B | ✓ 完了 | 5/5 |
| Batch C | ✓ 完了 | 5/5 |
| Batch D | ✓ 完了 | 5/5 |
| Batch E | ✓ 完了 | 5/5 |
| Batch F | ✓ 完了 | 6/6 |

## 完了条件

1. ✓ 全パズルが `npm run build` でエラーなくビルド
2. ✓ index.ts にすべてexport済み
3. ✓ 基本的な制約伝播ロジック実装済み

---

*Last updated: 2025-11-29*
*移植完了: 177/177 パズル (100%)*
