import express from "express";
import { fileURLToPath } from "node:url";

const app = express();
app.use(express.static(fileURLToPath(new URL("../examples/sdk-host/", import.meta.url)), {
  setHeaders(res) { res.setHeader("Cache-Control", "no-cache"); },
}));
const port = process.env.PORT || 8965;
app.listen(port, () => console.log(`sdk-host listening on http://localhost:${port}`));
