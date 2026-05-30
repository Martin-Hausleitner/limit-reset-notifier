import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");
const url = process.argv[2];
const b = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs = [];
p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(`[${m.type()}] ${m.text().slice(0, 240)}`); });
p.on("pageerror", (e) => errs.push(`[pageerror] ${(e.message || "").slice(0, 320)}`));
await p.goto(url, { waitUntil: "load", timeout: 45000 }).catch((e) => console.log("goto:", e.name));
await p.waitForTimeout(9000);
const dom = await p.evaluate(() => ({
  panelKeys: document.querySelectorAll("[data-viz-panel-key]").length,
  panelContainers: document.querySelectorAll('[class*="panel"]').length,
  testids: [...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")).filter((t) => t && t.includes("anel")).slice(0, 5),
  bodyText: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
}));
console.log("URL:", p.url());
console.log("DOM:", JSON.stringify(dom, null, 2));
console.log("CONSOLE ERRORS (" + errs.length + "):");
for (const e of errs.slice(0, 12)) console.log("  " + e);
await b.close();
