// L'en-tête et les écrans principaux ne doivent jamais provoquer de défilement horizontal de la page sur téléphone.
import { test, expect } from "@playwright/test";
import { MOT_DE_PASSE_E2E } from "../playwright.config.mjs";

for (const [compte, ecrans] of [["admin", ["#/", "#/tableau", "#/anomalies", "#/absences", "#/rapports", "#/planning", "#/badges", "#/emargement"]], ["agent-n1", ["#/pointage", "#/historique"]]]) {
  for (const largeur of [320, 360, 390, 430, 768, 1024, 1440]) {
    test(`${compte} · ${largeur} px : pas de défilement horizontal`, async ({ page }) => {
      const hauteur = largeur >= 1024 ? 900 : largeur >= 768 ? 1024 : 740;
      await page.setViewportSize({ width: largeur, height: hauteur });
      await page.goto("/");
      await page.getByLabel("Identifiant").fill(compte);
      await page.getByLabel("Mot de passe").fill(MOT_DE_PASSE_E2E);
      await page.getByRole("button", { name: "Se connecter" }).click();
      await expect(page.locator("#deconnexion")).toBeVisible();
      for (const ecran of ecrans) {
        await page.goto("/" + ecran);
        await expect(page.locator("h1").first(), `titre de la vue ${ecran}`).toBeVisible();
        await page.waitForTimeout(600);
        const mesure = await page.evaluate(() => {
          const viewport = document.documentElement.clientWidth;
          const elements = [...document.body.querySelectorAll("*")].map((el) => {
            const r = el.getBoundingClientRect();
            const css = getComputedStyle(el);
            return {
              tag: el.tagName.toLowerCase(),
              id: el.id || "",
              className: typeof el.className === "string" ? el.className.slice(0, 100) : "",
              texte: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 55),
              left: Math.round(r.left * 10) / 10,
              right: Math.round(r.right * 10) / 10,
              width: Math.round(r.width * 10) / 10,
              overflowX: css.overflowX,
              scrollWidth: el.scrollWidth,
              clientWidth: el.clientWidth,
            };
          }).filter((x) => x.right > viewport + 1 && !["auto", "scroll"].includes(x.overflowX))
            .sort((a, b) => b.right - a.right).slice(0, 12);
          return {
            viewport,
            documentClientWidth: document.documentElement.clientWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            elements,
          };
        });
        expect(mesure.documentScrollWidth - mesure.documentClientWidth, `écran ${ecran} : ${JSON.stringify(mesure)}`).toBeLessThanOrEqual(0);
      }
      const bouton = await page.locator("#deconnexion").boundingBox();
      expect(bouton.x, "bouton Déconnexion à gauche du bord droit").toBeGreaterThanOrEqual(0);
      expect(bouton.x + bouton.width, "bouton Déconnexion dans la largeur de l'écran").toBeLessThanOrEqual(largeur);
    });
  }
}
