// L'en-tête et les écrans principaux ne doivent jamais provoquer de défilement horizontal de la page sur téléphone.
import { test, expect } from "@playwright/test";
import { MOT_DE_PASSE_E2E } from "../playwright.config.mjs";

for (const [compte, ecrans] of [["admin", ["#/", "#/anomalies", "#/badges"]], ["agent-n1", ["#/pointage"]]]) {
  for (const largeur of [320, 390]) {
    test(`${compte} · ${largeur} px : pas de défilement horizontal`, async ({ page }) => {
      await page.setViewportSize({ width: largeur, height: 740 });
      await page.goto("/");
      await page.getByLabel("Identifiant").fill(compte);
      await page.getByLabel("Mot de passe").fill(MOT_DE_PASSE_E2E);
      await page.getByRole("button", { name: "Se connecter" }).click();
      await expect(page.locator("#deconnexion")).toBeVisible();
      for (const ecran of ecrans) {
        await page.goto("/" + ecran);
        await page.waitForTimeout(600);
        const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(debordement, `écran ${ecran}`).toBeLessThanOrEqual(0);
      }
      const bouton = await page.locator("#deconnexion").boundingBox();
      expect(bouton.x, "bouton Déconnexion à gauche du bord droit").toBeGreaterThanOrEqual(0);
      expect(bouton.x + bouton.width, "bouton Déconnexion dans la largeur de l'écran").toBeLessThanOrEqual(largeur);
    });
  }
}
