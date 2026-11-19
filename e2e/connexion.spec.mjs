import { test, expect } from "@playwright/test";
import { MOT_DE_PASSE_E2E } from "../playwright.config.mjs";

const TAILLES = [
  { nom: "grand écran", largeur: 1920, hauteur: 1080 },
  { nom: "ordinateur", largeur: 1440, hauteur: 900 },
  { nom: "portable", largeur: 1024, hauteur: 768 },
  { nom: "tablette portrait", largeur: 768, hauteur: 1024 },
  { nom: "mobile", largeur: 390, hauteur: 844 },
  { nom: "petit mobile", largeur: 360, hauteur: 640 },
  { nom: "très petit mobile", largeur: 320, hauteur: 568 },
];

const ouvrir = async (page) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  // Attendre la fin des animations d'entrée avant toute mesure de position.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
};

test.describe("Page de connexion — affiche et formulaire", () => {
  test("l'affiche FANN POINTAGE est chargée, nette et décrite", async ({ page }) => {
    await ouvrir(page);
    const affiche = page.locator(".connexion-visuel img");
    await expect(affiche).toBeVisible();
    await expect(affiche).toHaveAttribute("alt", /FANN POINTAGE/);
    await expect.poll(() => affiche.evaluate((i) => i.complete && i.naturalWidth)).toBe(1672);
  });

  test("le formulaire est accessible par ses libellés et le focus est sur l'identifiant", async ({ page }) => {
    await ouvrir(page);
    await expect(page.getByLabel("Identifiant")).toBeFocused();
    await expect(page.getByLabel("Mot de passe")).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeEnabled();
  });

  test("le bouton Afficher/Masquer révèle puis cache le mot de passe", async ({ page }) => {
    await ouvrir(page);
    const mdp = page.getByLabel("Mot de passe");
    const bouton = page.locator(".connexion-voir");
    await mdp.fill("secret");
    await bouton.click();
    await expect(mdp).toHaveAttribute("type", "text");
    await expect(bouton).toHaveAttribute("aria-pressed", "true");
    await bouton.click();
    await expect(mdp).toHaveAttribute("type", "password");
  });

  test("identifiants invalides : message d'erreur et pas de session", async ({ page }) => {
    await ouvrir(page);
    await page.getByLabel("Identifiant").fill("admin");
    await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByRole("alert")).toHaveText("Identifiants invalides.");
    expect(await page.evaluate(() => sessionStorage.getItem("jeton"))).toBeNull();
  });

  test("connexion administrateur réussie puis déconnexion", async ({ page }) => {
    await ouvrir(page);
    await page.getByLabel("Identifiant").fill("admin");
    await page.getByLabel("Mot de passe").fill(MOT_DE_PASSE_E2E);
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByRole("navigation", { name: "Navigation principale" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Déconnexion" })).toBeVisible();
    await page.getByRole("button", { name: "Déconnexion" }).click();
    await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
  });

  test("serveur injoignable : message réseau, pas de plantage", async ({ page }) => {
    await ouvrir(page);
    await page.route("**/api/connexion", (r) => r.abort("connectionrefused"));
    await page.getByLabel("Identifiant").fill("admin");
    await page.getByLabel("Mot de passe").fill("x");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByRole("alert")).toContainText("Connexion impossible");
  });
});

test.describe("Page de connexion — responsive", () => {
  for (const t of TAILLES) {
    test(`${t.nom} (${t.largeur}×${t.hauteur})`, async ({ page }, info) => {
      await page.setViewportSize({ width: t.largeur, height: t.hauteur });
      await ouvrir(page);
      const affiche = await page.locator(".connexion-visuel").boundingBox();
      const form = await page.locator(".connexion-formulaire").boundingBox();
      const img = await page.locator(".connexion-visuel img").boundingBox();

      // Aucun défilement horizontal.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      // Tout reste dans la fenêtre.
      for (const b of [affiche, form]) {
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(t.largeur + 1);
      }
      // L'affiche n'est jamais rognée ni déformée (ratio 16:9).
      expect(img.width / img.height).toBeGreaterThan(1.72);
      expect(img.width / img.height).toBeLessThan(1.83);

      if (t.largeur > 760) {
        // Affiche exactement à gauche du formulaire, sur la même ligne.
        expect(affiche.x + affiche.width).toBeLessThanOrEqual(form.x);
        expect(Math.abs((affiche.y + affiche.height / 2) - (form.y + form.height / 2))).toBeLessThan(40);
        expect(affiche.width).toBeGreaterThan(form.width);
      } else {
        // Petit écran : affiche au-dessus, pleine largeur.
        expect(affiche.y + affiche.height).toBeLessThanOrEqual(form.y);
        expect(affiche.width).toBeGreaterThan(t.largeur * 0.85);
      }
      // Cibles tactiles >= 44 px.
      for (const loc of [page.getByLabel("Identifiant"), page.getByLabel("Mot de passe"), page.getByRole("button", { name: "Se connecter" })]) {
        expect((await loc.boundingBox()).height).toBeGreaterThanOrEqual(44);
      }
      await info.attach(`connexion-${t.largeur}x${t.hauteur}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    });
  }

  test("zoom 200 % : le formulaire reste utilisable sans défilement horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 }); // équivaut à 1280 px à 200 %
    await ouvrir(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Se connecter" }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "Se connecter" })).toBeInViewport();
  });
});
