import { expect, test, type Page } from "@playwright/test";

/**
 * Layer 2 of the responsive test strategy (UI-SPEC 5.5): the assertions that
 * need a real layout engine.
 *
 * The load-bearing one is "no page-level horizontal scroll". It is a single
 * cheap check that catches most of what actually goes wrong on a phone — a
 * fixed width, an unbreakable string, a menu anchored off the right edge —
 * without anyone having to predict which component will break.
 *
 * Card-internal horizontal scroll is a separate matter and stays allowed. A
 * table that scrolls sideways is doing its job; flattening it into stacked
 * key/value pairs would destroy the comparison those card kinds exist for. So
 * the overflow scan walks up from each offender and forgives anything already
 * inside a scroll container.
 */

const PANELS = [
  { path: "/", name: "overview" },
  { path: "/cards", name: "agent cards" },
  { path: "/agent-ui", name: "agent surfaces" },
  { path: "/skills", name: "skills" },
  { path: "/tools", name: "tools" },
  { path: "/requests", name: "wire requests" },
  { path: "/app-state", name: "app state" },
  { path: "/run", name: "run" },
];

/** Elements sticking out past the viewport that no scroll container explains. */
async function overflowingElements(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const out: { selector: string; right: number; width: number }[] = [];

    const scrolls = (el: Element) => {
      const o = getComputedStyle(el);
      return /auto|scroll|hidden/.test(o.overflowX) || /auto|scroll|hidden/.test(o.overflow);
    };

    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= limit + 1) continue;

      // Forgiven if any ancestor can scroll it — that is card-internal
      // overflow, which the spec allows.
      let excused = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (scrolls(p)) {
          excused = true;
          break;
        }
      }
      if (excused) continue;

      const id = el.id ? `#${el.id}` : "";
      const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
      out.push({ selector: `${el.tagName.toLowerCase()}${id}${cls}`, right: Math.round(rect.right), width: Math.round(rect.width) });
    }
    return { limit, out: out.slice(0, 12) };
  });
}

async function settle(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  // Entrance animations move boxes; measuring mid-flight produces flakes.
  await page.waitForTimeout(400);
}

for (const panel of PANELS) {
  test(`${panel.name} — no page-level horizontal overflow`, async ({ page }) => {
    await settle(page, panel.path);

    const { limit, out } = await overflowingElements(page);
    expect(out, `elements past ${limit}px: ${JSON.stringify(out, null, 2)}`).toEqual([]);

    const scrollable = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(scrollable, "the page itself must not scroll sideways").toBeLessThanOrEqual(1);
  });
}

test("P0 — a phone can hold a conversation", async ({ page }) => {
  // The floor the whole plan was scoped against: type, send, see the exchange.
  await settle(page, "/run");

  const input = page.locator(".sc-composer__input");
  await expect(input).toBeVisible();

  await input.fill("Where are we losing people in the signup funnel?");
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.locator(".sc-msg--user")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".sc-msg--assistant").first()).toBeVisible({ timeout: 30_000 });

  // A reply that renders off-screen has not been delivered.
  const { out } = await overflowingElements(page);
  expect(out, `reply overflowed: ${JSON.stringify(out, null, 2)}`).toEqual([]);
});

test("P0 — the composer clears Safari's zoom threshold", async ({ page }) => {
  await settle(page, "/run");
  const size = await page
    .locator(".sc-composer__input")
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  // Under 16px, Safari zooms in on focus and never zooms back out.
  expect(size).toBeGreaterThanOrEqual(16);
});

test("composer controls meet the 44px touch target", async ({ page }, testInfo) => {
  await settle(page, "/agent-ui");

  // The painted control stays small by design; the target is carried by a
  // transparent ::after, so measure the pseudo-element rather than the button.
  const targets = await page.evaluate(() => {
    const sels = [".sc-ai__icon", ".sc-ai__send", ".sc-ai__model", ".sc-ai__enhance"];
    const out: { sel: string; w: number; h: number }[] = [];
    for (const sel of sels) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const after = getComputedStyle(el, "::after");
        const w = parseFloat(after.width);
        const h = parseFloat(after.height);
        if (Number.isNaN(w) || Number.isNaN(h)) continue;
        out.push({ sel, w, h });
      }
    }
    return out;
  });

  expect(targets.length, "expected composer controls on this panel").toBeGreaterThan(0);
  for (const t of targets) {
    expect(t.w, `${t.sel} hit area width (${testInfo.project.name})`).toBeGreaterThanOrEqual(44);
    expect(t.h, `${t.sel} hit area height (${testInfo.project.name})`).toBeGreaterThanOrEqual(44);
  }
});

test("composer menus open inside the viewport", async ({ page }) => {
  await settle(page, "/agent-ui");

  const attach = page.locator(".sc-ai__icon").first();
  await attach.click();

  const menu = page.locator(".sc-ai__menu").first();
  await expect(menu).toBeVisible();

  const within = async (loc: ReturnType<Page["locator"]>) => {
    const box = await loc.boundingBox();
    const width = page.viewportSize()!.width;
    expect(box, "menu must have a box").not.toBeNull();
    expect(box!.x, "menu left edge off-screen").toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width, "menu right edge off-screen").toBeLessThanOrEqual(width + 1);
  };
  await within(menu);

  // The submenu used to open sideways at left:100%+4 with a 170px floor: on a
  // 360px screen that lands past the edge every time. Compact makes it an
  // indented group inside the parent menu instead.
  const skills = page.locator(".sc-ai__submenuwrap .sc-ai__menuitem").first();
  if (await skills.isVisible().catch(() => false)) {
    await skills.click();
    const sub = page.locator(".sc-ai__submenu").first();
    if (await sub.isVisible().catch(() => false)) await within(sub);
  }
});

test("cards compact on their own width, not the window's", async ({ page }) => {
  await settle(page, "/cards");

  // .sc-card is a query container, so this holds whether the card sits in a
  // narrow thread or standalone in this panel with no thread above it.
  const cards = await page.evaluate(() => {
    const out: { w: number; padding: string }[] = [];
    for (const el of Array.from(document.querySelectorAll(".sc-card")).slice(0, 40)) {
      const r = el.getBoundingClientRect();
      out.push({ w: Math.round(r.width), padding: getComputedStyle(el).paddingLeft });
    }
    return out;
  });

  expect(cards.length).toBeGreaterThan(0);
  for (const c of cards) {
    if (c.w <= 600) expect(c.padding, `card at ${c.w}px should use compact padding`).toBe("12px");
  }
});
