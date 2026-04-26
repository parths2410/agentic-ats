import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SHOTS = "/tmp/m1-screenshots";
mkdirSync(SHOTS, { recursive: true });

const BASE = "http://localhost:5173";
const JD = `Senior Backend Engineer

We're hiring a Senior Backend Engineer to design and build the core services
that power our platform. You'll own services end-to-end: API design,
data modeling, performance, reliability, observability.

Required:
- 6+ years building production backend systems in Python or Go.
- Strong experience with PostgreSQL, including schema design and query tuning.
- Proven ability to design REST or gRPC APIs and reason about backwards
  compatibility.
- Comfort operating distributed systems: queues, caches, retries, idempotency.
- Solid testing discipline (unit, integration, load).

Nice to have:
- Experience with FastAPI or async Python frameworks.
- Background in event-driven architectures (Kafka, NATS, etc.).
- Past work on developer-facing APIs or SDKs.
- Mentoring junior engineers.

You will:
- Lead the design of new services from scoping through rollout.
- Improve developer experience and platform reliability.
- Partner with product and infra to ship measurable wins.
`;

const consoleErrors = [];
const networkFailures = [];
const log = [];

function L(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() === "error") {
      const text = m.text();
      consoleErrors.push(text);
      L(`console.error: ${text}`);
    }
  });
  page.on("pageerror", (e) => {
    consoleErrors.push(`pageerror: ${e.message}`);
    L(`pageerror: ${e.message}`);
  });
  page.on("requestfailed", (req) => {
    const f = `${req.method()} ${req.url()} — ${req.failure()?.errorText}`;
    networkFailures.push(f);
    L(`requestfailed: ${f}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) {
      const f = `${r.status()} ${r.request().method()} ${r.url()}`;
      networkFailures.push(f);
      L(`bad response: ${f}`);
    }
  });

  let roleId = null;
  try {
    // 1. Roles page (empty state + health badge).
    L("STEP 1 — open roles page");
    await page.goto(BASE);
    await page.waitForLoadState("networkidle");
    await shot(page, "01-roles-empty");

    const h1 = await page.textContent("h1");
    L(`  h1: ${JSON.stringify(h1)}`);
    const newBtn = await page.getByRole("button", { name: /\+ New Role/ }).count();
    L(`  + New Role button count: ${newBtn}`);
    const empty = await page.locator("text=No roles yet").count();
    L(`  empty state visible: ${empty > 0}`);
    const badge = await page.locator(".health-status").textContent();
    const badgeClass = await page.locator(".health-status").getAttribute("class");
    L(`  health badge: ${JSON.stringify(badge)} class=${badgeClass}`);

    // 2. Click + New Role.
    L("STEP 2 — click + New Role");
    await page.getByRole("button", { name: /\+ New Role/ }).click();
    await page.waitForURL("**/roles/new");
    await page.waitForSelector("h1");
    await shot(page, "02-new-role-form");
    const titleField = await page.locator("#title").count();
    const jdField = await page.locator("#jd").count();
    L(`  title field: ${titleField}, jd field: ${jdField}`);

    // 3. Fill form, click Create Role.
    L("STEP 3 — fill JD and create role");
    await page.locator("#title").fill("Senior Backend Engineer");
    await page.locator("#jd").fill(JD);
    await shot(page, "03-form-filled");
    await page.getByRole("button", { name: /Create Role/ }).click();
    await page.waitForURL(/\/roles\/[0-9a-f-]{36}$/, { timeout: 10000 });
    const m = page.url().match(/\/roles\/([0-9a-f-]{36})$/);
    roleId = m && m[1];
    L(`  navigated to role ${roleId}`);
    await page.waitForSelector("h2:has-text('Scoring Criteria')");
    await shot(page, "04-role-saved");

    // 4. Extract Criteria.
    L("STEP 4 — Extract Criteria");
    await page.getByRole("button", { name: /Extract Criteria/ }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".criterion-card").length > 0,
      { timeout: 60000 },
    );
    const cards1 = await page.locator(".criterion-card").count();
    L(`  criterion cards: ${cards1}`);
    const autoBadges = await page.locator(".badge-auto").count();
    L(`  auto badges: ${autoBadges}`);
    await shot(page, "05-after-extract");

    // 5. Edit a criterion: drag slider, edit name + description on first card.
    L("STEP 5 — edit first criterion");
    const firstCard = page.locator(".criterion-card").first();
    const firstName = firstCard.locator("input.criterion-name");
    const origName = await firstName.inputValue();
    await firstName.fill(origName + " (edited)");
    const firstDesc = firstCard.locator("textarea.criterion-description");
    const origDesc = await firstDesc.inputValue();
    await firstDesc.fill(origDesc + " — edited.");
    const slider = firstCard.locator("input.weight-slider");
    // Set weight via React-friendly input event.
    await slider.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, "1.50");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(150);
    const newWeight = await slider.inputValue();
    L(`  edited first card; weight now ${newWeight}`);
    await shot(page, "06-edited");

    // 6. Add Criterion (manual).
    L("STEP 6 — Add Criterion");
    await page.getByRole("button", { name: /\+ Add Criterion/ }).click();
    await page.waitForTimeout(200);
    const cards2 = await page.locator(".criterion-card").count();
    const manualBadges = await page.locator(".badge-manual").count();
    L(`  cards now ${cards2}, manual badges: ${manualBadges}`);
    // Fill name on the new manual card so save will keep it.
    const lastCard = page.locator(".criterion-card").last();
    await lastCard.locator("input.criterion-name").fill("Communication & writing");
    await lastCard.locator("textarea.criterion-description").fill("Look for clear written communication and writing samples.");
    await shot(page, "07-after-add-manual");

    // 7. Remove one card via × — delete the second card.
    L("STEP 7 — remove a card");
    const before = await page.locator(".criterion-card").count();
    const target = page.locator(".criterion-card").nth(1);
    const targetName = await target.locator("input.criterion-name").inputValue();
    await target.locator('button[title="Remove criterion"]').click();
    await page.waitForTimeout(150);
    const after = await page.locator(".criterion-card").count();
    L(`  removed "${targetName}"; cards: ${before} → ${after}`);
    await shot(page, "08-after-remove");

    // 8. Save Criteria.
    L("STEP 8 — Save Criteria");
    await page.getByRole("button", { name: /^Save Criteria$/ }).click();
    await page.waitForSelector(".status", { timeout: 15000 });
    const status = await page.locator(".status").textContent();
    L(`  status banner: ${JSON.stringify(status)}`);
    await shot(page, "09-after-save");

    // Capture exact saved-state names+weights to verify persistence.
    const savedSnapshot = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".criterion-card")).map((c) => ({
        name: c.querySelector("input.criterion-name").value,
        description: c.querySelector("textarea.criterion-description").value,
        weight: parseFloat(c.querySelector("input.weight-slider").value),
        source: c.querySelector(".badge").textContent.trim(),
      }));
    });
    L(`  saved snapshot: ${JSON.stringify(savedSnapshot.map((c) => ({ n: c.name, w: c.weight, s: c.source })))}`);

    // 9. Refresh — edits persist, drafts gone, deleted stays deleted.
    L("STEP 9 — refresh and check persistence");
    await page.reload();
    await page.waitForSelector(".criterion-card");
    const reloaded = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".criterion-card")).map((c) => ({
        name: c.querySelector("input.criterion-name").value,
        description: c.querySelector("textarea.criterion-description").value,
        weight: parseFloat(c.querySelector("input.weight-slider").value),
        source: c.querySelector(".badge").textContent.trim(),
      }));
    });
    L(`  reloaded count: ${reloaded.length}`);
    const matches = JSON.stringify(reloaded) === JSON.stringify(savedSnapshot);
    L(`  reloaded === saved snapshot: ${matches}`);
    if (!matches) {
      L(`  saved:    ${JSON.stringify(savedSnapshot)}`);
      L(`  reloaded: ${JSON.stringify(reloaded)}`);
    }
    await shot(page, "10-after-reload");

    // 10. Click Roles in nav, verify role + count.
    L("STEP 10 — go back to Roles");
    await page.getByRole("link", { name: "Roles" }).click();
    await page.waitForSelector(".role-card");
    const meta = await page.locator(".role-card .role-meta").first().textContent();
    L(`  role meta: ${JSON.stringify(meta)}`);
    await shot(page, "11-roles-list");

    // 11. Delete a role: confirm dialog, role disappears.
    L("STEP 11 — delete role from list");
    page.once("dialog", async (d) => {
      L(`  dialog: "${d.message()}"`);
      await d.accept();
    });
    await page.locator(".role-card .btn-danger").first().click();
    await page.waitForFunction(() => document.querySelectorAll(".role-card").length === 0, { timeout: 5000 }).catch(() => {});
    const remaining = await page.locator(".role-card").count();
    L(`  remaining role cards: ${remaining}`);
    await shot(page, "12-after-delete");
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
    writeFileSync("/tmp/m1-screenshots/log.txt", log.join("\n"));
    await browser.close();
  }
})();
