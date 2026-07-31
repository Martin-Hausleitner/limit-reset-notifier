// kpis.mjs — derive a rich set (1000+) of Prometheus KPI series from CodexBar cost data.
// Dimensions: provider × model × token-type × role × time-window × day, plus ratios.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const COST = path.join(os.homedir(), "Library/Caches/CodexBar/cost-usage");
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};
const readFirstJson = (...paths) => paths.map(readJson).find(Boolean) || null;
const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const line = (name, labels, value) =>
  `${name}{${Object.entries(labels)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(",")}} ${Number.isFinite(value) ? value : 0}`;
const sum = (arr, k) => arr.reduce((a, r) => a + (r[k] || 0), 0);
const round = (n, d) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);
const ratio = (a, b) => (b > 0 ? round(a / b, 4) : 0);
const localDayKey = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

const WINDOWS = ["today", "d7", "d30", "all"];
const ROLES = ["all", "parent", "subagent"];

export function buildKpiProm(now = Date.now()) {
  const today = localDayKey(new Date(now));
  const DAY = 86400000;
  const inWindow = (dayKey, win) => {
    if (win === "all") return true;
    if (win === "today") return dayKey === today;
    const diff = (Date.parse(today) - Date.parse(dayKey)) / DAY;
    if (win === "d7") return diff >= 0 && diff < 7;
    if (win === "d30") return diff >= 0 && diff < 30;
    return false;
  };

  const groups = {}; // name -> { help, rows: [] }
  const emit = (name, help, labels, value) => {
    if (value == null || Number.isNaN(value)) return;
    const g = (groups[name] ||= { help: help || name, rows: [] });
    g.rows.push(line(name, labels, value));
  };

  // ---------- CLAUDE (per-request rows) ----------
  const claude = readJson(path.join(COST, "claude-v2.json"));
  const rows = [];
  for (const f of Object.values(claude?.files || {}))
    for (const r of f.claudeRows || []) if (r && r.model && r.dayKey) rows.push(r);
  const claudeModels = [...new Set(rows.map((r) => r.model))].sort();
  const claudeDays = [...new Set(rows.map((r) => r.dayKey))].sort();
  const roleMatch = (r, role) => role === "all" || r.pathRole === role;

  // rolling window aggregates: provider×model×role×window
  for (const model of claudeModels)
    for (const role of ROLES)
      for (const win of WINDOWS) {
        const sub = rows.filter((r) => r.model === model && roleMatch(r, role) && inWindow(r.dayKey, win));
        if (sub.length === 0) continue;
        const input = sum(sub, "input"), output = sum(sub, "output"), cr = sum(sub, "cacheRead"), cc = sum(sub, "cacheCreate");
        const cost = sum(sub, "costNanos") / 1e9, reqs = sub.length, total = input + output + cr + cc;
        const L = { provider: "claude", model, role, window: win };
        emit("airate_tokens_window", "Tokens in window by provider/model/type/role", { ...L, type: "input" }, input);
        emit("airate_tokens_window", "", { ...L, type: "output" }, output);
        emit("airate_tokens_window", "", { ...L, type: "cache_read" }, cr);
        emit("airate_tokens_window", "", { ...L, type: "cache_create" }, cc);
        emit("airate_tokens_window", "", { ...L, type: "total" }, total);
        emit("airate_cost_usd_window", "Cost (USD) in window by provider/model/role", L, round(cost, 4));
        emit("airate_requests_window", "Request count in window", L, reqs);
        emit("airate_cache_hit_ratio", "cacheRead / (input + cacheRead)", L, ratio(cr, input + cr));
        emit("airate_output_input_ratio", "output tokens / input tokens", L, ratio(output, Math.max(1, input)));
        emit("airate_cost_per_mtok_usd", "USD per million tokens", L, total > 0 ? round(cost / (total / 1e6), 4) : 0);
        emit("airate_tokens_per_request", "avg total tokens per request", L, reqs > 0 ? Math.round(total / reqs) : 0);
        emit("airate_cost_per_request_usd", "avg cost (USD) per request", L, reqs > 0 ? round(cost / reqs, 6) : 0);
      }

  // per-day history: provider×model×{type,cost,requests} (role=all) + role split for cost/total
  for (const model of claudeModels)
    for (const day of claudeDays) {
      const sub = rows.filter((r) => r.model === model && r.dayKey === day);
      if (!sub.length) continue;
      const L = { provider: "claude", model, day };
      emit("airate_tokens_by_day", "Tokens per day by provider/model/type", { ...L, type: "input" }, sum(sub, "input"));
      emit("airate_tokens_by_day", "", { ...L, type: "output" }, sum(sub, "output"));
      emit("airate_tokens_by_day", "", { ...L, type: "cache_read" }, sum(sub, "cacheRead"));
      emit("airate_tokens_by_day", "", { ...L, type: "cache_create" }, sum(sub, "cacheCreate"));
      emit("airate_cost_usd_by_day", "Cost (USD) per day by provider/model", L, round(sum(sub, "costNanos") / 1e9, 4));
      emit("airate_requests_by_day", "Requests per day by provider/model", L, sub.length);
      emit("airate_sessions_by_day", "Distinct sessions per day by model", L, new Set(sub.map((r) => r.sessionId)).size);
      for (const role of ["parent", "subagent"]) {
        const rs = sub.filter((r) => r.pathRole === role);
        if (!rs.length) continue;
        emit("airate_cost_usd_by_day_role", "Cost (USD) per day by model and role", { ...L, role }, round(sum(rs, "costNanos") / 1e9, 4));
        const tot = sum(rs, "input") + sum(rs, "output") + sum(rs, "cacheRead") + sum(rs, "cacheCreate");
        emit("airate_tokens_by_day_role", "Total tokens per day by model and role", { ...L, role }, tot);
      }
    }

  // provider/global rollups per window
  for (const win of WINDOWS) {
    const sub = rows.filter((r) => inWindow(r.dayKey, win));
    if (!sub.length) continue;
    const cost = sum(sub, "costNanos") / 1e9;
    const tot = sum(sub, "input") + sum(sub, "output") + sum(sub, "cacheRead") + sum(sub, "cacheCreate");
    emit("airate_provider_cost_usd_window", "Total provider cost (USD) in window", { provider: "claude", window: win }, round(cost, 4));
    emit("airate_provider_tokens_window", "Total provider tokens in window", { provider: "claude", window: win }, tot);
    emit("airate_provider_requests_window", "Total provider requests in window", { provider: "claude", window: win }, sub.length);
    const subShare = sub.filter((r) => r.pathRole === "subagent").length;
    emit("airate_subagent_request_share", "Share of requests from subagents", { provider: "claude", window: win }, ratio(subShare, sub.length));
    const sideShare = sub.filter((r) => r.isSidechain).length;
    emit("airate_sidechain_request_share", "Share of sidechain requests", { provider: "claude", window: win }, ratio(sideShare, sub.length));
    emit("airate_sessions_window", "Distinct sessions in window", { provider: "claude", window: win }, new Set(sub.map((r) => r.sessionId)).size);
    emit("airate_subagent_cost_share", "Share of cost from subagents", { provider: "claude", window: win }, ratio(sum(sub.filter((r) => r.pathRole === "subagent"), "costNanos"), Math.max(1, sum(sub, "costNanos"))));
  }

  // ---------- CODEX (per-day per-model triples) ----------
  const codex = readFirstJson(path.join(COST, "codex-v8.json"), path.join(COST, "codex-v6.json"));
  const codexDays = Object.entries(codex?.days || {});
  const codexModels = [...new Set(codexDays.flatMap(([, m]) => Object.keys(m)))].sort();
  for (const [day, models] of codexDays)
    for (const [model, arr] of Object.entries(models)) {
      if (!Array.isArray(arr)) continue;
      const L = { provider: "codex", model, day };
      emit("airate_codex_tokens_by_day", "Codex tokens per day by model/type", { ...L, type: "total" }, arr[0] || 0);
      emit("airate_codex_tokens_by_day", "", { ...L, type: "cached" }, arr[1] || 0);
      emit("airate_codex_cost_by_day", "Codex cost proxy (micros) per day by model", L, arr[2] || 0);
    }
  for (const [day, models] of codexDays) {
    let total = 0, cached = 0, cost = 0;
    for (const arr of Object.values(models)) if (Array.isArray(arr)) { total += arr[0] || 0; cached += arr[1] || 0; cost += arr[2] || 0; }
    emit("airate_system_tokens_by_day", "Daily tokens by system from CodexBar", { system: "codex", day }, total);
    emit("airate_system_cached_tokens_by_day", "Daily cached tokens by system from CodexBar", { system: "codex", day }, cached);
    emit("airate_system_cost_proxy_by_day", "Daily cost proxy by system from CodexBar", { system: "codex", day }, cost);
  }
  for (const model of codexModels)
  for (const win of WINDOWS) {
      let tot = 0, cached = 0, cost = 0, days = 0;
      for (const [day, models] of codexDays) {
        if (!inWindow(day, win)) continue;
        const a = models[model];
        if (a) { tot += a[0] || 0; cached += a[1] || 0; cost += a[2] || 0; days++; }
      }
      if (days === 0) continue;
      const L = { provider: "codex", model, role: "all", window: win };
      emit("airate_tokens_window", "", { ...L, type: "total" }, tot);
      emit("airate_tokens_window", "", { ...L, type: "cached" }, cached);
      emit("airate_codex_cost_window", "Codex cost proxy (micros) in window by model", { provider: "codex", model, window: win }, cost);
      emit("airate_cache_hit_ratio", "", L, ratio(cached, tot));
    }

  for (const day of claudeDays) {
    const sub = rows.filter((r) => r.dayKey === day);
    const total = sum(sub, "input") + sum(sub, "output") + sum(sub, "cacheRead") + sum(sub, "cacheCreate");
    emit("airate_system_tokens_by_day", "Daily tokens by system from CodexBar", { system: "claude", day }, total);
    emit("airate_system_cached_tokens_by_day", "Daily cached tokens by system from CodexBar", { system: "claude", day }, sum(sub, "cacheRead"));
    emit("airate_system_cost_usd_by_day", "Daily cost (USD) by system from CodexBar", { system: "claude", day }, round(sum(sub, "costNanos") / 1e9, 4));
    emit("airate_system_requests_by_day", "Daily requests by system from CodexBar", { system: "claude", day }, sub.length);
    emit("airate_system_sessions_by_day", "Daily sessions by system from CodexBar", { system: "claude", day }, new Set(sub.map((r) => r.sessionId)).size);
  }
  emit("airate_system_tokens_by_day", "Daily tokens by system from CodexBar", { system: "agy", day: today }, 0);

  const out = ["# limit-reset-notifier — derived usage/cost KPIs"];
  let count = 0;
  for (const [name, g] of Object.entries(groups)) {
    out.push(`# HELP ${name} ${g.help}`, `# TYPE ${name} gauge`, ...g.rows);
    count += g.rows.length;
  }
  return { text: out.join("\n") + "\n", count, claudeModels, codexModels, claudeDays: claudeDays.length };
}
