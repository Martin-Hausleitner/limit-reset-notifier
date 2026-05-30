#!/usr/bin/env node
// server.mjs — tiny zero-dependency static server for the KPI dashboard.
// Basic-Auth protected. Serves index.html + kpi.json + notify.json.
// ENV: PORT (8799) HOST (0.0.0.0) DASH_USER DASH_PASS DATA_DIR STATIC_DIR
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8799);
const HOST = process.env.HOST || "0.0.0.0";
const USER = process.env.DASH_USER || "admin";
const PASS = process.env.DASH_PASS || "changeme";
const DATA_DIR = process.env.DATA_DIR || path.join(HERE, "data");
const STATIC_DIR = process.env.STATIC_DIR || HERE;

const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

// Path-restricted reverse proxy to Grafana — exposes ONLY read-only public-dashboard
// surfaces (never the anonymous-admin UI/API). Lets the Grafana dashboard be shared
// publicly through the same tunnel without leaking admin.
const GRAFANA = { host: process.env.GRAFANA_HOST || "127.0.0.1", port: Number(process.env.GRAFANA_PORT || 3000) };
const GRAFANA_PUBLIC_PREFIXES = ["/public-dashboards/", "/api/public/", "/public/", "/api/frontend/settings", "/api/health", "/avatar/"];
const isGrafanaPublic = (p) => GRAFANA_PUBLIC_PREFIXES.some((x) => p === x || p.startsWith(x));
function proxyGrafana(req, res) {
  const gr = http.request(
    { host: GRAFANA.host, port: GRAFANA.port, method: req.method, path: req.url,
      headers: { ...req.headers, host: `${GRAFANA.host}:${GRAFANA.port}`, "x-forwarded-host": req.headers.host || "", "x-forwarded-proto": "https" } },
    (gres) => { res.writeHead(gres.statusCode, gres.headers); gres.pipe(res); }
  );
  gr.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end("grafana upstream error"); });
  req.pipe(gr);
}

function timingSafeEq(a, b) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
function authed(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const [u, p] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":");
  return timingSafeEq(u || "", USER) && timingSafeEq(p || "", PASS);
}
function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}
function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, "not found");
    send(res, 200, buf, MIME[path.extname(file)] || "application/octet-stream");
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/healthz") return send(res, 200, "ok");
  if (isGrafanaPublic(url.pathname)) return proxyGrafana(req, res); // read-only Grafana public dashboards
  if (!authed(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="limit-reset-notifier", charset="UTF-8"' });
    return res.end("auth required");
  }
  switch (url.pathname) {
    case "/":
    case "/index.html":
      return serveFile(res, path.join(STATIC_DIR, "index.html"));
    case "/kpi.json":
      return serveFile(res, path.join(DATA_DIR, "kpi.json"));
    case "/notify.json":
      return serveFile(res, path.join(DATA_DIR, "notify.json"));
    default:
      return send(res, 404, "not found");
  }
});
server.listen(PORT, HOST, () => {
  console.log(`dashboard on http://${HOST}:${PORT}  (user=${USER}) data=${DATA_DIR}`);
});
