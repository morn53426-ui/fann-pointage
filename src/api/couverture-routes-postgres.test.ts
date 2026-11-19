// Non-régression « production » : en mode PostgreSQL, aucune action de l'interface ne doit tomber sur le
// garde-fou 503 « migration_metier_incomplete » (refus volontaire réservé aux fonctions non raccordées).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { creerDemo } from "./demo.ts";
import { hashMotDePasse, LimiteurTentatives } from "./auth.ts";
import { gererRequete } from "./routes.ts";
import { DepotAuthentificationPostgres } from "./auth-postgres.ts";
import { DepotCataloguePostgres } from "./catalogue-postgres.ts";
import { OperationsPostgres } from "./operations-postgres.ts";
import type { AuthentificationPersistante, Contexte, Requete } from "./routes.ts";
import type { Utilisateur } from "./magasin.ts";

const racine = fileURLToPath(new URL("../../", import.meta.url));
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const MDP = "mot-de-passe-admin-couverture";
const admin: Utilisateur = { id: ADMIN_ID, identifiant: "admin-couverture", hash: hashMotDePasse(MDP), role: "administrateur", agentId: null, servicesGeres: [], actif: true, sessionVersion: 0 };

test("les dépôts PostgreSQL fournissent toutes les méthodes exigées par les routes de comptes", () => {
  for (const methode of ["parIdentifiant", "parId", "servicesVisibles", "lister", "creer", "modifierCompte", "revoquerSessions"]) {
    assert.equal(typeof (DepotAuthentificationPostgres.prototype as unknown as Record<string, unknown>)[methode], "function", `DepotAuthentificationPostgres.${methode}`);
  }
  for (const methode of ["listerAgents", "listerServices", "creerAgent", "modifierAgent", "creerService", "modifierService"]) {
    assert.equal(typeof (DepotCataloguePostgres.prototype as unknown as Record<string, unknown>)[methode], "function", `DepotCataloguePostgres.${methode}`);
  }
  assert.equal(typeof OperationsPostgres, "function");
});

test("chaque route /api appelée par l'interface est raccordée à PostgreSQL (jamais 503 migration_metier_incomplete)", async () => {
  const { magasin } = creerDemo(new Date("2026-10-19T10:00:00Z"), { motDePasse: "mot-de-passe-demo-inaccessible" });
  const vide = async () => [];
  const auth: AuthentificationPersistante = {
    parIdentifiant: async (id) => id === admin.identifiant ? admin : null,
    parId: async (id) => id === admin.id ? admin : null,
    servicesVisibles: async () => [],
    lister: async () => [admin],
    creer: async () => admin,
    modifierCompte: async () => admin,
    revoquerSessions: async () => true,
  };
  // Dépôts « souples » : toute méthode répond sans erreur ; seul le routage est examiné ici.
  const souple = new Proxy({}, { get: () => async () => vide() }) as never;
  const ctx = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => new Date("2026-10-19T10:00:00Z"), authentificationPersistante: auth, cataloguePersistant: souple, operationsPersistantes: souple, modeApplication: "catalogue-postgres" } as unknown as Contexte;
  const req = (methode: string, chemin: string, jeton?: string, corps?: unknown): Requete => ({ methode, chemin, corps, requete: {}, entetes: { authorization: jeton ? `Bearer ${jeton}` : undefined }, ip: "127.0.0.1" });
  const login = await gererRequete(ctx, req("POST", "/api/connexion", undefined, { identifiant: admin.identifiant, motDePasse: MDP }));
  assert.equal(login.statut, 200);
  const jeton = (login.corps as { jeton: string }).jeton;

  // 1) Chemins réellement littéraux dans web/app.js (GET et POST), instanciés avec des identifiants plausibles.
  const source = readFileSync(`${racine}web/app.js`, "utf8");
  const chemins = new Set<string>();
  for (const m of source.matchAll(/["`](\/api\/[A-Za-z0-9_\-/${}.()]*)["`]/g)) {
    const valeur = m[1]!.includes("jours-feries") ? "2026-12-25" : "abc123"; // un jour férié se désigne par sa date
    chemins.add(m[1]!.replace(/\$\{[^}]*\}/g, valeur).replace(/\/+$/, ""));
  }
  assert.ok(chemins.size >= 20, `chemins front détectés : ${chemins.size}`);
  const ignores = new Set(["/api/connexion", "/api/deconnexion", "/api/connexions/debloquer"]);
  const echecs: string[] = [];
  for (const chemin of chemins) {
    if (ignores.has(chemin)) continue;
    for (const methode of ["GET", "POST", "PATCH", "DELETE"]) {
      const r = await gererRequete(ctx, req(methode, chemin, jeton, {}));
      if ((r.corps as { erreur?: string } | undefined)?.erreur === "migration_metier_incomplete") echecs.push(`${methode} ${chemin}`);
    }
  }
  assert.deepEqual(echecs, [], `Routes du front non raccordées à PostgreSQL : ${echecs.join(", ")}`);
});

test("exploitation : une seule instance applicative (limiteur de connexion en mémoire) et proxy HTTPS non contournable", () => {
  const compose = readFileSync(`${racine}compose.yaml`, "utf8");
  const bloc = compose.split(/^  app:\n/m)[1]!.split(/^  \w[\w-]*:\n/m)[0]!;
  assert.doesNotMatch(bloc, /replicas\s*:/);
  assert.doesNotMatch(compose, /scale\s*:/);
  const https = readFileSync(`${racine}compose.https.yaml`, "utf8");
  // TRUST_PROXY=1 n'est sûr que si seul le proxy est joignable : l'application reste liée à 127.0.0.1.
  assert.doesNotMatch(https, /APP_BIND_ADDRESS:\s*["']?0\.0\.0\.0/);
  assert.match(readFileSync(`${racine}docs/PREPARATION_PRODUCTION.md`, "utf8"), /limiteur[\s\S]*m[ée]moire/i);
});
