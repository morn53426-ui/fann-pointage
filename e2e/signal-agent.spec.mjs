// Écran « Pointage » du téléphone de l'agent : bip/vibration au résultat, notification seulement en arrière-plan.
import { test, expect } from "@playwright/test";
import { MOT_DE_PASSE_E2E } from "../playwright.config.mjs";

test.use({ permissions: ["geolocation", "notifications"], geolocation: { latitude: 14.69, longitude: -17.46 } });

test("pointage agent : vibration au résultat, pas de notification système au premier plan", async ({ page }) => {
  await page.addInitScript(() => {
    window.__vibrations = [];
    window.__notifications = [];
    navigator.vibrate = (p) => { window.__vibrations.push(p); return true; };
    const Native = window.Notification;
    class Espion { constructor(titre, options) { window.__notifications.push({ titre, options }); } }
    Espion.permission = "granted";
    Espion.requestPermission = () => Promise.resolve("granted");
    window.Notification = Native ? Object.assign(Espion, {}) : Espion;
    // Pas de service worker pendant ce test : la notification passerait par le constructeur espionné.
    Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true });
  });
  await page.route("**/api/pointage", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ confirme: true, validation: "accepte", type: "arrivee", message: "Arrivée enregistrée.", serverTs: new Date().toISOString() }),
  }));

  await page.goto("/");
  await page.getByLabel("Identifiant").fill("agent-n1");
  await page.getByLabel("Mot de passe").fill(MOT_DE_PASSE_E2E);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator("#deconnexion")).toBeVisible();

  await page.goto("/#/pointage");
  await expect(page.getByRole("heading", { name: "Pointage", exact: true })).toBeVisible();
  await expect(page.locator("#son-pointage")).toBeChecked();

  await page.locator("#moyen-pointage").selectOption("matricule");
  await page.locator("#qr").fill("FANN-004");
  await page.getByRole("button", { name: "Pointer maintenant" }).click();
  await expect(page.getByText("Arrivée enregistrée.")).toBeVisible();

  const etat = await page.evaluate(() => ({ vibrations: window.__vibrations, notifications: window.__notifications }));
  expect(etat.vibrations).toContainEqual([80]);
  expect(etat.notifications).toEqual([]);
});

test("pointage agent : le son peut être coupé et le réglage est mémorisé", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("agent-n1");
  await page.getByLabel("Mot de passe").fill(MOT_DE_PASSE_E2E);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator("#deconnexion")).toBeVisible();
  await page.goto("/#/pointage");
  await page.locator("#son-pointage").uncheck();
  await page.reload();
  await expect(page.locator("#son-pointage")).not.toBeChecked();
});
