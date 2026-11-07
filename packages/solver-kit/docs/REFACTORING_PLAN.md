# solver-kit リファクタリング計画

## 概要

181のパズルソルバーを分析した結果、以下の問題点を特定しました。
優先度順にリファクタリングタスクを整理します。

---

## Phase 1: 高優先度（型安全性・バグ防止）

### 1.1 Grid の境界チェック強化
**問題**: `Grid.get()` / `Grid.set()` に境界チェックがなく、無効な座標アクセスがサイレントに失敗する

**対象**: `src/core/field.ts`

**変更内容**:
```typescript
// Before
get(row: number, col: number): T {
  return this.data[row][col];
}

// After
get(row: number, col: number): T {
  if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
    throw new RangeError(`Grid access out of bounds: (${row}, ${col}) in ${this.height}x${this.width} grid`);
  }
  return this.data[row][col];
}

// 安全なバリアント
getSafe(row: number, col: number): T | undefined {
  if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
    return undefined;
  }
  return this.data[row][col];
}
```

**工数**: 0.5日

---

### 1.2 非nullアサーション (!) の除去
**問題**: 20以上のソルバーで `!` 演算子を使用し、ランタイムエラーのリスクがある

**対象ファイル例**:
- `ovotovata.ts`
- `wittgen.ts`
- `putteria.ts`
- `nondango.ts`
- `walllogic.ts`
- `nurimulti.ts`

**変更内容**:
```typescript
// Before
const value = this.cells.get(row, col)!;

// After
const value = this.cells.get(row, col);
if (value === undefined) {
  throw new Error(`Unexpected undefined at (${row}, ${col})`);
}
```

**工数**: 1日

---

### 1.3 FieldState インターフェースの拡張
**問題**: `solveAndCheck()` が boolean を返すだけで、エラーの種類を区別できない

**対象**: `src/core/field.ts`

**変更内容**:
```typescript
// 新しい結果型
export enum PropagationResult {
  CHANGED = 'changed',
  NO_CHANGE = 'no_change',
  CONTRADICTION = 'contradiction',
  ERROR = 'error',
}

// FieldState インターフェース拡張（後方互換性維持）
export interface FieldState<T> {
  readonly height: number;
  readonly width: number;
  clone(): T;
  getStateDump(): string;
  isSolved(): boolean;
  solveAndCheck(): boolean;

  // 新規メソッド（オプショナル、将来的に必須化）
  propagate?(): PropagationResult;
}
```

**工数**: 0.5日

---

### 1.4 エクスポート整理
**問題**: `index.ts` で `export *` を使用し、名前衝突のリスクがある（例: `Compass`, `ArrowDirection`）

**対象**: `src/solvers/index.ts`

**変更内容**:
```typescript
// Before
export * from './compass.js';
export * from './mukkonn.js'; // Compassをエクスポート → 衝突

// After - 明示的エクスポート
export { CompassField, CompassSolver } from './compass.js';
export { MukokonnField, MukokonnSolver, MukokonnCompass } from './mukkonn.js';
```

または、ソルバーレジストリ方式:
```typescript
export const solvers = {
  compass: { Field: CompassField, Solver: CompassSolver },
  mukkonn: { Field: MukokonnField, Solver: MukokonnSolver },
  // ...
} as const;
```

**工数**: 1日

---

## Phase 2: 中優先度（コード重複削減）

### 2.1 接続チェックユーティリティの共通化
**問題**: 10以上のソルバーで BFS による接続領域チェックを再実装

**対象ソルバー**:
- `wafusuma.ts`
- `las.ts`
- `invlitso.ts`
- `cells.ts`
- `canal.ts`
- `nurikabe.ts`
- `hitori.ts`
- など

**変更内容**: `src/constraints/graph.ts` に統一実装を追加
```typescript
export function getConnectedRegion<T>(
  grid: Grid<T>,
  start: Position,
  predicate: (value: T, pos: Position) => boolean,
  diagonal?: boolean
): Position[] {
  const visited = new Set<string>();
  const region: Position[] = [];
  const queue: Position[] = [start];

  while (queue.length > 0) {
    const pos = queue.shift()!;
    const key = posKey(pos);
    if (visited.has(key)) continue;

    const value = grid.getSafe(pos.row, pos.col);
    if (value === undefined || !predicate(value, pos)) continue;

    visited.add(key);
    region.push(pos);

    const dirs = diagonal ? DIRECTIONS_8 : DIRECTIONS;
    for (const dir of dirs) {
      queue.push(adjacent(pos, dir));
    }
  }

  return region;
}

export function isConnected<T>(
  grid: Grid<T>,
  predicate: (value: T) => boolean
): boolean {
  // 最初の該当セルから全該当セルに到達できるか
}

export function countRegions<T>(
  grid: Grid<T>,
  predicate: (value: T) => boolean
): number {
  // 接続領域の数を数える
}
```

**工数**: 1日

---

### 2.2 PositionSet / PositionMap クラスの追加
**問題**: 20以上のソルバーで `Map<string, T>` と `posKey()` を手動で組み合わせている

**変更内容**: `src/core/types.ts` に追加
```typescript
export class PositionSet implements Set<Position> {
  private inner = new Set<string>();

  add(pos: Position): this {
    this.inner.add(posKey(pos));
    return this;
  }

  has(pos: Position): boolean {
    return this.inner.has(posKey(pos));
  }

  delete(pos: Position): boolean {
    return this.inner.delete(posKey(pos));
  }

  *[Symbol.iterator](): Iterator<Position> {
    for (const key of this.inner) {
      yield parsePos(key);
    }
  }

  get size(): number {
    return this.inner.size;
  }
}

export class PositionMap<T> implements Map<Position, T> {
  private inner = new Map<string, T>();

  set(pos: Position, value: T): this {
    this.inner.set(posKey(pos), value);
    return this;
  }

  get(pos: Position): T | undefined {
    return this.inner.get(posKey(pos));
  }

  // ... 他のMapメソッド
}
```

**工数**: 0.5日

---

### 2.3 clone() ボイラープレートの削減
**問題**: 179のソルバーで同様の clone() 実装を繰り返している

**変更内容**: `BaseFieldState` 抽象クラスの導入
```typescript
export abstract class BaseFieldState<T extends BaseFieldState<T>>
  implements FieldState<T> {

  abstract readonly height: number;
  abstract readonly width: number;

  // サブクラスで実装必須のファクトリメソッド
  protected abstract createEmpty(): T;

  // グリッドプロパティを列挙
  protected abstract getGrids(): Grid<unknown>[];

  clone(): T {
    const cloned = this.createEmpty();
    const srcGrids = this.getGrids();
    const dstGrids = cloned.getGrids();

    for (let i = 0; i < srcGrids.length; i++) {
      srcGrids[i].copyTo(dstGrids[i]);
    }

    return cloned;
  }

  // ...
}
```

**工数**: 2日（BaseFieldState作成 + 主要ソルバー移行）

---

### 2.4 壁/エッジ状態の統一
**問題**: ソルバーごとに異なる壁表現を使用

| パターン | 使用ソルバー数 |
|---------|--------------|
| `WallState` enum (core) | 27 |
| カスタム `Wall` enum | 5 |
| `boolean[][]` | 8 |
| `EdgeState` enum | 15 |

**変更内容**:
1. すべて `WallState` (UNKNOWN, WALL, NO_WALL) に統一
2. ローカル定義の Wall enum を削除

**工数**: 2日

---

### 2.5 制約ライブラリの活用促進
**問題**: `src/constraints/` に14のユーティリティ関数があるが、1つのソルバーしか使用していない

**未使用関数**:
- `allUnique()`
- `isWhiteConnected()`
- `hasBlackPool()`
- `countRegions()`
- `countEdgesAtVertex()`
- `getVisibleCells()`
- `getConnectedRegion()`
- `normalizeShape()`
- `shapesEqual()`

**対象ソルバー（リファクタリング優先度高）**:
- `nurikabe.ts` → `isWhiteConnected()`, `hasBlackPool()` 使用可
- `hitori.ts` → `isWhiteConnected()` 使用可
- `akari.ts` → すでに `getVisibleCells()` 使用中（模範）

**工数**: 1日

---

## Phase 3: 低優先度（命名規則・ドキュメント）

### 3.1 命名規則の統一
**問題**: 日本語と英語の混在

| 日本語 | 英語（推奨） | 使用数 |
|--------|------------|-------|
| `yokoWall` | `horizontalWall` | 27 |
| `tateWall` | `verticalWall` | 27 |
| `masu` | `cells` | 12 |

**方針**: 新規実装は英語、既存コードは段階的に移行

**工数**: 長期的（新規実装時に適用）

---

### 3.2 JSDoc の追加
**対象**: `src/core/` の全インターフェース・クラス

```typescript
/**
 * パズルの盤面状態を表すインターフェース
 *
 * @typeParam T - 具象クラスの型（self-referential型）
 *
 * @example
 * ```typescript
 * class MyField implements FieldState<MyField> {
 *   clone(): MyField { ... }
 * }
 * ```
 */
export interface FieldState<T> {
  /**
   * 盤面の高さ（行数）
   */
  readonly height: number;

  /**
   * 盤面の幅（列数）
   */
  readonly width: number;

  /**
   * 現在の状態のディープコピーを作成
   * @returns 新しいインスタンス
   */
  clone(): T;

  /**
   * 状態の変化検出用ダンプを取得
   * @returns 状態を表す文字列（同じ状態なら同じ文字列）
   */
  getStateDump(): string;

  /**
   * パズルが解けたかどうかを判定
   * @returns すべてのセルが確定し、制約を満たしていればtrue
   */
  isSolved(): boolean;

  /**
   * 制約伝播を1ラウンド実行
   * @returns 矛盾が発生した場合false、それ以外true
   */
  solveAndCheck(): boolean;
}
```

**工数**: 1日

---

### 3.3 テストカバレッジの向上
**現状**: 181ソルバー中、2ファイルのみテスト存在

**目標**:
- Phase 1: コアモジュール（Grid, BaseSolver）のテスト追加
- Phase 2: 主要ソルバー10種のスナップショットテスト
- Phase 3: 全ソルバーのスモークテスト自動生成

**工数**: 3日（Phase 1のみ）

---

## 実装スケジュール

### Week 1: 高優先度
| 日 | タスク | 工数 |
|----|--------|-----|
| Day 1 | 1.1 Grid境界チェック + 1.3 PropagationResult | 1日 |
| Day 2 | 1.2 非nullアサーション除去 | 1日 |
| Day 3 | 1.4 エクスポート整理 | 1日 |
| Day 4 | 2.1 接続チェックユーティリティ | 1日 |
| Day 5 | 2.2 PositionSet/PositionMap | 0.5日 |

### Week 2: 中優先度
| 日 | タスク | 工数 |
|----|--------|-----|
| Day 1-2 | 2.3 BaseFieldState + 主要ソルバー移行 | 2日 |
| Day 3-4 | 2.4 壁状態統一 | 2日 |
| Day 5 | 2.5 制約ライブラリ活用 | 1日 |

### Week 3: 低優先度 + テスト
| 日 | タスク | 工数 |
|----|--------|-----|
| Day 1 | 3.2 JSDoc追加 | 1日 |
| Day 2-4 | 3.3 テスト追加 | 3日 |
| Day 5 | ドキュメント整備 | 1日 |

---

## 完了基準

### Phase 1 完了条件
- [ ] `npm run build` がエラーなく通る
- [ ] Grid の境界外アクセスで適切なエラーが発生する
- [ ] エクスポート衝突がない

### Phase 2 完了条件
- [ ] 重複コードが50%削減されている
- [ ] 主要10ソルバーが BaseFieldState を継承
- [ ] 壁表現が統一されている

### Phase 3 完了条件
- [ ] コアモジュールのテストカバレッジ80%以上
- [ ] 全パブリックAPIにJSDocがある

---

*作成日: 2025-11-29*
