#!/usr/bin/env node
// collect-agents.mjs — count running AI coding agents (Claude / Codex / OpenCode /
// Antigravity / Gemini CLI) for a LIVE parallel-agents time-series, plus per-session
// runtime. Emits Prometheus metrics → dist/agents.prom. host label distinguishes machines.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.AGENTS_PROM_FILE || path.join(ROOT, "dist", "agents.prom");
const HOST = process.env.AGENT_HOST || "mac";

// Two separate ps reads. comm (no args) is reliable for classification — args can contain
// embedded newlines (huge --settings JSON / prompts) that break per-line parsing and made
// us undercount. args is read separately and only used for best-effort session labels.
let commRaw = "", argsRaw = "";
try { commRaw = execSync("ps -axo pid=,etime=,comm=", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); } catch (e) { commRaw = ""; }
try { argsRaw = execSync("ps -axo pid=,args=", { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); } catch (e) { argsRaw = ""; }

// parse ps etime "[[dd-]hh:]mm:ss" → seconds (portable macOS/Linux)
function etimeToSec(s) {
  let days = 0;
  if (s.includes("-")) { const [d, rest] = s.split("-"); days = Number(d); s = rest; }
  const parts = s.split(":").map(Number);
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return days * 86400 + sec;
}

// classify purely by EXECUTABLE basename (comm) — never by prompt text in args (an agent's
// prompt can mention other tools' names). GUI apps have capitalised comm (Codex/Claude/Gemini)
// or live under .app/Contents/Frameworks|Helpers; the CLI/agent binaries are lowercase.
function classify(comm) {
  const base = comm.split("/").pop();
  if (/\.app\/Contents\/(Frameworks|Helpers)\//.test(comm)) return null;
  if (base === "claude") return "claude";       // claude CLI binary (incl. subagents)
  if (base === "codex") return "codex";         // codex agent binary (exec/app-server); GUI helper comm = "Codex"
  if (base === "opencode") return "opencode";
  if (base === "gemini") return "gemini";       // gemini CLI (Gemini.app comm = "Gemini")
  if (base === "antigravity" || base === "Antigravity") return "antigravity";
  return null;
}
// derive a short, meaningful session label — always returns something
function sessionOf(tool, args, pid) {
  let m = args.match(/--session-id[= ]([0-9a-fA-F-]{6,})/);
  if (m) return `${tool}·${m[1].slice(0, 8)}`;
  m = args.match(/--working-dir[ =]"?([^" ]+)/) || args.match(/--cwd[ =]"?([^" ]+)/);
  if (m) return `${tool}·${m[1].split("/").pop()}`;
  m = args.match(/ -n ([^\s]+)/); // tmux window name (e.g. "claude")
  if (m && m[1] !== tool) return `${tool}·${m[1]}`;
  m = args.match(/ -c (\/[^ ]+)/); // tmux working dir
  if (m) return `${tool}·${m[1].split("/").pop()}`;
  m = args.match(/ -s ([0-9A-Fa-f-]{6,})/); // tmux session id
  if (m) return `tmux·${m[1].slice(0, 8)}`;
  return `${tool}·#${pid}`; // fallback: identify by pid so every agent is listed
}

// build pid → args map (multiline-tolerant: a line not starting with a known pid is a
// continuation of the previous process's args)
const argsByPid = new Map();
{
  let cur = null;
  for (const line of argsRaw.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (m) { cur = m[1]; argsByPid.set(cur, m[2]); }
    else if (cur) argsByPid.set(cur, (argsByPid.get(cur) || "") + " " + line.trim());
  }
}

const perTool = {};
const sessions = new Map(); // session → {tool, runtime}
let total = 0;
for (const line of commRaw.split("\n")) {
  const mm = line.match(/^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/);
  if (!mm) continue;
  const [, pid, etime, comm] = mm;
  const tool = classify(comm);
  if (!tool) continue;
  perTool[tool] = (perTool[tool] || 0) + 1;
  total++;
  const sess = sessionOf(tool, argsByPid.get(pid) || "", pid);
  if (!sessions.has(sess)) sessions.set(sess, { tool, runtime: etimeToSec(etime) });
}

const L = [];
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 60);
const emit = (name, help, type, samples) => { if (!samples.length) return; L.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`); for (const { l, v } of samples) { const lbl = Object.entries(l).map(([k, x]) => `${k}="${esc(x)}"`).join(","); L.push(`${name}{${lbl}} ${v}`); } };

const TOOLS = ["claude", "codex", "opencode", "antigravity", "gemini"];
emit("ai_agents_running", "Running AI coding agents per tool", "gauge", TOOLS.map((t) => ({ l: { tool: t, host: HOST }, v: perTool[t] || 0 })));
emit("ai_agents_running_total", "Total running AI coding agents", "gauge", [{ l: { host: HOST }, v: total }]);
emit("ai_agent_sessions_active", "Distinct active agent sessions", "gauge", [{ l: { host: HOST }, v: sessions.size }]);
const sess = [...sessions.entries()].sort((a, b) => b[1].runtime - a[1].runtime).slice(0, 40);
emit("ai_agent_session_runtime_seconds", "Runtime per active agent session", "gauge", sess.map(([s, o]) => ({ l: { session: s, tool: o.tool, host: HOST }, v: o.runtime })));
emit("ai_collector_up", "Agent collector heartbeat (1=ok)", "gauge", [{ l: { host: HOST }, v: 1 }]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join("\n") + "\n");
console.log(`agents → ${OUT} · total=${total} ` + TOOLS.map((t) => `${t}=${perTool[t] || 0}`).join(" ") + ` · sessions=${sessions.size}`);
