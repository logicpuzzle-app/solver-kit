/*
 * Yajilin Kit — TypeScript reference implementation.
 * Ported from gridkit `frontend/src/puzzle/yajilin/solver/algorithm/unionfind.ts`.
 *
 * The original stores parents in a sparse object and reads them without a default,
 * so `size()` of a not-yet-registered root evaluates to NaN and the union-by-size
 * comparison in `connect()` silently degrades to "never swap". Deductions depend on
 * the resulting tree shape, so the behaviour is reproduced verbatim rather than fixed.
 */

export class UnionFind {
  parents: Map<number, number>;

  constructor() {
    this.parents = new Map();
  }

  static fromUF(other: UnionFind): UnionFind {
    const uf = new UnionFind();
    uf.parents = new Map(other.parents);
    return uf;
  }

  root(a: number): number {
    const parent = this.parents.get(a);
    if (parent === undefined || parent < 0) {
      return a;
    }
    const r = this.root(parent);
    this.parents.set(a, r);
    return r;
  }

  /** NaN when the root has never been registered — see the note above. */
  size(a: number): number {
    const value = this.parents.get(this.root(a));
    return value === undefined ? NaN : -value;
  }

  connect(a: number, b: number): boolean {
    let ra = this.root(a);
    let rb = this.root(b);
    if (ra === rb) {
      return false;
    }
    if (this.size(ra) < this.size(rb)) {
      const tmp = ra;
      ra = rb;
      rb = tmp;
    }
    this.parents.set(ra, (this.parents.get(ra) ?? -1) + (this.parents.get(rb) ?? -1));
    this.parents.set(rb, ra);
    return true;
  }

  isUnion(a: number, b: number): boolean {
    return this.root(a) === this.root(b);
  }
}
