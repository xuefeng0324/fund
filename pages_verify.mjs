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

  // === Phase 3: Verify advice data (J值/阶段/建议/原因) ===
  const jCells = await page.locator("#fundTable tbody td[data-kdjj-d]").allTextContents();
  const jWithData = jCells.filter(t => t.trim() && t.trim() !== "--" && t.trim() !== "...");
  consoleLines.push(`[verify] J(日) total: ${jCells.length}, with data: ${jWithData.length}`);
  if (jWithData.length === 0) {
    consoleLines.push("[WARN] J(日) column has no data");
  }

  const phaseCells = await page.locator("#fundTable tbody td[data-phase]").allTextContents();
  const phaseWithData = phaseCells.filter(t => t.trim() && t.trim() !== "--" && t.trim() !== "...");
  consoleLines.push(`[verify] 阶段 total: ${phaseCells.length}, with data: ${phaseWithData.length}`);

  const adviceCells = await page.locator("#fundTable tbody td[data-advice]").allTextContents();
  const adviceWithData = adviceCells.filter(t => t.trim() && t.trim() !== "--" && t.trim() !== "...");
  consoleLines.push(`[verify] 建议 total: ${adviceCells.length}, with data: ${adviceWithData.length}`);

  const reasonCells = await page.locator("#fundTable tbody td[data-reason]").allTextContents();
  const reasonWithData = reasonCells.filter(t => t.trim() && t.trim() !== "--" && t.trim() !== "...");
  consoleLines.push(`[verify] 原因 total: ${reasonCells.length}, with data: ${reasonWithData.length}`);

  // 管理基金按钮存在
  const manageBtnExists = await page.locator("#manageFundsBtn").count() > 0;
  consoleLines.push(`[verify] 管理基金按钮DOM: ${manageBtnExists}`);

  // specialTable 也应有数据
  const specialRows = await page.locator("#specialTable tbody tr").count();
  consoleLines.push(`[verify] specialTable rows: ${specialRows}`);

  // sparkline SVGs
  const svgs = page.locator("#fundTable svg");
  const svgCount = await svgs.count();
  if (svgCount < 1) {
    consoleLines.push(`[warn] expected sparkline svg >= 1, got ${svgCount}`);
  }

  const html = await page.content();
  fs.writeFileSync(htmlPath, html, "utf-8");

  let screenshotOk = false;
  try {
    await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 15000 });
    screenshotOk = true;
  } catch (e) {
    consoleLines.push(`[warn] screenshot failed: ${e.message}`);
  }

  fs.writeFileSync(consoleLogPath, consoleLines.join("\n"), "utf-8");

  // Check for page errors
  const pageErrors = consoleLines.filter(l => l.startsWith("[pageerror]"));
  if (pageErrors.length > 0) {
    consoleLines.push(`[WARN] ${pageErrors.length} page error(s) detected`);
  }

  await browser.close();

  // Hard assertions
  const failures = [];
  if (initialCount < 1) failures.push("fundTable rows < 1");
  if (jWithData.length === 0) failures.push("J(日) has no data");
  if (phaseWithData.length === 0) failures.push("阶段 has no data");
  if (adviceWithData.length === 0) failures.push("建议 has no data");
  if (reasonWithData.length === 0) failures.push("原因 has no data");
  if (!manageBtnExists) failures.push("管理基金按钮不存在");

  if (failures.length > 0) {
    console.error("FAIL:", failures.join("; "));
    fs.writeFileSync(consoleLogPath, consoleLines.join("\n"), "utf-8");
    process.exit(1);
  }

  console.log("OK:", { url, screenshotPath: screenshotOk ? screenshotPath : "SKIPPED", htmlPath, consoleLogPath, externalApiHits: externalRequests.length, jData: jWithData.length, phaseData: phaseWithData.length, adviceData: adviceWithData.length, reasonData: reasonWithData.length });
})();
