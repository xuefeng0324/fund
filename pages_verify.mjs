import { chromium } from "playwright";
import fs from "node:fs";

const url = process.argv[2];
const outDir = process.argv[3] || "artifacts";

if (!url) {
  console.error("Usage: node pages_verify.mjs <PAGE_URL> [OUT_DIR]");
  process.exit(1);
}

await (async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const safeOut = (p) => p.replace(/[\\/:*?"<>|]+/g, "_");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(outDir, { recursive: true });
  const screenshotPath = `${outDir}/${safeOut("page")}-${ts}.png`;
  const htmlPath = `${outDir}/${safeOut("page")}-${ts}.html`;
  const consoleLogPath = `${outDir}/${safeOut("console")}-${ts}.txt`;

  const consoleLines = [];
  page.on("console", (msg) => consoleLines.push(`[console] ${msg.type()}: ${msg.text()}`));
  page.on("pageerror", (err) => consoleLines.push(`[pageerror] ${err.message}`));

  // === Phase 1: Initial page load ===
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  const h1 = page.locator("h1");
  await h1.first().waitFor({ timeout: 30000 });
  const h1Text = (await h1.first().innerText()).trim();
  if (!h1Text.includes("基金")) {
    throw new Error(`Unexpected h1 text: ${h1Text}`);
  }

  const rows = page.locator("#fundTable tbody tr");
  const initialCount = await rows.count();
  if (initialCount < 1) {
    throw new Error(`Expected fund table rows >= 1, got ${initialCount}`);
  }

  // === Phase 2: Click refresh and verify live network requests ===
  const externalRequests = [];
  const liveApiPatterns = [
    "fundmobapi.eastmoney.com",
    "fundgz.1234567.com.cn",
    "push2.eastmoney.com",
    "fund.eastmoney.com/pingzhongdata",
  ];

  page.on("request", (req) => {
    const reqUrl = req.url();
    if (liveApiPatterns.some((p) => reqUrl.includes(p))) {
      externalRequests.push(reqUrl);
    }
  });

  const refreshBtn = page.locator("#refreshBtn");
  if ((await refreshBtn.count()) > 0) {
    await refreshBtn.click();
    // Wait for external API requests to fire (up to 20s)
    const start = Date.now();
    while (externalRequests.length === 0 && Date.now() - start < 20000) {
      await page.waitForTimeout(500);
    }
    // Wait a bit more for rendering to complete
    await page.waitForTimeout(3000);
  }

  const afterCount = await rows.count();
  consoleLines.push(`[verify] initial rows: ${initialCount}, after refresh rows: ${afterCount}`);
  consoleLines.push(`[verify] external API requests captured: ${externalRequests.length}`);
  externalRequests.slice(0, 10).forEach((u) => consoleLines.push(`  -> ${u.slice(0, 120)}`));

  if (externalRequests.length === 0) {
    consoleLines.push("[WARN] No external API requests detected after refresh click");
  }

  // sparkline SVGs
  const svgs = page.locator("#fundTable svg");
  const svgCount = await svgs.count();
  if (svgCount < 1) {
    consoleLines.push(`[warn] expected sparkline svg >= 1, got ${svgCount}`);
  }

  await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 60000 });
  const html = await page.content();
  fs.writeFileSync(htmlPath, html, "utf-8");
  fs.writeFileSync(consoleLogPath, consoleLines.join("\n"), "utf-8");

  await browser.close();
  console.log("OK:", { url, screenshotPath, htmlPath, consoleLogPath, externalApiHits: externalRequests.length });
})();
