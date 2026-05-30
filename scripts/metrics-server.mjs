#!/usr/bin/env node
// metrics-server.mjs — serve dist/limit_reset.prom at /metrics (for a local Prometheus scrape).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROM = process.env.PROM_FILE || path.join(ROOT, "dist", "limit_reset.prom");
const PORT = Number(process.env.PORT || 9109);

http
  .createServer((req, res) => {
    if ((req.url || "").startsWith("/metrics")) {
      try {
        const body = fs.readFileSync(PROM);
        res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
        return res.end(body);
      } catch {
        res.writeHead(500);
        return res.end("# no metrics file\n");
      }
    }
    res.writeHead(200);
    res.end("ok");
  })
  .listen(PORT, "0.0.0.0", () => console.log(`metrics-server on http://0.0.0.0:${PORT}/metrics → ${PROM}`));
