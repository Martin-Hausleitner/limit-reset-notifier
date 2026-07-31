#!/usr/bin/env node
// collect-agents.mjs — running AI coding agents (Claude/Codex/OpenCode/AGY/Gemini)
// → live parallel-agents metrics + per-session ENRICHMENT: CPU%, status (active/idle/stale),
// working dir, and live token/cost burn from Claude session JSONL (last 15 min).
// host label distinguishes machines. Writes dist/agents.prom.
import { execSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sumCodexTokens } from "./lib/codex-burn.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.AGENTS_PROM_FILE || path.join(ROOT, "dist", "agents.prom");
const HOST = process.env.AGENT_HOST || "mac";
const IS_LINUX = os.platform() === "linux";
const NOW = Date.now();

const sh = (cmd) => { try { return execSync(cmd, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); } catch { return ""; } };

// ── ps reads: comm (clean classification), args (sessions), %cpu (active/idle) ──
const commRaw = sh("ps -axo pid=,etime=,comm=");
const argsRaw = sh("ps -axo pid=,args=");
const cpuRaw = sh("ps -axo pid=,%cpu=");

function etimeToSec(s) {
  let days = 0;
  if (s.includes("-")) { const [d, r] = s.split("-"); days = Number(d); s = r; }
  let sec = 0; for (const p of s.split(":").map(Number)) sec = sec * 60 + p;
  return days * 86400 + sec;
}
// classify purely by executable basename — never by prompt text (args can mention other tools)
function classify(comm) {
  const base = comm.split("/").pop();
  if (/\.app\/Contents\/(Frameworks|Helpers)\//.test(comm)) return null;
  if (base === "claude") return "claude";
  if (base === "codex") return "codex";
  if (base === "opencode") return "opencode";
  if (base === "gemini") return "gemini";
  if (base === "agy" || base === "antigravity" || base === "Antigravity") return "agy";
  if (base === "language_server_macos_arm" && /antigravity/i.test(comm)) return "agy";
  return null;
}

// pid → args (multiline-tolerant)
const argsByPid = new Map();
{ let cur = null; for (const line of argsRaw.split("\n")) { const m = line.match(/^\s*(\d+)\s+(.*)$/); if (m) { cur = m[1]; argsByPid.set(cur, m[2]); } else if (cur) argsByPid.set(cur, (argsByPid.get(cur) || "") + " " + line.trim()); } }
// pid → cpu%
const cpuByPid = new Map();
for (const line of cpuRaw.split("\n")) { const m = line.match(/^\s*(\d+)\s+([\d.]+)/); if (m) cpuByPid.set(m[1], Number(m[2])); }

function sessionIdOf(args) { const m = args.match(/--session-id[= ]([0-9a-fA-F-]{8,})/); return m ? m[1] : null; }
function shortLabel(tool, args, pid, sid, dir) {
  if (sid) return `${tool}·${sid.slice(0, 8)}`;
  if (dir && dir !== "?") return `${tool}·${dir.split("/").pop()}`;
  const n = args.match(/ -n ([^\s]+)/); if (n && n[1] !== tool) return `${tool}·${n[1]}`;
  return `${tool}·#${pid}`;
}

// ── working directory per pid (portable, batched) ──
function cwdFor(pids) {
  const map = new Map();
  if (!pids.length) return map;
  if (IS_LINUX) { for (const p of pids) { try { map.set(p, fs.readlinkSync(`/proc/${p}/cwd`)); } catch { /* gone */ } } return map; }
  const out = sh(`lsof -a -p ${pids.join(",")} -d cwd -Fpn 2>/dev/null`);
  let cur = null;
  for (const line of out.split("\n")) { if (line[0] === "p") cur = line.slice(1); else if (line[0] === "n" && cur) map.set(cur, line.slice(1)); }
  return map;
}

// ── live token/cost burn per Claude session (from JSONL tail, last 15 min) ──
const PRICE = { // USD per 1M tokens: [input, output, cache_read, cache_creation]
  opus: [15, 75, 1.5, 18.75], sonnet: [3, 15, 0.3, 3.75], haiku: [1, 5, 0.1, 1.25],
};
function priceFor(model = "") { return /opus/.test(model) ? PRICE.opus : /haiku/.test(model) ? PRICE.haiku : PRICE.sonnet; }
// index session-id → jsonl path (scan ~/.claude/projects/*/)
const jsonlIndex = new Map();
try {
  const base = path.join(os.homedir(), ".claude", "projects");
  for (const proj of fs.readdirSync(base)) {
    const dir = path.join(base, proj);
    let files = []; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) if (f.endsWith(".jsonl")) jsonlIndex.set(f.replace(/\.jsonl$/, ""), path.join(dir, f));
  }
} catch { /* no claude projects */ }
function burnFor(sid) {
  const fp = jsonlIndex.get(sid); if (!fp) return null;
  let buf;
  try { const fd = fs.openSync(fp, "r"); const size = fs.fstatSync(fd).size; const len = Math.min(size, 512 * 1024); buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd); } catch { return null; }
  const lines = buf.toString("utf8").split("\n"); lines.shift(); // drop partial first line
  let recentTok = 0, recentCost = 0, model = "";
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const u = (d.message || {}).usage; if (!u) continue;
    const ts = d.timestamp ? Date.parse(d.timestamp) : 0;
    if (NOW - ts > 900000) continue; // last 15 min only
    model = (d.message || {}).model || model;
    const [pi, po, pcr, pcc] = priceFor((d.message || {}).model);
    const i = u.input_tokens || 0, o = u.output_tokens || 0, cr = u.cache_read_input_tokens || 0, cc = u.cache_creation_input_tokens || 0;
    recentTok += i + o + cr + cc;
    recentCost += (i * pi + o * po + cr * pcr + cc * pcc) / 1e6;
  }
  return { recentTok, recentCost: +recentCost.toFixed(4), model };
}

// ── live Codex token burn (last 15 min) from ~/.codex/sessions rollout JSONL ──
// Codex doesn't expose a per-process session id, so we can't map burn to a single PID
// like Claude. Instead we sum the trailing-15-min token usage across all rollout files
// touched recently — an aggregate that reflects current Codex throughput. Each
// `event_msg`/`token_count` carries info.last_token_usage.total_tokens for that turn.
function codexRecentTokens() {
  const base = path.join(os.homedir(), ".codex", "sessions");
  // only today's + yesterday's date-partitioned dirs (sessions/YYYY/MM/DD/) — cheap
  const dayDirs = [0, 1].map((off) => {
    const dt = new Date(NOW - off * 86400000);
    return path.join(base, String(dt.getFullYear()), String(dt.getMonth() + 1).padStart(2, "0"), String(dt.getDate()).padStart(2, "0"));
  });
  let total = 0;
  for (const dir of dayDirs) {
    let ents; try { ents = fs.readdirSync(dir); } catch { continue; }
    for (const name of ents) {
      if (!name.startsWith("rollout-") || !name.endsWith(".jsonl")) continue;
      const fp = path.join(dir, name);
      try { if (NOW - fs.statSync(fp).mtimeMs > 20 * 60000) continue; } catch { continue; } // not touched recently
      let buf;
      try { const fd = fs.openSync(fp, "r"); const size = fs.fstatSync(fd).size; const len = Math.min(size, 512 * 1024); buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd); } catch { continue; }
      total += sumCodexTokens(buf.toString("utf8"), NOW, 900000);
    }
  }
  return total;
}

// ── live Claude token burn (last 15 min) AGGREGATE across recent session JSONLs ──
// burnFor() keys burn to a PID-discovered session id, but a running agent whose
// session id can't be mapped to its process (e.g. this very session) would be missed,
// leaving the headline tokens/min at 0 while real burn is happening. Mirror the Codex
// approach: walk ~/.claude/projects/*/*.jsonl touched in the last 20 min and sum the
// trailing-15-min usage directly — PID-independent, so the rate always reflects reality.
function claudeRecentTokens() {
  const base = path.join(os.homedir(), ".claude", "projects");
  let projs; try { projs = fs.readdirSync(base); } catch { return 0; }
  let total = 0;
  for (const proj of projs) {
    const dir = path.join(base, proj);
    let files; try { files = fs.readdirSync(dir); } catch { continue; }
    for (const name of files) {
      if (!name.endsWith(".jsonl")) continue;
      const fp = path.join(dir, name);
      try { if (NOW - fs.statSync(fp).mtimeMs > 20 * 60000) continue; } catch { continue; } // not touched recently
      let buf;
      try { const fd = fs.openSync(fp, "r"); const size = fs.fstatSync(fd).size; const len = Math.min(size, 512 * 1024); buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd); } catch { continue; }
      const lines = buf.toString("utf8").split("\n"); lines.shift(); // drop partial first line
      for (const line of lines) {
        if (!line.includes('"usage"')) continue;
        let d; try { d = JSON.parse(line); } catch { continue; }
        const u = (d.message || {}).usage; if (!u) continue;
        const ts = d.timestamp ? Date.parse(d.timestamp) : 0;
        if (NOW - ts > 900000) continue; // last 15 min only
        total += (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      }
    }
  }
  return total;
}

async function postJson(proto, port, csrfToken, body) {
  const lib = proto === "https" ? https : http;
  const data = JSON.stringify(body);
  return await new Promise((resolve) => {
    const req = lib.request({
      hostname: "127.0.0.1",
      port,
      path: "/exa.language_server_pb.LanguageServerService/GetUserStatus",
      method: "POST",
      rejectUnauthorized: false,
      timeout: 1500,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        "Connect-Protocol-Version": "1",
        "X-Codeium-Csrf-Token": csrfToken,
      },
    }, (res) => {
      let raw = "";
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        if (res.statusCode !== 200 || !raw.trim().startsWith("{")) return resolve(null);
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.write(data);
    req.end();
  });
}

function agyCandidates() {
  const out = [];
  for (const line of argsRaw.split("\n")) {
    if (!/language_server_macos_arm/.test(line) || !/csrf_token/.test(line) || !/antigravity/i.test(line)) continue;
    const pid = line.trim().match(/^(\d+)/)?.[1];
    if (!pid) continue;
    const tokens = [...line.matchAll(/--(?:csrf_token|extension_server_csrf_token)[= ]([a-zA-Z0-9-]+)/g)].map((m) => m[1]);
    const argPorts = [...line.matchAll(/--(?:extension_server_port|https_server_port|lsp_port)[= ](\d+)/g)].map((m) => m[1]);
    const lsof = sh(`lsof -a -iTCP -sTCP:LISTEN -n -P -p ${pid} 2>/dev/null`);
    const listenPorts = [...lsof.matchAll(/TCP\s+127\.0\.0\.1:(\d+)\s+\(LISTEN\)/g)].map((m) => m[1]);
    out.push({ ports: [...new Set([...argPorts, ...listenPorts])], tokens: [...new Set(tokens)] });
  }
  return out;
}

async function agyUserStatus() {
  const body = { metadata: { ideName: "antigravity", extensionName: "antigravity", locale: "en" } };
  for (const candidate of agyCandidates()) {
    for (const port of candidate.ports) {
      for (const token of candidate.tokens) {
        for (const proto of ["https", "http"]) {
          const data = await postJson(proto, port, token, body);
          if (data?.userStatus) return data.userStatus;
        }
      }
    }
  }
  return null;
}

// ── scan processes ──
const ACTIVE_CPU = 5, STALE_CPU = 1, STALE_AGE = 3 * 3600;
const perTool = {}; let total = 0, nActive = 0, nIdle = 0, nStale = 0;
const agents = []; // {pid, tool, runtime, cpu}
for (const line of commRaw.split("\n")) {
  const mm = line.match(/^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/); if (!mm) continue;
  const [, pid, etime, comm] = mm;
  const tool = classify(comm); if (!tool) continue;
  perTool[tool] = (perTool[tool] || 0) + 1; total++;
  agents.push({ pid, tool, runtime: etimeToSec(etime), cpu: cpuByPid.get(pid) || 0 });
}
const cwds = cwdFor(agents.map((a) => a.pid));
const sessions = new Map();
for (const a of agents) {
  const args = argsByPid.get(a.pid) || "";
  const sid = sessionIdOf(args);
  const dir = cwds.get(a.pid) || "?";
  const status = a.cpu >= ACTIVE_CPU ? "active" : (a.runtime > STALE_AGE && a.cpu < STALE_CPU ? "stale" : "idle");
  status === "active" ? nActive++ : status === "stale" ? nStale++ : nIdle++;
  const label = shortLabel(a.tool, args, a.pid, sid, dir);
  if (!sessions.has(label)) sessions.set(label, { tool: a.tool, runtime: a.runtime, cpu: a.cpu, dir: dir.replace(os.homedir(), "~"), status, burn: sid ? burnFor(sid) : null });
}

// ── emit ──
const L = [];
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 70);
const emit = (name, help, type, samples) => { if (!samples.length) return; L.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`); for (const { l, v } of samples) { if (v == null || Number.isNaN(v)) continue; const lbl = Object.entries(l).map(([k, x]) => `${k}="${esc(x)}"`).join(","); L.push(`${name}{${lbl}} ${v}`); } };
const TOOLS = ["claude", "codex", "agy", "opencode", "gemini"];
emit("ai_agents_running", "Running AI agents per tool", "gauge", TOOLS.map((t) => ({ l: { tool: t, host: HOST }, v: perTool[t] || 0 })));
emit("ai_agents_running_total", "Total running AI agents", "gauge", [{ l: { host: HOST }, v: total }]);
emit("ai_agents_active", "Agents actively working (CPU≥5%)", "gauge", [{ l: { host: HOST }, v: nActive }]);
emit("ai_agents_idle", "Agents idle / waiting for input", "gauge", [{ l: { host: HOST }, v: nIdle }]);
emit("ai_agents_stale", "Stale agents (>3h, ~0% CPU)", "gauge", [{ l: { host: HOST }, v: nStale }]);
emit("ai_agent_sessions_active", "Distinct active agent sessions", "gauge", [{ l: { host: HOST }, v: sessions.size }]);
const list = [...sessions.entries()];
emit("ai_agent_session_runtime_seconds", "Runtime per session (labels: dir, status)", "gauge", list.map(([s, o]) => ({ l: { session: s, tool: o.tool, host: HOST, dir: o.dir, status: o.status }, v: o.runtime })));
emit("ai_agent_session_cpu_percent", "CPU% per session", "gauge", list.map(([s, o]) => ({ l: { session: s, tool: o.tool, host: HOST }, v: o.cpu })));
emit("ai_agent_session_tokens_recent", "Tokens burned in last 15 min per session", "gauge", list.filter(([, o]) => o.burn).map(([s, o]) => ({ l: { session: s, tool: o.tool, host: HOST, model: o.burn.model || "?" }, v: o.burn.recentTok })));
emit("ai_agent_session_cost_recent_usd", "USD burned in last 15 min per session", "gauge", list.filter(([, o]) => o.burn).map(([s, o]) => ({ l: { session: s, host: HOST }, v: o.burn.recentCost })));

// ── headline KPI: token burn RATE (tokens/min) — tokens AND time combined ──
// recentTok is the trailing 15-min burn per session; ÷15 turns it into a live
// tokens-per-minute rate. Summed per tool (+ total) this is the single best
// gauge of real Claude/Codex throughput/utilisation right now.
const BURN_WINDOW_MIN = 900000 / 60000; // 15 min, matches burnFor() cutoff
const tpmByTool = {};
let tpmTotal = 0;
// Claude: aggregate trailing-15-min burn across recent session JSONLs (PID-independent,
// so an unmapped-but-active session still counts). See claudeRecentTokens().
const claudeTpm = claudeRecentTokens() / BURN_WINDOW_MIN;
if (claudeTpm > 0) { tpmByTool.claude = (tpmByTool.claude || 0) + claudeTpm; tpmTotal += claudeTpm; }
// Codex: aggregate trailing-15-min burn across recent rollout files (no per-PID mapping)
if (perTool.codex) {
  const codexTpm = codexRecentTokens() / BURN_WINDOW_MIN;
  if (codexTpm > 0) { tpmByTool.codex = (tpmByTool.codex || 0) + codexTpm; tpmTotal += codexTpm; }
}
// Emit every known tool so daily panels keep Codex/Claude/AGY visible even
// when a tool is idle or token burn is unavailable (0 is better than a disappearing line).
const tpmTools = TOOLS;
emit("ai_agent_tokens_per_minute", "Token burn rate per tool (tokens/min, trailing 15-min window)", "gauge", tpmTools.map((t) => ({ l: { tool: t, host: HOST }, v: +(tpmByTool[t] || 0).toFixed(1) })));
emit("ai_agent_tokens_per_minute_total", "Total token burn rate (tokens/min, trailing 15-min window)", "gauge", [{ l: { host: HOST }, v: +tpmTotal.toFixed(1) }]);

const agyStatus = await agyUserStatus();
if (agyStatus) {
  const plan = agyStatus.planStatus || {};
  const monthly = Number(plan.planInfo?.monthlyPromptCredits || 0);
  const available = Number(plan.availablePromptCredits || 0);
  if (monthly > 0) {
    emit("ai_agy_prompt_credits_available", "AGY available prompt credits from local Antigravity status", "gauge", [{ l: { host: HOST }, v: available }]);
    emit("ai_agy_prompt_credits_monthly", "AGY monthly prompt credits from local Antigravity status", "gauge", [{ l: { host: HOST }, v: monthly }]);
    emit("ai_agy_prompt_credits_used_percent", "AGY prompt credits used percent", "gauge", [{ l: { host: HOST }, v: +(((monthly - available) / monthly) * 100).toFixed(2) }]);
    emit("ai_agy_prompt_credits_remaining_percent", "AGY prompt credits remaining percent", "gauge", [{ l: { host: HOST }, v: +((available / monthly) * 100).toFixed(2) }]);
  }
  const models = agyStatus.cascadeModelConfigData?.clientModelConfigs || [];
  const rows = models.filter((m) => m?.quotaInfo).map((m) => {
    const reset = Date.parse(m.quotaInfo.resetTime || "");
    const remaining = Number(m.quotaInfo.remainingFraction);
    return {
      model: m.modelOrAlias?.model || "unknown",
      label: m.label || m.modelOrAlias?.model || "unknown",
      remainingPercent: Number.isFinite(remaining) ? +(remaining * 100).toFixed(2) : 0,
      resetIn: Number.isFinite(reset) ? Math.max(0, Math.round((reset - NOW) / 1000)) : 0,
      exhausted: remaining === 0 ? 1 : 0,
    };
  });
  emit("ai_agy_model_quota_remaining_percent", "AGY model quota remaining percent", "gauge", rows.map((r) => ({ l: { host: HOST, model: r.model, label: r.label }, v: r.remainingPercent })));
  emit("ai_agy_model_quota_reset_in_seconds", "AGY model quota reset in seconds", "gauge", rows.map((r) => ({ l: { host: HOST, model: r.model, label: r.label }, v: r.resetIn })));
  emit("ai_agy_model_quota_exhausted", "AGY model quota exhausted flag", "gauge", rows.map((r) => ({ l: { host: HOST, model: r.model, label: r.label }, v: r.exhausted })));
}

emit("ai_collector_up", "Agent collector heartbeat", "gauge", [{ l: { host: HOST }, v: 1 }]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join("\n") + "\n");
console.log(`agents → ${OUT} · total=${total} (active=${nActive} idle=${nIdle} stale=${nStale}) ` + TOOLS.map((t) => `${t}=${perTool[t] || 0}`).join(" ") + ` · sessions=${sessions.size}`);
