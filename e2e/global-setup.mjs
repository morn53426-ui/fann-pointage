// Préchauffe le serveur et Chromium avant le premier test : sur Windows (antivirus, Docker en parallèle),
// le premier lancement du navigateur peut dépasser 60 s et faire échouer le tout premier test à tort.
import { chromium } from "@playwright/test";

export default async function globalSetup(config) {
  const base = config.projects[0].use.baseURL;
  const navigateur = await chromium.launch({ timeout: 180_000 });
  try {
    const page = await navigateur.newPage({ locale: "fr-FR" });
    await page.goto(base + "/", { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.getByLabel("Identifiant").waitFor({ timeout: 120_000 });
  } finally {
    await navigateur.close();
  }
}
