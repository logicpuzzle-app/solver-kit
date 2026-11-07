import { CSPUZ_KINDS, createCspuzAliasMap } from "./cspuz-kinds.js";

export const KIT_KINDS = new Set(["sudoku", "slitherlink", "yajilin", "nurikabe", "akari", "masyu"]);
const legacy = new Map([
  ["sudoku", "sudoku"], ["slither", "slitherlink"], ["yajilin", "yajilin"],
  ["nurikabe", "nurikabe"], ["akari", "akari"], ["mashu", "masyu"],
  ["masyu", "masyu"], ["pearl", "masyu"], ["numlin", "numlin"],
]);
const aliases = createCspuzAliasMap();
export const cspuzKinds = new Map(CSPUZ_KINDS.map(kind => [kind.key, kind]));

export function query(text) {
  const trimmed = text.trim();
  return trimmed.slice(trimmed.indexOf("?") + 1);
}

export function isKitUrl(url) {
  return KIT_KINDS.has(legacy.get(query(url).split("/")[0]));
}

// Kit URLs may use names cspuz does not know (e.g. pearl), so rewrite them to the cspuz key.
export function cspuzQuery(url, kind) {
  const [variety, ...rest] = query(url).split("/");
  return aliases.has(variety) || !cspuzKinds.has(kind) ? query(url) : [kind, ...rest].join("/");
}

export function supportedKind(url) {
  if (typeof url !== "string") return null;
  const variety = query(url).split("/")[0];
  return legacy.get(variety) ?? aliases.get(variety) ?? null;
}
