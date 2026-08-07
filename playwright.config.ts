import { defineConfig, devices } from "@playwright/test";

/**
 * Layer 2 of the responsive test strategy (UI-SPEC 5.5).
 *
 * This exists because layer 1 cannot measure anything. jsdom has no layout
 * engine — every box it reports is 0x0 — so "does this overflow at 360px" is
 * only answerable in a browser that actually lays the page out.
 *
 * @playwright/test is a ROOT devDependency and stays out of packages/ui.
 * Principle 1's zero-dependency rule is about what a host installs when it
 * consumes the kit ("drops into any app without imposing a build step"); a
 * test runner is never in that graph.
 *
 * The playground runs in demo mode with no API key — the scripted transport
 * fakes the network at the Transport seam, so the send-a-message check below
 * exercises the real runtime rather than a mock.
 */

const PORT = 3311;

// This environment ships Chromium at a pinned build that will not match
// whatever revision the installed @playwright/test wants, and re-downloading
// browsers here is not an option. Pointing at the provided binary keeps the
// runner working across that mismatch; unset the variable and Playwright falls
// back to its own managed download, which is what a normal CI would do.
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

// All three run on Chromium, which is the only engine available here. The
// named iPhone/iPad descriptors are deliberately NOT used: they carry
// defaultBrowserType "webkit" and would silently try to launch a browser this
// environment does not have. isMobile + hasTouch is what actually drives the
// pointer:coarse and hover:none rules under test, and Chromium honours both.
// Safari-specific behaviour — focus zoom, the dynamic toolbar — is layer 3.
const phone = (width: number, height: number) => ({
  ...devices["Desktop Chrome"],
  viewport: { width, height },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
});

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: { executablePath: CHROMIUM },
  },

  // The three widths in 5.5. 360 is the floor worth supporting, 390 is the
  // phone most people actually hold, 768 is tablet portrait — the width where
  // the medium tier has to prove it is not just the compact tier again.
  projects: [
    { name: "phone-360", use: phone(360, 640) },
    { name: "phone-390", use: phone(390, 844) },
    { name: "tablet-768", use: { ...phone(768, 1024), deviceScaleFactor: 2 } },
  ],

  webServer: {
    command: `pnpm --filter @superchat/playground dev --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
