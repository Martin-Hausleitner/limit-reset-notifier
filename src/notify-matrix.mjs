#!/usr/bin/env node
// notify-matrix.mjs — post a "limits reset + KPIs" message to a dedicated Matrix room.
// Token comes from the macOS keychain (matrix-archive-sync) or $MATRIX_TOKEN.
// Creates its own room on first run (your existing rooms are never touched).
//
// Flags: --force  send a status message even when no reset event was detected
import https from "node:https";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KPI = path.join(ROOT, "dist", "kpi.json");
const EVENTS = path.join(ROOT, "dist", "events.json");
const ROOMF = path.join(ROOT, "state", "room.json");
const PROOF = path.join(ROOT, "proof", "last-send.json");

const HS = (process.env.MATRIX_HOMESERVER_URL || "https://matrix.example.org").replace(/\/$/, "");
const DASH = process.env.DASHBOARD_URL || "";
const TZ = process.env.TZ || "Europe/Berlin";
const FORCE = process.argv.includes("--force");
// The homeserver uses a Tailscale/self-signed cert (their archive sets MATRIX_INSECURE_TLS=true).
const agent = new https.Agent({ rejectUnauthorized: false });

function token() {
  if (process.env.MATRIX_TOKEN) return process.env.MATRIX_TOKEN.trim();
  return execFileSync(
    "security",
    ["find-generic-password", "-s", "matrix-archive-sync", "-a", os.userInfo().username, "-w"],
    { encoding: "utf8" }
  ).trim();
}
const TOK = token();

function api(method, p, body) {
  const url = new URL(HS + p);
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        agent,
        headers: {
          Authorization: `Bearer ${TOK}`,
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let j;
          try {
            j = JSON.parse(buf || "{}");
          } catch {
            j = { raw: buf };
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(j);
          else reject(new Error(`${method} ${p} → HTTP ${res.statusCode}: ${buf.slice(0, 400)}`));
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function ensureRoom() {
  if (process.env.MATRIX_ROOM_ID) return process.env.MATRIX_ROOM_ID;
  if (fs.existsSync(ROOMF)) {
    const r = JSON.parse(fs.readFileSync(ROOMF, "utf8"));
    if (r.room_id) return r.room_id;
  }
  const r = await api("POST", "/_matrix/client/v3/createRoom", {
    name: "🔔 KI-Limit Reset Notifications",
    topic:
      "Automatische Benachrichtigung, wenn Claude-Code- / Codex-Limits zurückgesetzt werden. Quelle: limit-reset-notifier.",
    preset: "private_chat",
    visibility: "private",
  });
  fs.mkdirSync(path.dirname(ROOMF), { recursive: true });
  fs.writeFileSync(ROOMF, JSON.stringify({ room_id: r.room_id, createdAt: new Date().toISOString() }, null, 2));
  return r.room_id;
}

function fmtLocal(iso) {
  try {
    return new Date(iso).toLocaleString("de-DE", {
      timeZone: TZ,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
function countdown(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
const mio = (n) => (n / 1e6).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " Mio";

function buildBodies(kpi, events) {
  const demo = events.some((e) => e.demo);
  const title = demo ? "🧪 TEST — Limit-Reset (Demo)" : "🔔 KI-Limit zurückgesetzt";
  const plain = [];
  const html = [];
  plain.push(`${title} — ${fmtLocal(kpi.generatedAt)} · ${kpi.host}`);
  html.push(`<strong>${title}</strong> — ${fmtLocal(kpi.generatedAt)} · <code>${kpi.host}</code>`);

  for (const e of events) {
    plain.push(`\n✅ ${e.label} · ${e.windowLabel} zurückgesetzt → ${e.remainingPercent}% frei`);
    html.push(`<br>✅ <strong>${e.label}</strong> · ${e.windowLabel} zurückgesetzt → <strong>${e.remainingPercent}% frei</strong>`);
  }

  plain.push(`\nVerfügbares Kontingent (wie viel du verbrauchen kannst):`);
  html.push(`<br><br><strong>Verfügbares Kontingent:</strong><ul>`);
  for (const p of kpi.providers) {
    plain.push(`• ${p.label}`);
    html.push(`<li><strong>${p.label}</strong><ul>`);
    for (const w of p.windows) {
      const when = w.expired ? "bereits zurückgesetzt" : `Reset in ${countdown(w.resetsInSeconds)} (${fmtLocal(w.resetsAt)})`;
      plain.push(`   - ${w.label}: ${w.remainingPercent}% frei · ${when}`);
      html.push(`<li>${w.label}: <strong>${w.remainingPercent}% frei</strong> · ${when}</li>`);
    }
    html.push(`</ul></li>`);
  }
  html.push(`</ul>`);

  const c = kpi.consumption.today;
  plain.push(`\nVerbrauch heute (ca.): Codex ${mio(c.codexTokensApprox)} Tok · Claude ${mio(c.claudeTokensApprox)} Tok / $${c.claudeCostUsdApprox}`);
  html.push(`<br><em>Verbrauch heute (ca.): Codex ${mio(c.codexTokensApprox)} Tok · Claude ${mio(c.claudeTokensApprox)} Tok / $${c.claudeCostUsdApprox}</em>`);

  if (DASH) {
    plain.push(`\nLive-Dashboard: ${DASH}`);
    html.push(`<br>📊 <a href="${DASH}">Live-Dashboard</a>`);
  }
  return { plain: plain.join("\n"), html: html.join("") };
}

async function main() {
  const kpi = JSON.parse(fs.readFileSync(KPI, "utf8"));
  const ev = fs.existsSync(EVENTS) ? JSON.parse(fs.readFileSync(EVENTS, "utf8")).events : [];
  if (ev.length === 0 && !FORCE) {
    console.log("Kein Reset-Event und kein --force → keine Nachricht gesendet.");
    return;
  }
  const whoami = await api("GET", "/_matrix/client/v3/account/whoami");
  const roomId = await ensureRoom();
  const { plain, html } = buildBodies(kpi, ev.length ? ev : [{ label: "Status", windowLabel: "—", remainingPercent: kpi.providers[0]?.headline.remainingPercent, demo: true }].filter(() => FORCE && ev.length === 0));

  const txn = `lrn-${Date.now()}-${process.pid}`;
  const sent = await api("PUT", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}`, {
    msgtype: "m.text",
    body: plain,
    format: "org.matrix.custom.html",
    formatted_body: html,
  });

  // read the event back as proof
  let readback = null;
  try {
    readback = await api("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(sent.event_id)}`);
  } catch (e) {
    readback = { error: String(e) };
  }

  const proof = {
    sentAt: new Date().toISOString(),
    homeserver: HS,
    sender: whoami.user_id,
    room_id: roomId,
    event_id: sent.event_id,
    bodyPlain: plain,
    readbackEventType: readback?.type,
    readbackSender: readback?.sender,
    readbackOriginTs: readback?.origin_server_ts,
    dashboard: DASH || null,
  };
  fs.mkdirSync(path.dirname(PROOF), { recursive: true });
  fs.writeFileSync(PROOF, JSON.stringify(proof, null, 2));

  console.log(`✅ Gesendet als ${whoami.user_id}`);
  console.log(`   Raum:     ${roomId}`);
  console.log(`   Event:    ${sent.event_id}`);
  console.log(`   Readback: type=${readback?.type} sender=${readback?.sender} ts=${readback?.origin_server_ts}`);
  console.log(`   Proof:    ${PROOF}`);
}

main().catch((e) => {
  console.error("FEHLER:", e.message);
  process.exit(1);
});
