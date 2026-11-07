import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
const corsOrigins = new Set([
  "https://puzsq.logicpuzzle.app", "https://puzsq-v3.logicpuzzle.app",
  "https://puzsq-dev-lhbvc.logicpuzzle.app", "https://puzsq-v3-dev-q32zfgk.logicpuzzle.app",
  // Puzsq のローカル開発（.work/local-dev/puzsq-local.sh）
  "https://puzsq-local.logicpuzzle.app:8443", "https://puzsq-dev-local.logicpuzzle.app:8444",
  ...(process.env.SOLVER_CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean),
]);

app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (origin && (corsOrigins.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      && ["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    res.vary("Origin");
    res.setHeader("Access-Control-Allow-Origin", origin);
    if (req.method === "OPTIONS") res.setHeader("Access-Control-Allow-Methods", "GET, HEAD");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(
  express.static(join(here, "web"), {
    // ファイル名にハッシュを持たない構成なので、全ファイル再検証(ETag で 304 になる)
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-cache");
    },
  })
);

const port = process.env.PORT || 8964;
app.listen(port, () => {
  console.log(`solver-web listening on :${port}`);
});
