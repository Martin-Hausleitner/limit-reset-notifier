#!/usr/bin/env node
// selfcheck.mjs — 30-minute watchdog. Verifies the whole stack is healthy and
// posts a Matrix ALERT if anything regresses. Writes state/selfcheck.json.
import { execSync } from "node:child_process";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env.deploy"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
} catch {}
const DASH = env.DASHBOARD_URL || "";
const USER = env.DASH_USER || "";
const PASS = env.DASH_PASS || "";
const HS = (env.MATRIX_HOMESERVER_URL || "").replace(/\/$/, "");

const checks = [];
const add = (name, pass, detail = "") => checks.push({ name, pass: !!pass, detail });
const sh = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", timeout: 60000, ...opts }).trim();
const curlCode = (args) => {
  try {
    return sh(`curl -s -o /dev/null -w '%{http_code}' --max-time 20 ${args}`);
  } catch {
    return "000";
  }
};

// 1) unit tests
try {
  const out = sh("node --test 2>&1", { cwd: ROOT });
  const m = out.match(/pass (\d+)[\s\S]*?fail (\d+)/);
  add("unit-tests", m && m[2] === "0", m ? `pass ${m[1]} fail ${m[2]}` : "no summary");
} catch (e) {
  const out = (e.stdout || "").toString();
  const m = out.match(/pass (\d+)[\s\S]*?fail (\d+)/);
  add("unit-tests", false, m ? `pass ${m[1]} fail ${m[2]}` : "threw");
}

// 2) public dashboard reachability + auth
if (DASH) {
  add("public-healthz", curlCode(`'${DASH}/healthz'`) === "200");
  add("public-no-auth-401", curlCode(`'${DASH}/'`) === "401");
  add("public-login-200", curlCode(`-u '${USER}:${PASS}' '${DASH}/'`) === "200");
} else add("public-dashboard", false, "no DASHBOARD_URL");

// 3) data freshness (served kpi.json)
try {
  const body = sh(`curl -s --max-time 20 -u '${USER}:${PASS}' '${DASH}/kpi.json'`);
  const kpi = JSON.parse(body);
  const ageMin = (Date.now() - Date.parse(kpi.dataCapturedAt)) / 60000;
  add("data-fresh", ageMin < 30, `${Math.round(ageMin)} min old`);
} catch (e) {
  add("data-fresh", false, "kpi.json unreadable");
}

// 4) vcvm services
try {
  const s = sh(`ssh -o BatchMode=yes -o ConnectTimeout=10 ${env.VCVM_HOST || "vcvm"} 'systemctl is-active limit-reset-dashboard limit-reset-tunnel'`);
  add("vcvm-services", s.split("\n").every((x) => x.trim() === "active"), s.replace(/\n/g, "/"));
} catch {
  add("vcvm-services", false, "ssh failed");
}

// 5) launchd collector healthy
try {
  const p = sh(`launchctl print gui/${process.getuid()}/com.mh.limit-reset-notifier 2>/dev/null`);
  const exit = (p.match(/last exit code = (\d+)/) || [])[1];
  add("launchd-collector", exit === "0", `last exit ${exit}`);
} catch {
  add("launchd-collector", false, "not loaded");
}

// 6) Matrix notification path reachable (read-only — proves delivery channel, no spam)
try {
  const token = process.env.MATRIX_TOKEN || sh(`security find-generic-password -s matrix-archive-sync -a ${os.userInfo().username} -w`);
  const room = JSON.parse(fs.readFileSync(path.join(ROOT, "state", "room.json"), "utf8")).room_id;
  const body = sh(`curl -sk --max-time 15 -H "Authorization: Bearer ${token}" "${HS}/_matrix/client/v3/rooms/${encodeURIComponent(room)}/messages?dir=b&limit=1"`);
  const j = JSON.parse(body);
  add("matrix-room-reachable", Array.isArray(j.chunk), `read ${j.chunk?.length ?? 0} event(s)`);
} catch {
  add("matrix-room-reachable", false, "room unreachable");
}

const failed = checks.filter((c) => !c.pass);
const result = { ranAt: new Date().toISOString(), allPass: failed.length === 0, checks };
fs.mkdirSync(path.join(ROOT, "state"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "state", "selfcheck.json"), JSON.stringify(result, null, 2));

console.log(`[selfcheck ${result.ranAt}] ${result.allPass ? "ALL PASS" : "FAILURES: " + failed.map((f) => f.name).join(", ")}`);
for (const c of checks) console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}${c.detail ? " — " + c.detail : ""}`);

// alert Matrix on failure
if (!result.allPass) {
  try {
    const token = process.env.MATRIX_TOKEN || sh(`security find-generic-password -s matrix-archive-sync -a ${os.userInfo().username} -w`);
    const room = JSON.parse(fs.readFileSync(path.join(ROOT, "state", "room.json"), "utf8")).room_id;
    const body = `⚠️ Selfcheck-ALARM (${result.ranAt}) — fehlgeschlagen: ${failed.map((f) => f.name + (f.detail ? ` (${f.detail})` : "")).join(", ")}`;
    const data = JSON.stringify({ msgtype: "m.text", body });
    const agent = new https.Agent({ rejectUnauthorized: false });
    const txn = `selfcheck-${Date.now()}`;
    await new Promise((res, rej) => {
      const req = https.request(
        new URL(`${HS}/_matrix/client/v3/rooms/${encodeURIComponent(room)}/send/m.room.message/${txn}`),
        { method: "PUT", agent, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
        (r) => { r.on("data", () => {}); r.on("end", res); }
      );
      req.on("error", rej);
      req.write(data);
      req.end();
    });
    console.log("  → Matrix alert sent");
  } catch (e) {
    console.log("  → Matrix alert FAILED:", e.message);
  }
}
process.exit(result.allPass ? 0 : 1);
