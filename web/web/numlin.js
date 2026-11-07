import { solveNumlin as solveCore } from "./numlin/core.js";
import { t } from "./i18n.js";

export { isNumlinUrl } from "./numlin/core.js";

export async function solveNumlin(text, options) {
  const result = await solveCore(text, options);
  return localizeNumlinResult(result);
}

export function localizeNumlinResult(result) {
  return result.error_key && result.error === result.error_key
    ? { ...result, error: t(result.error_key) } : result;
}
