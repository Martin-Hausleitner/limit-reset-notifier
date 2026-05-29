#!/usr/bin/env node
// shot-matrix.mjs — fetch the notification room's messages LIVE from the homeserver
// (authoritative, with the real token) and render them as a chat view, then screenshot.
// Honest proof: the picture is the server's actual /messages response, not a mock.
import https from "node:https";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");

const HS = (process.env.MATRIX_HOMESERVER_URL || "https://matrix.example.org").replace(/\/$/, "");
const TOK = process.env.MATRIX_TOKEN;
const ROOM = process.env.MATRIX_ROOM_ID;
const OUT = process.argv[2] || "proof/matrix-readback.png";
const agent = new https.Agent({ rejectUnauthorized: false });

function api(p) {
  return new Promise((resolve, reject) => {
    https
      .request(new URL(HS + p), { agent, headers: { Authorization: `Bearer ${TOK}` } }, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
        });
      })
      .on("error", reject)
      .end();
  });
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const name = await api(`/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/state/m.room.name/`).catch(() => ({}));
const msgs = await api(`/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/messages?dir=b&limit=8`);
const events = (msgs.chunk || []).filter((e) => e.type === "m.room.message").reverse();

const bubbles = events
  .map((e) => {
    const ts = new Date(e.origin_server_ts).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const body = e.content.formatted_body || esc(e.content.body || "").replace(/\n/g, "<br>");
    return `<div class="msg"><div class="who">${esc(e.sender)} · <span class="ts">${ts}</span> · <span class="eid">${esc(e.event_id).slice(0, 18)}…</span></div><div class="bubble">${body}</div></div>`;
  })
  .join("");

const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#1b1b1f;color:#e6e9f0;font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif}
  .head{background:#22232a;border-bottom:1px solid #34353d;padding:14px 20px;display:flex;align-items:center;gap:10px}
  .head .dot{width:34px;height:34px;border-radius:8px;background:#0dbd8b;display:grid;place-items:center;font-size:18px}
  .head b{font-size:16px}.head .sub{color:#8b93a7;font-size:12.5px}
  .feed{padding:18px 20px 28px;max-width:760px}
  .msg{margin:16px 0}.who{color:#8b93a7;font-size:12px;margin-bottom:4px}
  .ts,.eid{color:#6f7689}.bubble{background:#26272e;border:1px solid #34353d;border-radius:4px 14px 14px 14px;padding:12px 15px;display:inline-block;max-width:100%}
  .bubble ul{margin:6px 0;padding-left:20px}.bubble code{background:#15161b;padding:1px 5px;border-radius:4px}
  .banner{background:#0f2419;border:1px solid #1d4a33;color:#2fd27a;padding:7px 20px;font-size:12.5px}
</style>
<div class="head"><div class="dot">🔔</div><div><b>${esc(name.name || "Limit Reset Notifications")}</b><div class="sub">${esc(ROOM)} · ${esc(HS)}</div></div></div>
<div class="banner">● Live-Readback vom Matrix-Homeserver (GET /messages, authentifiziert) — ${events.length} Nachricht(en)</div>
<div class="feed">${bubbles}</div>`;

const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 820, height: 1100 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.screenshot({ path: OUT, fullPage: true });
await browser.close();
console.log(`matrix readback shot → ${OUT} (${events.length} messages)`);
