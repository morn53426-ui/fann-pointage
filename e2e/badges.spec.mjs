import { test, expect } from "@playwright/test";
import { MOT_DE_PASSE_E2E } from "../playwright.config.mjs";

async function ouvrirBadges(page) {
  await page.goto("/");
  await page.getByLabel("Identifiant").fill("admin");
  await page.getByLabel("Mot de passe").fill(MOT_DE_PASSE_E2E);
  await page.getByRole("button", { name: "Se connecter" }).click();
  const erreursJavascript = [];
  const releverErreur = (erreur) => erreursJavascript.push(erreur.message);
  page.on("pageerror", releverErreur);
  await page.goto("/#/badges");
  await expect(page.getByRole("heading", { name: /Atelier de badges/ })).toBeVisible();
  await expect(page.locator(".badge-imprimable").first()).toBeVisible();
  expect(erreursJavascript, "la vue des badges ne doit pas échouer au rendu").toEqual([]);
  page.off("pageerror", releverErreur);
}

test.describe("Badges professionnels", () => {
  test("recto et verso respectent le format CR80 (86 × 54 mm) et se chargent", async ({ page }) => {
    await ouvrirBadges(page);
    const carte = page.locator(".badge-imprimable").first();
    for (const face of [carte.locator(".badge-recto"), carte.locator(".badge-verso")]) {
      const b = await face.boundingBox();
      expect(b.width / b.height).toBeGreaterThan(86 / 54 - 0.03);
      expect(b.width / b.height).toBeLessThan(86 / 54 + 0.03);
    }
    await expect(carte.locator(".badge-recto-entete img")).toHaveJSProperty("complete", true);
    await expect.poll(() => carte.locator(".badge-qr-verso").evaluate((i) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(carte.locator(".badge-recto")).toContainText("CENTRE HOSPITALIER NATIONAL UNIVERSITAIRE DE FANN");
    await expect(carte.locator(".badge-recto-pied")).toContainText("AVEC SENDIMBEUL SARL");
    await expect(carte.locator(".badge-verso")).toContainText("Badge personnel et non transférable");
  });

  test("le QR est carré et occupe au moins 20 % de la largeur du verso", async ({ page }) => {
    await ouvrirBadges(page);
    const face = await page.locator(".badge-verso").first().boundingBox();
    const qr = await page.locator(".badge-qr-verso").first().boundingBox();
    expect(qr.width / face.width).toBeGreaterThan(0.2);
    expect(Math.abs(qr.width - qr.height)).toBeLessThan(2);
  });

  test("le QR imprimé garde sa taille, son noir/blanc pur et sa marge blanche de 4 modules", async ({ page }) => {
    await ouvrirBadges(page);
    const qr = page.locator(".badge-qr-verso").first();
    const face = await page.locator(".badge-verso").first().boundingBox();
    const box = await qr.boundingBox();
    const svg = await qr.evaluate((img) => decodeURIComponent(img.getAttribute("src").split(",", 2)[1]));
    expect(box.width / face.width).toBeGreaterThan(0.2);
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    expect(svg).toContain('fill="#000000"');
    expect(svg).toContain('fill="#ffffff"');
    // Le premier module noir commence en (4,4) : la marge blanche est bien de 4 modules.
    expect(svg).toContain('shape-rendering="crispEdges"');
    const premierModuleNoir = svg.match(/<path d="M(\d+),(\d+)/);
    expect(premierModuleNoir?.slice(1)).toEqual(["4", "4"]);
    expect(await qr.evaluate((img) => getComputedStyle(img).backgroundColor)).toBe("rgb(255, 255, 255)");
  });

  test("aucun texte ne déborde de la carte (aperçu)", async ({ page }) => {
    await ouvrirBadges(page);
    const debordements = await page.evaluate(() => [...document.querySelectorAll(".badge-visuel")].slice(0, 30).flatMap((face) => {
      const f = face.getBoundingClientRect();
      return [...face.querySelectorAll("strong, span, small, .badge-nom, .badge-prenom")].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.right > f.right + 1 || r.bottom > f.bottom + 1 || r.left < f.left - 1);
      }).map((e) => e.textContent);
    }));
    expect(debordements).toEqual([]);
  });

  test("sélection d'un badge : compteur et contour de sélection", async ({ page }) => {
    await ouvrirBadges(page);
    const carte = page.locator(".badge-imprimable").first();
    await carte.getByRole("checkbox").check();
    await expect(carte).toHaveClass(/selectionnee/);
    await expect(page.locator(".compteur-selection")).toContainText("1 badge(s) sélectionné(s)");
  });

  test("impression : feuille A4 avec faces de 86 × 54 mm, recto puis verso", async ({ page }) => {
    await ouvrirBadges(page);
    await page.locator(".badge-imprimable").first().getByRole("checkbox").check();
    await page.evaluate(() => { window.print = () => {}; });
    await page.getByRole("button", { name: /Imprimer les badges/ }).click();
    await page.emulateMedia({ media: "print" });
    const dims = await page.evaluate(() => {
      const mm = (px) => px * 25.4 / 96;
      const r = document.querySelector(".feuille-recto .badge-visuel").getBoundingClientRect();
      return { l: mm(r.width), h: mm(r.height), feuilles: document.querySelectorAll(".feuille-badges").length };
    });
    expect(Math.abs(dims.l - 86)).toBeLessThan(0.6);
    expect(Math.abs(dims.h - 54)).toBeLessThan(0.6);
    expect(dims.feuilles).toBe(2);
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    expect(pdf.length).toBeGreaterThan(5_000);
  });

  test("impression recto-verso : un badge seul est décalé dans la colonne droite du verso", async ({ page }) => {
    await ouvrirBadges(page);
    await page.locator(".badge-imprimable").first().getByRole("checkbox").check();
    await page.evaluate(() => { window.print = () => {}; });
    await page.getByRole("button", { name: /Imprimer les badges/ }).click();
    const slotsVerso = page.locator(".feuille-verso .badge-print-face");
    await expect(slotsVerso).toHaveCount(2);
    await expect(slotsVerso.nth(0)).toHaveClass(/badge-print-face-vide/);
    await expect(slotsVerso.nth(0).locator(".badge-visuel")).toHaveCount(0);
    await expect(slotsVerso.nth(1).locator(".badge-verso")).toHaveCount(1);
    await page.emulateMedia({ media: "print" });
    const positions = await slotsVerso.evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, vide: e.classList.contains("badge-print-face-vide") };
    }));
    expect(positions[0].y).toBeCloseTo(positions[1].y, 1);
    expect(positions[1].x).toBeGreaterThan(positions[0].x);
  });

  test("impression : aucun texte du badge n'est plus petit que 6 pt", async ({ page }) => {
    await ouvrirBadges(page);
    await page.locator(".badge-imprimable").first().getByRole("checkbox").check();
    await page.evaluate(() => { window.print = () => {}; });
    await page.getByRole("button", { name: /Imprimer les badges/ }).click();
    await page.emulateMedia({ media: "print" });
    const petits = await page.evaluate(() => [...document.querySelectorAll(".feuille-badges .badge-visuel *")]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((e) => ({ texte: e.textContent.trim().slice(0, 30), pt: parseFloat(getComputedStyle(e).fontSize) * 0.75 }))
      .filter((x) => x.pt < 6 && !/DÉMONSTRATION/.test(x.texte)));
    expect(petits).toEqual([]);
  });

  for (const [nom, largeur, hauteur] of [["bureau", 1440, 900], ["ordinateur portable", 1024, 768], ["tablette", 768, 1024], ["mobile large", 430, 932], ["mobile", 390, 844], ["mobile étroit", 360, 800], ["petit mobile", 320, 568]]) {
    test(`responsive ${nom} : pas de défilement horizontal`, async ({ page }, info) => {
      await page.setViewportSize({ width: largeur, height: hauteur });
      await ouvrirBadges(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await info.attach(`badges-${largeur}`, { body: await page.locator(".badge-imprimable").first().screenshot(), contentType: "image/png" });
    });
  }
});

test.describe("Badge : profession, pied de page et verso modifiable", () => {
  test("recto : profession à la place du service, pied de page « AVEC SENDIMBEUL SARL »", async ({ page }) => {
    await ouvrirBadges(page);
    const carte = page.locator(".badge-imprimable").first();
    await expect(carte.locator(".badge-recto .badge-profession")).toHaveText(/\S/);
    await expect(carte.locator(".badge-recto .badge-profession")).toHaveText("BRANCARDIER".toLowerCase().replace(/^./, "B"), { ignoreCase: true });
    await expect(carte.locator(".badge-recto .badge-service")).toHaveCount(0);
    await expect(carte.locator(".badge-recto-pied")).toContainText("AVEC SENDIMBEUL SARL");
    await expect(carte.locator(".badge-recto-pied")).not.toContainText(/^BRANCARDIER/);
  });

  // Crée un vrai agent par le formulaire (photo PNG 1×1 recadrée par l'application) : les badges de démonstration ne sont pas modifiables.
  async function creerAgentReel(page, nom) {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
    await page.getByLabel("Prénom", { exact: true }).fill("Awa");
    await page.getByLabel("Nom", { exact: true }).fill(nom);
    await page.getByLabel(/^Profession/).first().fill("Superviseur");
    await page.getByLabel(/^Téléphone/).first().fill("33 821 00 00");
    await page.getByLabel(/^Adresse/).first().fill("Fann Résidence, Dakar");
    await page.locator("#nouveau-service").selectOption("__nouveau__");
    await page.locator("#nouveau-service-nom").fill("Service essai badge");
    await page.locator("#nouveau-photo").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
    await expect(page.locator("#aide-photo-badge")).toContainText("Photo prête");
    await page.getByRole("button", { name: "Créer la fiche et le badge" }).click();
    // En mode démo, le code du badge est créé avec la fiche : aucune seconde émission PostgreSQL ne doit être tentée.
    await expect(page.locator(".form-creation-badge .etat.ok")).toContainText("stockage de démonstration");
    await expect(page.locator(".form-creation-badge .etat.attention")).toHaveCount(0);
    const carte = page.locator(".badge-imprimable").filter({
      has: page.locator(".badge-recto .badge-nom").filter({ hasText: new RegExp("^" + nom.toUpperCase() + "$") }),
    }).first();
    await expect(carte).toBeVisible();
    return carte;
  }

  test("création : profession, adresse et téléphone saisis apparaissent au recto et au verso", async ({ page }, info) => {
    await ouvrirBadges(page);
    const carte = await creerAgentReel(page, "Creation");
    await expect(carte.locator(".badge-recto .badge-profession")).toHaveText("Superviseur", { ignoreCase: true });
    await expect(carte.locator(".badge-verso .badge-champ-adresse dd")).toHaveText("Fann Résidence, Dakar");
    await expect(carte.locator(".badge-verso .badge-champ-telephone dd")).toHaveText("33 821 00 00");
    await expect(carte.locator(".badge-verso .badge-champ-nom dd")).toHaveText("CREATION");
    await info.attach("badge-cree", { body: await carte.screenshot(), contentType: "image/png" });
  });

  test("verso : nom, prénom, adresse, téléphone et QR côte à côte ; tout se modifie avec aperçu en direct", async ({ page }, info) => {
    await ouvrirBadges(page);
    const carte = await creerAgentReel(page, "Edition");
    await carte.getByRole("button", { name: "Modifier le badge" }).click();
    const dialogue = page.locator("dialog.dialogue-badge");
    await expect(dialogue).toBeVisible();
    await dialogue.getByLabel(/^Profession/).fill("Chef brancardier");
    await dialogue.getByLabel(/^Adresse/).fill("Médina, rue 11 x 6, Dakar");
    await dialogue.getByLabel(/^Téléphone/).fill("+221 77 000 00 00");
    const apercu = dialogue.locator(".badge-editeur-apercu");
    await expect(apercu.locator(".badge-profession")).toHaveText("Chef brancardier", { ignoreCase: true });
    await expect(apercu.locator(".badge-champ-adresse dd")).toHaveText("Médina, rue 11 x 6, Dakar");
    await expect(apercu.locator(".badge-champ-telephone dd")).toHaveText("+221 77 000 00 00");
    // Le QR est à côté du texte (à droite) et ne le chevauche pas.
    const qr = await apercu.locator(".badge-qr-verso").boundingBox();
    const texte = await apercu.locator(".badge-verso-identite").boundingBox();
    expect(qr.x).toBeGreaterThanOrEqual(texte.x + texte.width - 1);
    await info.attach("editeur", { body: await dialogue.screenshot(), contentType: "image/png" });
    await dialogue.getByRole("button", { name: "Enregistrer les modifications" }).click();
    await expect(dialogue).toHaveCount(0);
    // Après rechargement des données : les valeurs viennent du serveur.
    const modifie = page.locator(".badge-imprimable", { hasText: "EDITION" }).first();
    await expect(modifie.locator(".badge-recto .badge-profession")).toHaveText("Chef brancardier", { ignoreCase: true });
    await expect(modifie.locator(".badge-verso .badge-champ-telephone dd")).toHaveText("+221 77 000 00 00");
    await expect(modifie.locator(".badge-verso .badge-champ-adresse dd")).toHaveText("Médina, rue 11 x 6, Dakar");
    await info.attach("badge-modifie", { body: await modifie.screenshot(), contentType: "image/png" });
  });

  test("téléphone invalide refusé par le formulaire", async ({ page }) => {
    await ouvrirBadges(page);
    const carte = await creerAgentReel(page, "Invalide");
    await carte.getByRole("button", { name: "Modifier le badge" }).click();
    const dialogue = page.locator("dialog.dialogue-badge");
    await dialogue.getByLabel(/^Téléphone/).fill("abc");
    await dialogue.getByRole("button", { name: "Enregistrer les modifications" }).click();
    await expect(dialogue).toBeVisible();
    expect(await dialogue.getByLabel(/^Téléphone/).evaluate((i) => i.validity.patternMismatch)).toBe(true);
  });

  test("impression : le verso imprimé contient les champs et respecte 6 pt minimum", async ({ page }) => {
    await ouvrirBadges(page);
    const carte = await creerAgentReel(page, "Impression");
    await carte.getByRole("checkbox").check();
    await page.evaluate(() => { window.print = () => {}; });
    await page.getByRole("button", { name: /Imprimer les badges/ }).click();
    await page.emulateMedia({ media: "print" });
    const verso = page.locator(".feuille-verso .badge-verso").filter({
      has: page.locator(".badge-champ-nom dd").filter({ hasText: /^IMPRESSION$/ }),
    }).first();
    await expect(verso.locator(".badge-champ-telephone dd")).toHaveText("33 821 00 00");
    const petits = await page.evaluate(() => [...document.querySelectorAll(".feuille-badges .badge-visuel *")]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .map((e) => ({ texte: e.textContent.trim().slice(0, 30), pt: parseFloat(getComputedStyle(e).fontSize) * 0.75 }))
      .filter((x) => x.pt < 6 && !/DÉMONSTRATION/.test(x.texte)));
    expect(petits).toEqual([]);
  });
});

test.describe("Badge : design moderne et filigrane du logo", () => {
  test("le filigrane du logo CHNUF est présent, chargé et discret sur le recto et le verso", async ({ page }) => {
    await ouvrirBadges(page);
    const carte = page.locator(".badge-imprimable").first();
    for (const face of [".badge-recto", ".badge-verso"]) {
      const img = carte.locator(`${face} img.badge-filigrane`);
      await expect(img).toHaveCount(1);
      await expect(img).toHaveAttribute("aria-hidden", "true");
      await expect.poll(() => img.evaluate((i) => i.complete && i.naturalWidth >= 600)).toBe(true);
      const opacite = await img.evaluate((i) => parseFloat(getComputedStyle(i).opacity));
      expect(opacite).toBeGreaterThan(0.04);
      expect(opacite).toBeLessThan(0.16);
    }
  });

  test("impression PDF : exactement 2 pages (recto puis verso), sans bannière de démonstration ni page blanche", async ({ page }) => {
    await ouvrirBadges(page);
    await page.locator(".badge-imprimable").first().getByRole("checkbox").check();
    await page.evaluate(() => { window.print = () => {}; });
    await page.getByRole("button", { name: /Imprimer les badges/ }).click();
    await page.emulateMedia({ media: "print" });
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    expect(await page.locator(".banniere-demo").isVisible()).toBe(false);
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    expect(pages).toBe(2);
  });
});
