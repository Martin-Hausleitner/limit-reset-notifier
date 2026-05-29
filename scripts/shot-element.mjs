#!/usr/bin/env node
// shot-element.mjs — screenshot the notification room in Element (token-seeded session).
// Proves the message physically lives on the Matrix homeserver, shown in a real client.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_PATH || "playwright");

const hs = process.env.MATRIX_HOMESERVER_URL || "https://matrix.example.org";
const token = process.env.MATRIX_TOKEN;
const userId = process.env.MATRIX_USER_ID || "@user:example.org";
const deviceId = process.env.MATRIX_DEVICE_ID || "DEVICE";
const roomId = process.env.MATRIX_ROOM_ID;
const out = process.argv[2] || "proof/matrix-element.png";
const elementUrl = process.env.ELEMENT_URL || "https://app.element.io";

// Chrome's resolver won't resolve Tailscale MagicDNS (*.ts.net) → map it to the tailnet IP.
const hsHost = new URL(hs).hostname;
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox", `--host-resolver-rules=MAP ${hsHost} 100.120.120.120`],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

await page.addInitScript(
  ({ hs, token, userId, deviceId }) => {
    try {
      localStorage.setItem("mx_hs_url", hs);
      localStorage.setItem("mx_is_url", "https://vector.im");
      localStorage.setItem("mx_user_id", userId);
      localStorage.setItem("mx_access_token", token);
      localStorage.setItem("mx_device_id", deviceId);
      localStorage.setItem("mx_is_guest", "false");
      localStorage.setItem("mx_has_pickle_key", "false");
    } catch {}
  },
  { hs, token, userId, deviceId }
);

await page.goto(elementUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await page.goto(`${elementUrl}/#/room/${roomId}`, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
// give Element time to /sync and paint the timeline
await page.waitForSelector("text=Limit-Reset", { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(5000);
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log("element shot →", out);
