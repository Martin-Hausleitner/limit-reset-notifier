#!/usr/bin/env node
// shot.mjs — screenshot a URL (with optional Basic-Auth) using system Chrome via Playwright.
// Usage: NODE_PATH=$(npm root -g) DASH_AUTH=user:pass node scripts/shot.mjs <url> <out.png> [width] [height]
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");

const url = process.argv[2];
const out = process.argv[3] || "proof/shot.png";
const width = Number(process.argv[4] || 920);
const height = Number(process.argv[5] || 1500);
if (!url) {
  console.error("usage: shot.mjs <url> <out.png> [w] [h]");
  process.exit(1);
}
const [username, password] = (process.env.DASH_AUTH || "").split(":");

const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({
  httpCredentials: username ? { username, password } : undefined,
  viewport: { width, height },
  deviceScaleFactor: 2,
  ignoreHTTPSErrors: true,
});
const page = await ctx.newPage();
// networkidle never settles on live-refreshing dashboards (e.g. Grafana) → tolerate the
// timeout and fall back to a fixed settle window. Override via env when needed.
await page.goto(url, { waitUntil: process.env.SHOT_WAITUNTIL || "networkidle", timeout: 45000 }).catch((e) => console.error("goto:", e.name));
if (process.env.SHOT_WAIT_TEXT) {
  await page.waitForSelector(`text=${process.env.SHOT_WAIT_TEXT}`, { timeout: 30000 }).catch(() => console.error("wait-text: not found"));
}
// optional scroll-nudge (off by default — can race Grafana kiosk scene rendering)
if (process.env.SHOT_SCROLL) {
  await page
    .evaluate(() => new Promise((r) => { window.scrollTo(0, document.body.scrollHeight); setTimeout(() => { window.scrollTo(0, 0); r(); }, 1000); }))
    .catch(() => {});
}
await page.waitForTimeout(Number(process.env.SHOT_SETTLE_MS || 2800)); // let countdowns + panels render
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log("shot →", out);
