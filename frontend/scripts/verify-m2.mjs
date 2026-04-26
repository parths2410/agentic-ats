import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SHOTS = "/tmp/m2-screenshots";
mkdirSync(SHOTS, { recursive: true });

const BASE = "http://localhost:5173";
const FIXTURES = "/tmp/m2-fixtures";
const RESUMES = [
  `${FIXTURES}/alice_chen.pdf`,
  `${FIXTURES}/bobby_singh.pdf`,
  `${FIXTURES}/carlos_rivera.pdf`,
];

const JD = `Senior Backend Engineer

Required:
- 6+ years building production backend systems in Python or Go.
- Strong experience with PostgreSQL, including schema design and query tuning.
- Proven ability to design REST or gRPC APIs.
- Comfort operating distributed systems: queues, caches, retries, idempotency.
- Solid testing discipline.

Nice to have:
- FastAPI or async Python frameworks.
- Event-driven architectures (Kafka, NATS, etc.).
- Mentoring junior engineers.
`;

const log = [];
const consoleErrors = [];
const networkFailures = [];

function L(m) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${m}`;
  console.log(line);
  log.push(line);
}

async function shot(page, name) {
  const path = resolve(SHOTS, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  L(`shot: ${name}.png`);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() === "error") {
      consoleErrors.push(m.text());
      L(`console.error: ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => {
    consoleErrors.push(`pageerror: ${e.message}`);
    L(`pageerror: ${e.message}`);
  });
  page.on("requestfailed", (r) => {
    const f = `${r.method()} ${r.url()} — ${r.failure()?.errorText}`;
    networkFailures.push(f);
    L(`requestfailed: ${f}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) {
      networkFailures.push(`${r.status()} ${r.request().method()} ${r.url()}`);
      L(`bad response: ${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });

  try {
    L("STEP 1 — open roles page");
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await shot(page, "01-roles-empty");

    L("STEP 2 — create a role");
    await page.getByRole("button", { name: /\+ New Role/ }).click();
    await page.waitForURL("**/roles/new");
    await page.locator("#title").fill("M2 — Senior Backend Engineer");
    await page.locator("#jd").fill(JD);
    await page.getByRole("button", { name: /Create Role/ }).click();
    await page.waitForURL(/\/roles\/[0-9a-f-]{36}$/, { timeout: 10000 });
    const roleId = page.url().match(/\/roles\/([0-9a-f-]{36})$/)[1];
    L(`  role ${roleId}`);
    await shot(page, "02-role-created");

    L("STEP 3 — extract criteria");
    await page.getByRole("button", { name: /Extract Criteria/ }).click();
    await page.waitForFunction(() => document.querySelectorAll(".criterion-card").length > 0, { timeout: 60000 });
    const cardCount = await page.locator(".criterion-card").count();
    L(`  got ${cardCount} criteria cards`);
    await page.getByRole("button", { name: /^Save Criteria$/ }).click();
    await page.waitForSelector(".status:has-text('Saved')");
    L(`  criteria saved`);
    await shot(page, "03-criteria-saved");

    L("STEP 4 — find upload zone");
    const uploadZone = page.locator(".upload-zone");
    await uploadZone.scrollIntoViewIfNeeded();
    await shot(page, "04-upload-zone");

    L("STEP 5 — pick PDFs and upload");
    // Drive the hidden file input directly.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(RESUMES);
    await page.waitForSelector(".staged-list li");
    const staged = await page.locator(".staged-list li").count();
    L(`  staged ${staged} files`);
    await shot(page, "05-staged");

    await page.getByRole("button", { name: /Upload \d+ PDFs?/ }).click();
    // Wait for status banner indicating upload accepted.
    await page.waitForSelector(".status:has-text('Upload accepted')", { timeout: 30000 });
    L(`  upload accepted`);
    await shot(page, "06-upload-accepted");

    L("STEP 6 — open Workspace");
    await page.getByRole("link", { name: /Open Workspace/ }).click();
    await page.waitForURL(/\/workspace$/, { timeout: 10000 });
    await page.waitForSelector(".candidate-card", { timeout: 30000 });
    const initialCards = await page.locator(".candidate-card").count();
    L(`  initial workspace cards: ${initialCards}`);
    await shot(page, "07-workspace-initial");

    L("STEP 7 — wait for all candidates to reach 'complete' or 'error'");
    await page.waitForFunction(
      () => {
        const cards = Array.from(document.querySelectorAll(".candidate-card"));
        if (cards.length === 0) return false;
        return cards.every((c) => {
          const cls = c.className;
          return cls.includes("status-complete") || cls.includes("status-error");
        });
      },
      { timeout: 180000 },
    );
    const finalCards = await page.locator(".candidate-card").count();
    const finalSummary = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".candidate-card")).map((c) => ({
        rank: c.querySelector(".candidate-rank")?.textContent?.trim(),
        name: c.querySelector(".candidate-name")?.firstChild?.textContent?.trim(),
        agg: c.querySelector(".agg-num")?.textContent?.trim(),
        status: Array.from(c.classList).find((x) => x.startsWith("status-"))?.replace("status-", ""),
        miniScores: c.querySelectorAll(".mini-score").length,
      }));
    });
    L(`  final cards: ${finalCards}`);
    L(`  ${JSON.stringify(finalSummary, null, 2)}`);
    await shot(page, "08-workspace-complete");

    L("STEP 8 — expand the top candidate");
    const top = page.locator(".candidate-card").first();
    await top.getByRole("button", { name: /^Expand$/ }).click();
    await page.waitForSelector(".candidate-detail", { timeout: 5000 });
    const breakdownItems = await page.locator(".rationale-list li").count();
    L(`  expanded; rationale items: ${breakdownItems}`);
    await shot(page, "09-expanded");

    L("STEP 9 — verify rank-1 has highest aggregate");
    const ordered = finalSummary.filter((c) => c.status === "complete").map((c) => parseFloat(c.agg));
    const isDesc = ordered.every((v, i) => i === 0 || v <= ordered[i - 1]);
    L(`  scores in card order: ${JSON.stringify(ordered)} sorted desc? ${isDesc}`);

    L("STEP 10 — back to Roles, count shows N candidates");
    await page.getByRole("link", { name: "Roles" }).click();
    await page.waitForSelector(".role-card");
    const meta = await page.locator(".role-card .role-meta").first().textContent();
    L(`  role meta: ${JSON.stringify(meta)}`);
    await shot(page, "10-roles-after");
  } catch (err) {
    L(`FATAL: ${err.message}`);
    L(err.stack || "");
    await shot(page, "99-fatal");
    process.exitCode = 2;
  } finally {
    L("--- summary ---");
    L(`console errors: ${consoleErrors.length}`);
    consoleErrors.forEach((e) => L(`  ${e}`));
    L(`network failures: ${networkFailures.length}`);
    networkFailures.forEach((e) => L(`  ${e}`));
    writeFileSync("/tmp/m2-screenshots/log.txt", log.join("\n"));
    await browser.close();
  }
})();
