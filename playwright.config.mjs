// Tests de bout en bout du navigateur (Playwright) : serveur en mode démonstration, sans PostgreSQL.
import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.E2E_PORT ?? 4187);
export const MOT_DE_PASSE_E2E = "E2E-navigateur-sans-donnees-reelles-2026";

export default defineConfig({
  testDir: "./e2e",
  timeout: process.env.CI ? 60_000 : 120_000,
  globalSetup: "./e2e/global-setup.mjs",
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: "fr-FR", actionTimeout: 30_000, navigationTimeout: 60_000, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --experimental-strip-types src/api/main.ts",
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      FANN_MODE: "demo", HOST: "127.0.0.1", PORT: String(PORT),
      DEMO_MOT_DE_PASSE: MOT_DE_PASSE_E2E, DATA_DIR: mkdtempSync(join(tmpdir(), "fann-e2e-")),
      ZONE_LAT: "", ZONE_LNG: "",
    },
  },
});
