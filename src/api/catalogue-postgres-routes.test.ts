import { test } from "node:test";
import assert from "node:assert/strict";
import { creerDemo } from "./demo.ts";
import { hashMotDePasse, LimiteurTentatives } from "./auth.ts";
import { gererRequete } from "./routes.ts";
import type { AuthentificationPersistante, Contexte, Requete } from "./routes.ts";
import type { Utilisateur } from "./magasin.ts";
import type { AgentCatalogue, CataloguePersistant, ServiceCatalogue, SaisieAgent, SaisieService, ModifAgent, ModifService } from "./catalogue-postgres.ts";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_NOUVEAU_ID = "44444444-4444-4444-8444-444444444444";
const SERVICE_NOUVEAU_ID = "55555555-5555-4555-8555-555555555555";
const MDP = "mot-de-passe-admin-test-long";
const utilisateurAdmin: Utilisateur = { id: ADMIN_ID, identifiant: "admin-test", hash: hashMotDePasse(MDP), role: "administrateur", agentId: null, servicesGeres: [], actif: true, sessionVersion: 0 };

class FauxCatalogue implements CataloguePersistant {
  agents: AgentCatalogue[] = [{ id: AGENT_ID, prenom: "Agent", nom: "Test", matricule: null, serviceId: SERVICE_ID, service: "Accueil urgences", regime: "urgences", actif: true, profession: null, adresse: null, telephone: null }];
  services: ServiceCatalogue[] = [{ id: SERVICE_ID, nom: "Accueil urgences", regimeDefaut: "urgences", actif: true }];
  async listerAgents() { return structuredClone(this.agents); }
  async listerServices() { return structuredClone(this.services); }
  async creerAgent(s: SaisieAgent) { const a: AgentCatalogue = { id: AGENT_NOUVEAU_ID, prenom: s.prenom, nom: s.nom, matricule: s.matricule, serviceId: s.serviceId, service: this.services[0]!.nom, regime: s.regime, actif: true, profession: s.profession ?? null, adresse: s.adresse ?? null, telephone: s.telephone ?? null }; this.agents.push(a); return a; }
  async modifierAgent(id: string, c: ModifAgent) { const i = this.agents.findIndex(a=>a.id===id); if(i<0) throw new Error("introuvable"); this.agents[i]={...this.agents[i]!,...c}; return this.agents[i]!; }
  async creerService(s: SaisieService) { const v: ServiceCatalogue = {id:SERVICE_NOUVEAU_ID,nom:s.nom,regimeDefaut:s.regimeDefaut,actif:true};this.services.push(v);return v; }
  async modifierService(id: string,c: ModifService) { const i=this.services.findIndex(s=>s.id===id);if(i<0)throw new Error("introuvable");this.services[i]={...this.services[i]!,...c};return this.services[i]!; }
}
function setup(role: "administrateur" | "responsable" = "administrateur") {
  const { magasin } = creerDemo(new Date("2026-10-13T10:00:00Z"), { motDePasse: "mot-de-passe-demo-inaccessible" });
  const admin = { ...utilisateurAdmin, role } as Utilisateur;
  const auth: AuthentificationPersistante = {
    parIdentifiant: async (id) => id.toLowerCase() === admin.identifiant ? admin : null,
    parId: async (id) => id === admin.id ? admin : null,
    servicesVisibles: async () => [{ id: SERVICE_ID, nom: "Accueil urgences" }],
  };
  const catalogue = new FauxCatalogue();
  const ctx = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => new Date("2026-10-13T10:00:00Z"), authentificationPersistante: auth, cataloguePersistant: catalogue, modeApplication: "catalogue-postgres" } as Contexte;
  return { ctx, catalogue, identifiant: admin.identifiant };
}
function req(methode: string, chemin: string, corps?: unknown, authorization?: string): Requete {
  return { methode, chemin, corps, requete: {}, entetes: { authorization }, ip: "127.0.0.1" };
}
async function jeton(ctx: Contexte, identifiant = "admin-test") {
  const r = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant, motDePasse: MDP }));
  return { r, jeton: (r.corps as { jeton?: string })?.jeton };
}

test("catalogue PostgreSQL : /api/moi annonce le mode réel sans données fictives", async () => {
  const { ctx } = setup(); const login = await jeton(ctx); assert.equal(login.r.statut, 200);
  const r = await gererRequete(ctx, req("GET", "/api/moi", undefined, `Bearer ${login.jeton}`));
  assert.equal(r.statut, 200); assert.equal((r.corps as { mode: string }).mode, "catalogue-postgres");
});

test("catalogue PostgreSQL : les agents proviennent exclusivement du dépôt persistant", async () => {
  const { ctx, catalogue } = setup(); const login = await jeton(ctx);
  const r = await gererRequete(ctx, req("GET", "/api/agents", undefined, `Bearer ${login.jeton}`));
  assert.equal(r.statut, 200); assert.equal((r.corps as { fictif: boolean }).fictif, false);
  assert.deepEqual((r.corps as { agents: AgentCatalogue[] }).agents, catalogue.agents);
});

test("catalogue PostgreSQL : les responsables ne peuvent pas se connecter à la console admin-only", async () => {
  const { ctx } = setup("responsable"); const login = await jeton(ctx);
  assert.equal(login.r.statut, 403);
});

test("catalogue PostgreSQL : création d'un service passe par le dépôt réel et vérifie l'accès admin", async () => {
  const { ctx, catalogue } = setup(); const login = await jeton(ctx);
  const r = await gererRequete(ctx, req("POST", "/api/services", { nom: "Nouveau service", regimeDefaut: "general" }, `Bearer ${login.jeton}`));
  assert.equal(r.statut, 201); assert.ok(catalogue.services.some(s => s.nom === "Nouveau service"));
});

test("catalogue PostgreSQL : suppression d'agent désactive la fiche sans suppression physique", async () => {
  const { ctx, catalogue } = setup(); const login = await jeton(ctx);
  const r = await gererRequete(ctx, req("DELETE", `/api/agents/${AGENT_ID}`, undefined, `Bearer ${login.jeton}`));
  assert.equal(r.statut, 200); assert.equal(catalogue.agents[0]?.actif, false);
});

test("catalogue PostgreSQL : les vues métier non migrées ne retombent jamais sur les données démo", async () => {
  const { ctx } = setup(); const login = await jeton(ctx);
  const r = await gererRequete(ctx, req("GET", "/api/tableau-de-bord", undefined, `Bearer ${login.jeton}`));
  assert.equal(r.statut, 503); assert.equal((r.corps as { erreur: string }).erreur, "migration_metier_incomplete");
});


test("catalogue PostgreSQL : création d'agent persistante avec service et régime explicites", async () => {
  const { ctx, catalogue } = setup(); const login = await jeton(ctx);
  const r = await gererRequete(ctx, req("POST", "/api/agents", { prenom: "Nouvel agent", nom: "Test", matricule: null, serviceId: SERVICE_ID, regime: "general" }, `Bearer ${login.jeton}`));
  assert.equal(r.statut, 201);
  assert.ok(catalogue.agents.some((a) => a.id === AGENT_NOUVEAU_ID && a.prenom === "Nouvel agent" && a.regime === "general"));
});

test("catalogue PostgreSQL : modification d'agent passe par le dépôt persistant", async () => {
  const { ctx, catalogue } = setup(); const login = await jeton(ctx);
  const r = await gererRequete(ctx, req("PATCH", `/api/agents/${AGENT_ID}`, { prenom: "Agent modifié" }, `Bearer ${login.jeton}`));
  assert.equal(r.statut, 200);
  assert.equal(catalogue.agents[0]?.prenom, "Agent modifié");
});

test("catalogue PostgreSQL : modification et archivage de service passent par le dépôt", async () => {
  const { ctx, catalogue } = setup(); const login = await jeton(ctx);
  const modif = await gererRequete(ctx, req("PATCH", `/api/services/${SERVICE_ID}`, { nom: "Accueil urgences modifié" }, `Bearer ${login.jeton}`));
  assert.equal(modif.statut, 200);
  assert.equal(catalogue.services[0]?.nom, "Accueil urgences modifié");
  const archivage = await gererRequete(ctx, req("DELETE", `/api/services/${SERVICE_ID}`, undefined, `Bearer ${login.jeton}`));
  assert.equal(archivage.statut, 200);
  assert.equal(catalogue.services[0]?.actif, false);
});

test("catalogue PostgreSQL : la gestion des comptes n'est pas interceptée par le catalogue (liste et création de comptes)", async () => {
  const { ctx } = setup();
  const crees: Utilisateur[] = [];
  ctx.authentificationPersistante = {
    ...ctx.authentificationPersistante!,
    lister: async () => [utilisateurAdmin, ...crees],
    creer: async (c) => { const u = { id: "66666666-6666-4666-8666-666666666666", identifiant: c.identifiant, hash: c.hash, role: c.role, agentId: c.agentId, servicesGeres: c.servicesGeres ?? [], actif: true, sessionVersion: 0 } as Utilisateur; crees.push(u); return u; },
    modifierCompte: async () => null,
  };
  const login = await jeton(ctx); const auth = `Bearer ${login.jeton}`;

  const liste = await gererRequete(ctx, req("GET", "/api/utilisateurs", undefined, auth));
  assert.equal(liste.statut, 200, JSON.stringify(liste.corps));
  assert.equal((liste.corps as { source: string }).source, "postgresql");

  const cree = await gererRequete(ctx, req("POST", "/api/utilisateurs", { identifiant: "chef.urgences", motDePasse: "mot-de-passe-long-12", role: "responsable", servicesGeres: [SERVICE_ID] }, auth));
  assert.equal(cree.statut, 201, JSON.stringify(cree.corps));
  assert.equal(crees[0]?.identifiant, "chef.urgences");
  assert.deepEqual(crees[0]?.servicesGeres, [SERVICE_ID]);

  const inconnue = await gererRequete(ctx, req("GET", "/api/rapport-inexistant", undefined, auth));
  assert.equal(inconnue.statut, 404, "une route inexistante répond 404 (pas 503 : évite les fausses alertes de supervision) et ne renvoie jamais de données fictives");
});
