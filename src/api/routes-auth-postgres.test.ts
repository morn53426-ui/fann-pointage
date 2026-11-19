// Tests des routes HTTP/routeur lorsqu'une authentification PostgreSQL est injectée.
// Le dépôt est simulé ici; un test DB réel est fourni séparément via npm run test:postgres.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerDemo } from "./demo.ts";
import { hashMotDePasse, LimiteurTentatives } from "./auth.ts";
import { gererRequete } from "./routes.ts";
import type { AuthentificationPersistante, Contexte, Requete } from "./routes.ts";
import type { Utilisateur } from "./magasin.ts";
import { OperationsPostgres } from "./operations-postgres.ts";
import type { PoolPg, ResultatPg } from "../pointage/postgres.ts";

const MDP = "mot-de-passe-pg-test-robuste";
const ID = "11111111-1111-4111-8111-111111111111";
const SVC = "33333333-3333-4333-8333-333333333333";

class FauxAuthPostgres implements AuthentificationPersistante {
  utilisateur: Utilisateur | null = {
    id: ID, identifiant: "chef-test", hash: hashMotDePasse(MDP), role: "responsable",
    agentId: null, servicesGeres: [SVC], actif: true, sessionVersion: 0,
  };
  appelsParIdentifiant = 0;
  appelsParId = 0;
  async parIdentifiant(id: string): Promise<Utilisateur | null> {
    this.appelsParIdentifiant++;
    return this.utilisateur && this.utilisateur.identifiant === id.trim().toLowerCase() ? this.utilisateur : null;
  }
  async parId(id: string): Promise<Utilisateur | null> {
    this.appelsParId++;
    return this.utilisateur?.id === id ? this.utilisateur : null;
  }
  async servicesVisibles(u: Utilisateur): Promise<{ id: string; nom: string }[]> {
    assert.equal(u.id, ID);
    return [{ id: SVC, nom: "Service de test PostgreSQL" }];
  }
}

function contexte(auth: AuthentificationPersistante): Contexte {
  const { magasin } = creerDemo(new Date("2026-10-13T10:00:00Z"), { motDePasse: "mot-de-passe-demo-qui-ne-doit-pas-passer" });
  return { magasin, limiteur: new LimiteurTentatives(), maintenant: () => new Date("2026-10-13T10:00:00Z"), authentificationPersistante: auth };
}
function requete(methode: string, chemin: string, corps?: unknown, authorization?: string): Requete {
  return { methode, chemin, requete: {}, corps, entetes: { authorization }, ip: "127.0.0.1" };
}

test("routage auth PostgreSQL : identifiants DB acceptés, session liée à la version de compte", async () => {
  const auth = new FauxAuthPostgres();
  const ctx = contexte(auth);
  const login = await gererRequete(ctx, requete("POST", "/api/connexion", { identifiant: "CHEF-TEST", motDePasse: MDP }));
  assert.equal(login.statut, 200);
  const jeton = (login.corps as { jeton: string }).jeton;
  assert.ok(jeton);
  assert.equal(auth.appelsParIdentifiant, 1);
  const moi = await gererRequete(ctx, requete("GET", "/api/moi", undefined, `Bearer ${jeton}`));
  assert.equal(moi.statut, 200);
  assert.deepEqual((moi.corps as { services: unknown[] }).services, [{ id: SVC, nom: "Service de test PostgreSQL" }]);
  assert.equal((moi.corps as { identifiant: string }).identifiant, "chef-test");
  assert.equal(auth.appelsParId, 1);
});

test("routage auth PostgreSQL : pas de repli vers les comptes démo si l'identifiant DB est absent", async () => {
  const auth = new FauxAuthPostgres();
  auth.utilisateur = null;
  const ctx = contexte(auth);
  const res = await gererRequete(ctx, requete("POST", "/api/connexion", { identifiant: "admin", motDePasse: "mot-de-passe-demo-qui-ne-doit-pas-passer" }));
  assert.equal(res.statut, 401);
  assert.equal(auth.appelsParIdentifiant, 1);
});

test("routage auth PostgreSQL : désactivation ou changement de version révoque une session existante", async () => {
  const auth = new FauxAuthPostgres();
  const ctx = contexte(auth);
  const login = await gererRequete(ctx, requete("POST", "/api/connexion", { identifiant: "chef-test", motDePasse: MDP }));
  const jeton = (login.corps as { jeton: string }).jeton;
  auth.utilisateur = { ...auth.utilisateur!, sessionVersion: 1 };
  const moi = await gererRequete(ctx, requete("GET", "/api/moi", undefined, `Bearer ${jeton}`));
  assert.equal(moi.statut, 401);
});

test("routage auth PostgreSQL : opérations métier en 503 tant que le dépôt métier n'est pas migré", async () => {
  const auth = new FauxAuthPostgres();
  const ctx = contexte(auth);
  const login = await gererRequete(ctx, requete("POST", "/api/connexion", { identifiant: "chef-test", motDePasse: MDP }));
  const jeton = (login.corps as { jeton: string }).jeton;
  const agents = await gererRequete(ctx, requete("GET", "/api/agents", undefined, `Bearer ${jeton}`));
  assert.equal(agents.statut, 503);
  assert.equal((agents.corps as { erreur: string }).erreur, "migration_metier_incomplete");
});


test("routage auth PostgreSQL : absences et rapports passent par le dépôt PostgreSQL, pas par la démo ni 503", async () => {
  const auth = new FauxAuthPostgres();
  const ctx = contexte(auth);
  const query = async (_sql: string, _values: readonly unknown[] = []): Promise<ResultatPg> => ({ rows: [], rowCount: 0 });
  ctx.operationsPersistantes = new OperationsPostgres({ query, connect: async () => ({ query, release() {} }) } as unknown as PoolPg, "fann-test-secret-long-and-random-0123456789");
  const login = await gererRequete(ctx, requete("POST", "/api/connexion", { identifiant: "chef-test", motDePasse: MDP }));
  const jeton = (login.corps as { jeton: string }).jeton;
  assert.ok(jeton);
  const absences = await gererRequete(ctx, requete("GET", "/api/absences", undefined, `Bearer ${jeton}`));
  assert.equal(absences.statut, 200);
  assert.equal((absences.corps as { source: string }).source, "postgresql");
  const rapports = await gererRequete(ctx, { ...requete("GET", "/api/rapports", undefined, `Bearer ${jeton}`), requete: { type: "jour", date: "2026-10-13" } });
  assert.equal(rapports.statut, 200);
  assert.equal((rapports.corps as { lignes: unknown[] }).lignes.length, 0);
});

const TARGET_ID = "44444444-4444-4444-8444-444444444444";
const NEW_ID = "55555555-5555-4555-8555-555555555555";
class FauxGestionAuthPostgres extends FauxAuthPostgres {
  calls: { operation: string; id?: string; args?: unknown[] }[] = [];
  private users: Utilisateur[];
  constructor(role: Utilisateur["role"] = "administrateur") {
    super();
    this.utilisateur = { id: ID, identifiant: "admin-test", hash: hashMotDePasse(MDP), role, agentId: null, servicesGeres: [], actif: true, sessionVersion: 0 };
    this.users = [this.utilisateur, { id: TARGET_ID, identifiant: "responsable-test", hash: hashMotDePasse(MDP), role: "responsable", agentId: null, servicesGeres: [SVC], actif: true, sessionVersion: 0 }];
  }
  async parId(id: string): Promise<Utilisateur | null> { return this.users.find((u) => u.id === id) ?? null; }
  async lister(): Promise<Utilisateur[]> { this.calls.push({ operation: "lister" }); return this.users; }
  async creer(c: { identifiant: string; hash: string; role: Utilisateur["role"]; agentId: string | null; servicesGeres?: string[] }, acteurId?: string | null, ip?: string): Promise<Utilisateur> {
    this.calls.push({ operation: "creer", args: [c, acteurId, ip] });
    const u: Utilisateur = { id: NEW_ID, ...c, servicesGeres: c.servicesGeres ?? [], actif: true, sessionVersion: 0 };
    this.users.push(u); return u;
  }
  async modifierCompte(id: string, changements: { hash?: string; actif?: boolean; doitChanger?: boolean }, acteurId?: string | null, ip?: string): Promise<Utilisateur | null> {
    this.calls.push({ operation: "modifier", id, args: [changements, acteurId, ip] });
    const index = this.users.findIndex((x) => x.id === id);
    if (index < 0) return null;
    this.users[index] = { ...this.users[index]!, ...changements, sessionVersion: (this.users[index]!.sessionVersion ?? 0) + 1 };
    return this.users[index]!;
  }
  async revoquerSessions(id: string, acteurId?: string | null, ip?: string): Promise<boolean> {
    this.calls.push({ operation: "revoquerSessions", id, args: [acteurId, ip] }); return true;
  }
}

test("gestion des comptes PostgreSQL : liste/création/modification/désactivation utilisent le dépôt persistant", async () => {
  const auth = new FauxGestionAuthPostgres();
  const ctx = contexte(auth);
  const login = await gererRequete(ctx, requete("POST", "/api/connexion", { identifiant: "admin-test", motDePasse: MDP }));
  assert.equal(login.statut, 200);
  const jeton = (login.corps as { jeton: string }).jeton;

  const liste = await gererRequete(ctx, requete("GET", "/api/utilisateurs", undefined, `Bearer ${jeton}`));
  assert.equal(liste.statut, 200);
  assert.equal((liste.corps as { source: string }).source, "postgresql");
  const entree = (liste.corps as { utilisateurs: Array<Record<string, unknown>> }).utilisateurs[0]!;
  assert.equal("hash" in entree, false, "l'empreinte du mot de passe ne doit pas être renvoyée");
  assert.ok(auth.calls.some((x) => x.operation === "lister"));

  const creation = await gererRequete(ctx, requete("POST", "/api/utilisateurs", { identifiant: "brancardier-test", motDePasse: "secret-test-long-unique", role: "brancardier", agentId: TARGET_ID }, `Bearer ${jeton}`));
  assert.equal(creation.statut, 201);
  const appelCreation = auth.calls.find((x) => x.operation === "creer")!;
  assert.equal((appelCreation.args?.[1]), ID);
  assert.equal((appelCreation.args?.[2]), "127.0.0.1");
  assert.match(((appelCreation.args?.[0] as { hash: string }).hash), /^scrypt\$/);

  const patch = await gererRequete(ctx, requete("PATCH", `/api/utilisateurs/${TARGET_ID}`, { motDePasse: "nouveau-secret-test-long" }, `Bearer ${jeton}`));
  assert.equal(patch.statut, 200);
  assert.deepEqual(Object.keys(auth.calls.find((x) => x.operation === "modifier" && x.id === TARGET_ID)!.args![0] as object), ["hash", "doitChanger"]);
  assert.equal((auth.calls.find((x) => x.operation === "modifier" && x.id === TARGET_ID)!.args![0] as { doitChanger: boolean }).doitChanger, true, "mot de passe réinitialisé par l’administrateur = provisoire");

  const suppression = await gererRequete(ctx, requete("DELETE", `/api/utilisateurs/${TARGET_ID}`, undefined, `Bearer ${jeton}`));
  assert.equal(suppression.statut, 200);
  assert.deepEqual(auth.calls.filter((x) => x.operation === "modifier" && x.id === TARGET_ID).at(-1)?.args?.[0], { actif: false });
});

test("gestion des comptes PostgreSQL : un rôle non administrateur reçoit 403", async () => {
  const auth = new FauxGestionAuthPostgres("responsable");
  const ctx = contexte(auth);
  const login = await gererRequete(ctx, requete("POST", "/api/connexion", { identifiant: "admin-test", motDePasse: MDP }));
  assert.equal(login.statut, 200);
  const jeton = (login.corps as { jeton: string }).jeton;
  const result = await gererRequete(ctx, requete("GET", "/api/utilisateurs", undefined, `Bearer ${jeton}`));
  assert.equal(result.statut, 403);
  assert.equal(auth.calls.some((x) => x.operation === "lister"), false);
});
