// Test HTTP réel (serveur sur un port local aléatoire) + contrôles statiques de l'interface web.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import type { AddressInfo } from "node:net";
import { LimiteurTentatives } from "./auth.ts";
import { creerDemo } from "./demo.ts";
import { creerServeur } from "./serveur.ts";

const web = fileURLToPath(new URL("../../web", import.meta.url));
const MDP = "motdepasse-de-test";

async function demarrer(options: { mode?: string; checkReady?: () => Promise<void> } = {}) {
  const { magasin } = creerDemo(new Date("2026-10-12T10:00:00Z"), { motDePasse: MDP });
  const srv = creerServeur({ magasin, limiteur: new LimiteurTentatives(), maintenant: () => magasin.horloge }, web, options);
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { base, fermer: () => new Promise<void>((ok) => { srv.closeAllConnections(); srv.close(() => ok()); }) };
}

test("HTTP : healthcheck Docker minimal, sans information sensible", async () => {
  const s = await demarrer();
  try {
    const reponse = await fetch(`${s.base}/healthz`);
    assert.equal(reponse.status, 200);
    assert.deepEqual(await reponse.json(), { status: "ok", mode: "demo" });
    assert.equal(reponse.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(`${s.base}/healthz`, { method: "POST" })).status, 405);
  } finally { await s.fermer(); }
});


test("HTTP : les sondes /healthz et /readyz acceptent aussi HEAD (supervision, wget --spider)", async () => {
  const s = await demarrer({ mode: "catalogue-postgres", checkReady: async () => {} });
  try {
    for (const chemin of ["/healthz", "/readyz"]) {
      const reponse = await fetch(`${s.base}${chemin}`, { method: "HEAD" });
      assert.equal(reponse.status, 200, chemin);
      assert.equal(await reponse.text(), "", "HEAD ne renvoie pas de corps");
      assert.equal((await fetch(`${s.base}${chemin}`, { method: "DELETE" })).status, 405, chemin);
    }
  } finally { await s.fermer(); }
  const ko = await demarrer({ mode: "catalogue-postgres", checkReady: async () => { throw new Error("base arrêtée"); } });
  try { assert.equal((await fetch(`${ko.base}/readyz`, { method: "HEAD" })).status, 503); } finally { await ko.fermer(); }
});

test("HTTP : les fichiers statiques réutilisent leur ETag, acceptent 304 et HEAD", async () => {
  const s = await demarrer();
  try {
    const first = await fetch(`${s.base}/styles.css`);
    assert.equal(first.status, 200);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    assert.ok(Number(first.headers.get("content-length")) > 0);
    const conditional = await fetch(`${s.base}/styles.css`, { headers: { "If-None-Match": etag! } });
    assert.equal(conditional.status, 304);
    assert.equal(await conditional.text(), "");
    const head = await fetch(`${s.base}/styles.css`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("etag"), etag);
  } finally { await s.fermer(); }
});

test("HTTP : un octet nul dans l'URL donne un 404 simple, sans fausse « erreur 500 » dans le journal", async () => {
  const s = await demarrer();
  const erreurs: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { erreurs.push(a.join(" ")); };
  try {
    const reponse = await fetch(`${s.base}/app.js%00.png`);
    assert.equal(reponse.status, 404);
    assert.deepEqual(erreurs, [], "requête mal formée : aucune erreur interne journalisée");
  } finally { console.error = original; await s.fermer(); }
});

test("HTTP : readiness PostgreSQL renvoie 503 si la base échoue, sans exposer l'erreur", async () => {
  const s = await demarrer({ mode: "catalogue-postgres", checkReady: async () => { throw new Error("mot-de-passe secret SQL"); } });
  try {
    const response = await fetch(`${s.base}/readyz`);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { status: "not_ready", mode: "catalogue-postgres" });
    assert.doesNotMatch(body, /mot-de-passe secret SQL/);
    assert.equal((await fetch(`${s.base}/healthz`)).status, 200);
  } finally { await s.fermer(); }
});

test("HTTP : readiness répond 200 seulement quand le contrôle applicatif réussit", async () => {
  const s = await demarrer({ mode: "catalogue-postgres", checkReady: async () => {} });
  try {
    const response = await fetch(`${s.base}/readyz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ready", mode: "catalogue-postgres" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  } finally { await s.fermer(); }
});

test("HTTP : healthcheck expose le mode de transition configuré sans secret", async () => {
  const s = await demarrer({ mode: "postgres-auth-transition" });
  try {
    const reponse = await fetch(`${s.base}/healthz`);
    assert.equal(reponse.status, 200);
    assert.deepEqual(await reponse.json(), { status: "ok", mode: "postgres-auth-transition" });
    assert.equal(reponse.headers.get("cache-control"), "no-store");
  } finally { await s.fermer(); }
});

test("HTTP : page d'accueil avec en-têtes de sécurité, API protégée, traversée de répertoire bloquée", async () => {
  const s = await demarrer();
  try {
    const home = await fetch(`${s.base}/`);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /FANN POINTAGE/);
    const csp = home.headers.get("content-security-policy") ?? "";
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /img-src 'self' data: blob:/); // aperçus locaux des photos via URL.createObjectURL
    assert.match(csp, /script-src 'self'/); // blob reste interdit pour les scripts
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(`${s.base}/api/moi`)).status, 401);
    assert.equal((await fetch(`${s.base}/..%2fpackage.json`)).status, 404);
    assert.equal((await fetch(`${s.base}/%2e%2e/%2e%2e/etc/passwd`)).status, 404);
    assert.equal((await fetch(`${s.base}/src/api/auth.ts`)).status, 404);   // le code serveur n'est pas servi
  } finally { await s.fermer(); }
});
test("HTTP : accepte les corps PATCH d’agent nécessaires aux photos tout en gardant les autres routes bornées", async () => {
  const s = await demarrer();
  try {
    const grandCorps = JSON.stringify({ prenom: "Test", nom: "Photo", photoDataUrl: "x".repeat(40_000) });
    const patch = await fetch(`${s.base}/api/agents/agent-test`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: grandCorps });
    // Le corps est bien lu (et n’est pas rejeté à 32 Ko) ; la route exige ensuite un compte connecté.
    assert.equal(patch.status, 401);
    const autre = await fetch(`${s.base}/api/connexion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: grandCorps });
    assert.equal(autre.status, 413);
  } finally { await s.fermer(); }
});

test("HTTP : connexion, requête JSON invalide, corps trop grand", async () => {
  const s = await demarrer();
  try {
    const post = (corps: string) => fetch(`${s.base}/api/connexion`, { method: "POST", headers: { "Content-Type": "application/json" }, body: corps });
    assert.equal((await post("{pas du json")).status, 400);
    assert.equal((await post(JSON.stringify({ x: "a".repeat(40_000) }))).status, 413);
    const ok = await post(JSON.stringify({ identifiant: "admin", motDePasse: MDP }));
    assert.equal(ok.status, 200);
    const { jeton } = (await ok.json()) as { jeton: string };
    const moi = await fetch(`${s.base}/api/moi`, { headers: { Authorization: `Bearer ${jeton}` } });
    assert.equal(((await moi.json()) as { role: string }).role, "administrateur");
    assert.equal(moi.headers.get("cache-control"), "no-store");
  } finally { await s.fermer(); }
});

test("interface : fichiers PWA présents, manifeste valide, icônes existantes", () => {
  const manifeste = JSON.parse(readFileSync(`${web}/manifest.webmanifest`, "utf8")) as { icons: { src: string }[]; lang: string; display: string };
  assert.deepEqual([manifeste.lang, manifeste.display], ["fr", "standalone"]);
  for (const i of manifeste.icons) assert.ok(existsSync(`${web}${i.src}`), i.src);
  for (const f of ["index.html", "app.js", "styles.css", "sw.js", "vendor/qrcode.js", "icons/logo-chnuf.png", "images/fann-pointage-publicite.jpg"]) assert.ok(existsSync(`${web}/${f}`), f);
});
test("interface : pas d'injection HTML ni de script en ligne, service worker sans cache d'API", () => {
  const app = readFileSync(`${web}/app.js`, "utf8");
  assert.doesNotMatch(app, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/);
  const html = readFileSync(`${web}/index.html`, "utf8");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)/);      // aucun script en ligne (CSP)
  assert.doesNotMatch(html, /\sstyle=|\sonclick=/);
  assert.match(readFileSync(`${web}/sw.js`, "utf8"), /startsWith\("\/api\/"\)\) return/);
  assert.match(readFileSync(`${web}/sw.js`, "utf8"), /"\/vendor\/qrcode.js"/);
  assert.match(readFileSync(`${web}/index.html`, "utf8"), /vendor\/qrcode\.js/);
  assert.match(app, /getCurrentPosition/);
  assert.match(app, /indexedDB\.open/);
  assert.match(app, /synchroniserFileLocale/);
  assert.match(app, /FANN-BADGE:/);
  assert.match(app, /function vuePostePartage/);
  assert.match(app, /function vueBadges/);
  assert.match(app, /preparerPhotoBadge/);
  assert.match(app, /Changer la photo/);
  assert.match(app, /image\/\*,\.heic,\.heif/);
  assert.match(readFileSync(`${web}/sw.js`, "utf8"), /fann-pointage-v\d+/);
  assert.match(app, /fann-pointage-origine-publique/);
  assert.match(app, /new URL\(origine\.value\.trim\(\)\)/);
  assert.match(app, /Mettre à jour l'adresse et le QR/);
  assert.match(app, /QR imprimé n'est pas un lien Internet/);
  assert.match(app, /cleanupVue\?\.\(\)/); // Le changement de vue/déconnexion nettoie les ressources.
  assert.match(app, /generationCamera/); // Une permission caméra résolue tardivement ne doit pas laisser un flux actif.
  assert.match(app, /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
  assert.match(html, /lang="fr"/);
  assert.match(app, /class: "carte connexion-formulaire"/); // formulaire de connexion existant conservé
  assert.match(app, /api\("\/api\/connexion"/); // aucune modification du flux d’authentification
  assert.match(app, /connexion-layout/);
  assert.match(app, /\/images\/fann-pointage-publicite\.jpg/);
  assert.match(readFileSync(`${web}/styles.css`, "utf8"), /@media \(max-width:760px\)[\s\S]*?connexion-layout/);
  assert.match(readFileSync(`${web}/sw.js`, "utf8"), /fann-pointage-v\d+/);
});

test("HTTP : affiche la publicité FANN POINTAGE comme image JPEG et sans cache long", async () => {
  const s = await demarrer();
  try {
    const reponse = await fetch(`${s.base}/images/fann-pointage-publicite.jpg`);
    assert.equal(reponse.status, 200);
    assert.match(reponse.headers.get("content-type") ?? "", /image\/jpeg/);
    assert.ok((await reponse.arrayBuffer()).byteLength > 100_000);
    assert.match(reponse.headers.get("content-security-policy") ?? "", /img-src 'self'/);
  } finally { await s.fermer(); }
});


test("QR local : produit un SVG exploitable sans exposer le jeton en texte", () => {
  const script = readFileSync(`${web}/vendor/qrcode.js`, "utf8");
  const contexte: { window: Record<string, unknown> } = { window: {} };
  runInNewContext(script, contexte, { timeout: 1000 });
  const qr = contexte.window.FannQRCode as { toSvg(texte: string, options?: Record<string, unknown>): string };
  assert.equal(typeof qr.toSvg, "function");
  const url = "https://exemple.test/#/pointage?qr=jeton-sensible-123456789";
  const svg = qr.toSvg(url, { margin: 4, errorCorrectionLevel: "M" });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<path d="M/);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.doesNotMatch(svg, /jeton-sensible-123456789/);
});

test("HTTP : délais explicites contre les connexions lentes", () => {
  const srv = creerServeur({} as never, web);
  assert.equal(srv.headersTimeout, 15_000);
  assert.equal(srv.requestTimeout, 30_000);
  assert.equal(srv.keepAliveTimeout, 5_000);
  srv.close();
});

test("interface : en mode catalogue PostgreSQL, aucune page n'est masquée (comptes, absences et rapports comprises)", () => {
  const app = readFileSync(`${web}/app.js`, "utf8");
  assert.doesNotMatch(app, /vuesPostgres/, "plus de liste blanche : le serveur répond 503 explicite pour toute route non migrée");
  assert.match(app, /const dispo = Object\.entries\(VUES\)\.filter\(\(\[, v\]\) => v\[2\]\(moi\)\);/, "seul le rôle filtre le menu");
  for (const cle of ["comptes", "absences", "rapports", "catalogue", "badges"]) assert.match(app, new RegExp(`^  ${cle}: \\[`, "m"), cle);
});

test("interface téléphone : graphique en barres div (CSP sans style en ligne) et impression des badges en aperçu", () => {
  const app = readFileSync(`${web}/app.js`, "utf8");
  const css = readFileSync(`${web}/styles.css`, "utf8");
  // Graphique : plus de <progress> vertical tourné (mal rendu sur mobile) ; la hauteur passe par le DOM, jamais par un attribut style.
  assert.doesNotMatch(app, /h\("progress", \{ class: "dashboard-chart-bar"/);
  assert.match(app, /remplissage\.style\.height = /);
  assert.doesNotMatch(app, /setAttribute\("style"|\bstyle: ["`]/);
  assert.doesNotMatch(css, /dashboard-chart-bar::-(webkit|moz)-progress/);
  assert.match(css, /\.dashboard-chart-fill \{[^}]*position:absolute/);
  // Impression : aperçu visible, impression lancée par un second appui, aucun nettoyage automatique ni alert() bloquant.
  assert.match(app, /Lancer l’impression/);
  assert.match(app, /fermerApercuImpression/);
  assert.doesNotMatch(app, /afterprint/);
  assert.doesNotMatch(app, /alert\("Sélectionnez au moins un badge/);
  assert.match(css, /@media screen \{\s*\.apercu-impression/);
  assert.match(css, /@media print \{[\s\S]*\.apercu-impression-actions \{ display:none !important; \}/);
});

test("service worker : tout fichier local chargé par l'interface est pré-chargé (sinon l'appli ne démarre pas hors ligne)", () => {
  const sw = readFileSync(`${web}/sw.js`, "utf8");
  const liste = new Set([...(/const FICHIERS = \[([^\]]*)\]/.exec(sw)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  assert.ok(liste.size > 5, "liste de pré-chargement introuvable");
  const requis = new Set<string>();
  for (const f of ["index.html", "imprimer.html"]) {
    for (const m of readFileSync(`${web}/${f}`, "utf8").matchAll(/(?:src|href)="(\/[^"#?]+)"/g)) requis.add(m[1]!);
  }
  for (const f of ["app.js", "emargement.js", "imprimer.js", "compteurs.js", "scan-pointage.js", "signal-station.js", "badge-print-layout.js"]) {
    for (const m of readFileSync(`${web}/${f}`, "utf8").matchAll(/from "(\/[^"]+\.js)"/g)) requis.add(m[1]!);
  }
  requis.delete("/");
  const manquants = [...requis].filter((c) => !liste.has(c));
  assert.deepEqual(manquants, [], `fichiers servis mais absents du pré-chargement : ${manquants.join(", ")}`);
  for (const c of requis) assert.ok(existsSync(`${web}${c}`), `${c} référencé mais absent du dossier web`);
});

test("interface : la vue d'émargement est un module séparé, pré-chargé hors ligne, sans injection HTML ni import circulaire", () => {
  const module = readFileSync(`${web}/emargement.js`, "utf8");
  assert.doesNotMatch(module, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(/);
  assert.doesNotMatch(module, /from "\/app\.js"/, "le module ne doit rien importer de app.js (dépendances injectées)");
  assert.match(module, /export function creerVueEmargement\(/);
  const app = readFileSync(`${web}/app.js`, "utf8");
  assert.match(app, /import \{ creerVueEmargement \} from "\/emargement\.js";/);
  assert.match(app, /^  emargement: \["Feuilles d'émargement", vueEmargement,/m);
  assert.match(readFileSync(`${web}/sw.js`, "utf8"), /"\/emargement\.js"/);
});
