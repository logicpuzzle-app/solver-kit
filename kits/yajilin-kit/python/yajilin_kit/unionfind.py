from __future__ import annotations


class UnionFind:
    def __init__(self) -> None:
        self.parents: dict[int, int] = {}

    @classmethod
    def from_uf(cls, other: "UnionFind") -> "UnionFind":
        result = cls()
        result.parents = dict(other.parents)
        return result

    def root(self, a: int) -> int:
        parent = self.parents.get(a)
        if parent is None or parent < 0:
            return a
        result = self.root(parent)
        self.parents[a] = result
        return result

    def size(self, a: int) -> float:
        # Missing sparse-map entries are undefined/NaN in the TypeScript original.
        value = self.parents.get(self.root(a))
        return float("nan") if value is None else -value

    def connect(self, a: int, b: int) -> bool:
        ra = self.root(a)
        rb = self.root(b)
        if ra == rb:
            return False
        if self.size(ra) < self.size(rb):
            ra, rb = rb, ra
        self.parents[ra] = self.parents.get(ra, -1) + self.parents.get(rb, -1)
        self.parents[rb] = ra
        return True

    def is_union(self, a: int, b: int) -> bool:
        return self.root(a) == self.root(b)
