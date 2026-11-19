import { test, expect } from "@playwright/test";
import { MOT_DE_PASSE_E2E } from "../playwright.config.mjs";

test("mode serveur inconnu : ne jamais restaurer un profil administrateur périmé", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Mot de passe").fill(MOT_DE_PASSE_E2E);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator("#deconnexion")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("fann-pointage-moi-cache"))).not.toBeNull();

  await page.route("**/healthz", (route) => route.abort("failed"));
  await page.route("**/api/moi", (route) => route.abort("failed"));
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Connexion", exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Le serveur n’a pas pu confirmer votre session" })
  ).toBeVisible();
  const session = await page.evaluate(() => ({
    jeton: sessionStorage.getItem("jeton"),
    profil: localStorage.getItem("fann-pointage-moi-cache"),
  }));
  expect(session).toEqual({ jeton: null, profil: null });
});
