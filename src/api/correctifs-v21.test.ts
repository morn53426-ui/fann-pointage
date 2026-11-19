// Correctifs v21 : mot de passe administrateur, comptes agents automatiques, changement de mot de passe,
// journalisation des erreurs 500 et retrait (archivage) d'un message.
import { test } from "node:test";
import assert from "node:assert/strict";
import { creerDemo } from "./demo.ts";
import { hashMotDePasse, LimiteurTentatives, verifierMotDePasse } from "./auth.ts";
import { gererRequete } from "./routes.ts";
import type { AuthentificationPersistante, Contexte, Requete } from "./routes.ts";
import type { Utilisateur } from "./magasin.ts";
import { controlerMotDePasse, motDePasseDepuisTelephone, variantesMotDePasseProvisoire } from "./mot-de-passe.ts";
import { OperationsPostgres, sqlMessageVisiblePour } from "./operations-postgres.ts";
import { DepotCataloguePostgres } from "./catalogue-postgres.ts";
import type { PoolPg, ResultatPg } from "../pointage/postgres.ts";

const NOW = new Date("2026-10-22T10:00:00.000Z");
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_USER_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";
const SERVICE_ID = "44444444-4444-4444-8444-444444444444";
const SECRET = "fann-test-secret-long-and-random-0123456789";

function req(methode: string, chemin: string, corps?: unknown, jeton?: string, requete: Record<string, string> = {}): Requete {
  return { methode, chemin, requete, corps, entetes: { authorization: jeton ? `Bearer ${jeton}` : undefined }, ip: "127.0.0.1" };
}

// ---------- 1. Règle de mot de passe ----------

test("mot de passe administrateur : 9 caractères minimum, 9 chiffres acceptés, valeurs triviales refusées", () => {
  assert.match(controlerMotDePasse("administrateur", "abcdef") ?? "", /au moins 9/);
  assert.match(controlerMotDePasse("administrateur", "12345678") ?? "", /au moins 9/);
  assert.equal(controlerMotDePasse("administrateur", "482915307"), null, "9 chiffres acceptés");
  assert.equal(controlerMotDePasse("administrateur", "Phrase-de-passe-longue-2026"), null);
  assert.ok(controlerMotDePasse("administrateur", "123456789"), "suite de chiffres refusée");
  assert.ok(controlerMotDePasse("administrateur", "111111111"), "chiffre répété refusé");
  assert.ok(controlerMotDePasse("administrateur", "x".repeat(201)), "201 caractères refusés");
  assert.ok(controlerMotDePasse("administrateur", "abcdefghi\nj"), "retour à la ligne refusé");
  // Les autres rôles gardent la règle provisoire (6) ; un mot de passe choisi par la personne exige 8.
  assert.equal(controlerMotDePasse("responsable", "abcdef"), null);
  assert.equal(controlerMotDePasse("brancardier", "abcdef", "provisoire"), null);
  assert.ok(controlerMotDePasse("brancardier", "abcdef", "personnel"));
  assert.equal(controlerMotDePasse("brancardier", "Mot-de-passe-perso", "personnel"), null);
});

test("téléphone → mot de passe provisoire : chiffres seuls, indicatif 221 retiré, formats libres acceptés à la connexion", () => {
  assert.equal(motDePasseDepuisTelephone("+221 77 123 45 67"), "771234567");
  assert.equal(motDePasseDepuisTelephone("00221 77-123-45-67"), "771234567");
  assert.equal(motDePasseDepuisTelephone("77.123.45.67"), "771234567");
  assert.equal(motDePasseDepuisTelephone("12345"), null, "moins de 6 chiffres");
  assert.equal(motDePasseDepuisTelephone(null), null);
  assert.deepEqual(variantesMotDePasseProvisoire("+221 77 123 45 67"), ["+221 77 123 45 67", "771234567"]);
  assert.deepEqual(variantesMotDePasseProvisoire("771234567"), ["771234567"]);
});

test("création d'un compte administrateur : « abcdef » refusé (400), 9 chiffres acceptés — mode démonstration", async () => {
  const { magasin } = creerDemo(NOW, { motDePasse: "Securite-Tests-2026!" });
  const ctx: Contexte = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => magasin.horloge };
  const connexion = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "Securite-Tests-2026!" }));
  const jeton = (connexion.corps as { jeton: string }).jeton;
  const creer = (identifiant: string, motDePasse: string) => gererRequete(ctx, req("POST", "/api/utilisateurs", { identifiant, motDePasse, role: "administrateur" }, jeton));
  assert.equal((await creer("admin.faible", "abcdef")).statut, 400);
  assert.equal((await creer("admin.huit", "12345678")).statut, 400);
  const ok = await creer("admin.neuf", "482915307");
  assert.equal(ok.statut, 201, JSON.stringify(ok.corps));
});

// ---------- 2 et 3. Compte agent provisoire, changement obligatoire, PATCH /api/moi ----------

class FauxAuth implements AuthentificationPersistante {
  users = new Map<string, Utilisateur>();
  changements: { id: string; hash: string }[] = [];
  constructor() {
    this.users.set(ADMIN_ID, { id: ADMIN_ID, identifiant: "admin", hash: hashMotDePasse("482915307"), role: "administrateur", agentId: null, servicesGeres: [], actif: true, sessionVersion: 0 });
    this.users.set(AGENT_USER_ID, { id: AGENT_USER_ID, identifiant: "mat-4521", hash: hashMotDePasse("771234567"), role: "brancardier", agentId: AGENT_ID, servicesGeres: [], actif: true, sessionVersion: 0, doitChangerMotDePasse: true });
  }
  async parIdentifiant(identifiant: string) { return [...this.users.values()].find((u) => u.identifiant === identifiant.trim().toLowerCase()) ?? null; }
  async parId(id: string) { return this.users.get(id) ?? null; }
  async servicesVisibles() { return []; }
  async lister(): Promise<Utilisateur[]> { return [...this.users.values()]; }
  async creer(c: { identifiant: string; hash: string; role: Utilisateur["role"]; agentId: string | null; servicesGeres?: string[] }): Promise<Utilisateur> {
    const u: Utilisateur = { id: "99999999-9999-4999-8999-999999999999", ...c, servicesGeres: c.servicesGeres ?? [], actif: true, sessionVersion: 0 };
    this.users.set(u.id, u); return u;
  }
  async changerMotDePassePropre(id: string, hash: string): Promise<number | null> {
    const u = this.users.get(id); if (!u || !u.actif) return null;
    this.changements.push({ id, hash });
    u.hash = hash; u.doitChangerMotDePasse = false; u.sessionVersion = (u.sessionVersion ?? 0) + 1;
    return u.sessionVersion;
  }
  async modifierCompte(id: string, c: { hash?: string; actif?: boolean; doitChanger?: boolean }) {
    const u = this.users.get(id); if (!u) return null;
    if (c.hash) { u.hash = c.hash; u.doitChangerMotDePasse = c.doitChanger === true; }
    u.sessionVersion = (u.sessionVersion ?? 0) + 1; return u;
  }
}
function contextePersistant(auth: FauxAuth): Contexte {
  const { magasin } = creerDemo(NOW, { motDePasse: "mot-de-passe-demo-qui-ne-doit-pas-passer" });
  return { magasin, limiteur: new LimiteurTentatives(), maintenant: () => NOW, authentificationPersistante: auth };
}

test("compte agent : connexion avec le téléphone saisi librement, puis tout est bloqué sauf /api/moi tant que le mot de passe n'est pas changé", async () => {
  const auth = new FauxAuth();
  const ctx = contextePersistant(auth);
  const login = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "MAT-4521", motDePasse: "+221 77 123 45 67" }));
  assert.equal(login.statut, 200, JSON.stringify(login.corps));
  assert.equal((login.corps as { doitChangerMotDePasse: boolean }).doitChangerMotDePasse, true);
  const jeton = (login.corps as { jeton: string }).jeton;

  const bloque = await gererRequete(ctx, req("GET", "/api/messages", undefined, jeton));
  assert.equal(bloque.statut, 403);
  assert.equal((bloque.corps as { erreur: string }).erreur, "changement_mot_de_passe_requis");
  assert.equal((await gererRequete(ctx, req("POST", "/api/pointage", {}, jeton))).statut, 403);

  const moi = await gererRequete(ctx, req("GET", "/api/moi", undefined, jeton));
  assert.equal(moi.statut, 200);
  assert.equal((moi.corps as { doitChangerMotDePasse: boolean }).doitChangerMotDePasse, true);
});

test("PATCH /api/moi : ancien mot de passe vérifié, règles du nouveau, jeton neuf, ancien jeton révoqué, blocage levé", async () => {
  const auth = new FauxAuth();
  const ctx = contextePersistant(auth);
  const login = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "mat-4521", motDePasse: "771234567" }));
  const ancienJeton = (login.corps as { jeton: string }).jeton;
  const patch = (corps: unknown, jeton = ancienJeton) => gererRequete(ctx, req("PATCH", "/api/moi", corps, jeton));

  assert.equal((await patch({ nouveauMotDePasse: "Nouveau-mot-de-passe-1" })).statut, 400, "ancien mot de passe obligatoire");
  assert.equal((await patch({ motDePasseActuel: "mauvais", nouveauMotDePasse: "Nouveau-mot-de-passe-1" })).statut, 403, "ancien incorrect");
  assert.equal((await patch({ motDePasseActuel: "771234567", nouveauMotDePasse: "court" })).statut, 400, "nouveau trop court");
  assert.equal((await patch({ motDePasseActuel: "771234567", nouveauMotDePasse: "771234567" })).statut, 400, "identique à l'ancien");
  assert.equal((await patch({ motDePasseActuel: "771234567", nouveauMotDePasse: "77 123 45 67" })).statut, 400, "ancien dans un autre format");
  assert.equal((await patch({ motDePasseActuel: "771234567", nouveauMotDePasse: "MAT-4521" })).statut, 400, "identique à l'identifiant");
  assert.equal(auth.changements.length, 0, "aucun changement appliqué par les refus");
  assert.equal((await patch({ motDePasseActuel: "+221 77 123 45 67", nouveauMotDePasse: "Mot-de-passe-perso-9" })).statut, 200, "l'ancien (téléphone) peut être saisi avec un autre format");
  assert.equal(auth.changements.length, 1);
});

test("PATCH /api/moi : après succès le nouveau jeton fonctionne, l'ancien est refusé, l'ancien mot de passe ne connecte plus", async () => {
  const auth = new FauxAuth();
  const ctx = contextePersistant(auth);
  const login = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "mat-4521", motDePasse: "771234567" }));
  const ancienJeton = (login.corps as { jeton: string }).jeton;
  const r = await gererRequete(ctx, req("PATCH", "/api/moi", { motDePasseActuel: "771234567", nouveauMotDePasse: "Mot-de-passe-perso-9" }, ancienJeton));
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  const nouveauJeton = (r.corps as { jeton: string }).jeton;
  assert.equal((r.corps as { doitChangerMotDePasse: boolean }).doitChangerMotDePasse, false);
  assert.equal(JSON.stringify(r.corps).includes("Mot-de-passe-perso-9"), false, "le mot de passe n'est jamais renvoyé");
  assert.equal((await gererRequete(ctx, req("GET", "/api/moi", undefined, ancienJeton))).statut, 401);
  assert.equal((await gererRequete(ctx, req("GET", "/api/moi", undefined, nouveauJeton))).statut, 200);
  // Plus de blocage : la route métier n'est plus refusée pour « changement requis » (elle l'est ici pour absence de migration, pas pour ce motif).
  const apres = await gererRequete(ctx, req("GET", "/api/messages", undefined, nouveauJeton));
  assert.notEqual((apres.corps as { erreur?: string }).erreur, "changement_mot_de_passe_requis");
  assert.equal((await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "mat-4521", motDePasse: "771234567" }))).statut, 401);
  assert.equal((await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "mat-4521", motDePasse: "Mot-de-passe-perso-9" }))).statut, 200);
});

test("PATCH /api/moi : un administrateur doit choisir 9 caractères minimum ; 5 mauvais mots de passe actuels bloquent (429)", async () => {
  const auth = new FauxAuth();
  const ctx = contextePersistant(auth);
  const jeton = ((await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "482915307" }))).corps as { jeton: string }).jeton;
  const faible = await gererRequete(ctx, req("PATCH", "/api/moi", { motDePasseActuel: "482915307", nouveauMotDePasse: "abcd1234" }, jeton));
  assert.equal(faible.statut, 400);
  assert.match((faible.corps as { message: string }).message, /au moins 9/);
  for (let i = 0; i < 5; i++) assert.equal((await gererRequete(ctx, req("PATCH", "/api/moi", { motDePasseActuel: `faux-${i}`, nouveauMotDePasse: "Nouveau-Admin-2026" }, jeton))).statut, 403);
  assert.equal((await gererRequete(ctx, req("PATCH", "/api/moi", { motDePasseActuel: "482915307", nouveauMotDePasse: "Nouveau-Admin-2026" }, jeton))).statut, 429);
});

test("mode démonstration : PATCH /api/moi change le mot de passe et révoque l'ancien jeton", async () => {
  const { magasin } = creerDemo(NOW, { motDePasse: "Securite-Tests-2026!" });
  const ctx: Contexte = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => magasin.horloge };
  const ancien = ((await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "Securite-Tests-2026!" }))).corps as { jeton: string }).jeton;
  const r = await gererRequete(ctx, req("PATCH", "/api/moi", { motDePasseActuel: "Securite-Tests-2026!", nouveauMotDePasse: "Nouveau-mot-2026-ok" }, ancien));
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal((await gererRequete(ctx, req("GET", "/api/moi", undefined, ancien))).statut, 401);
  assert.equal((await gererRequete(ctx, req("GET", "/api/moi", undefined, (r.corps as { jeton: string }).jeton))).statut, 200);
});

test("réinitialisation par l'administrateur : règle selon le rôle de la cible, mot de passe provisoire (changement obligatoire)", async () => {
  const auth = new FauxAuth();
  const ctx = contextePersistant(auth);
  const jeton = ((await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "482915307" }))).corps as { jeton: string }).jeton;
  // Cible = administrateur lui-même : 9 caractères exigés.
  assert.equal((await gererRequete(ctx, req("PATCH", `/api/utilisateurs/${ADMIN_ID}`, { motDePasse: "abcdef" }, jeton))).statut, 400);
  // Cible = agent : règle provisoire à 6, et le compte repasse en « changement obligatoire ».
  auth.users.get(AGENT_USER_ID)!.doitChangerMotDePasse = false;
  assert.equal((await gererRequete(ctx, req("PATCH", `/api/utilisateurs/${AGENT_USER_ID}`, { motDePasse: "abcde" }, jeton))).statut, 400);
  assert.equal((await gererRequete(ctx, req("PATCH", `/api/utilisateurs/${AGENT_USER_ID}`, { motDePasse: "abcdef" }, jeton))).statut, 200);
  assert.equal(auth.users.get(AGENT_USER_ID)!.doitChangerMotDePasse, true);
  assert.equal((await gererRequete(ctx, req("PATCH", `/api/utilisateurs/${AGENT_USER_ID}`, { motDePasse: "abcdef" }, "jeton-invalide"))).statut, 401);
});

// ---------- 4. Journalisation des erreurs serveur ----------

test("erreur 500 : une ligne de journal avec référence, route, code PostgreSQL ; aucun mot de passe ni détail renvoyé au client", async () => {
  const auth = new FauxAuth();
  const ctx = contextePersistant(auth);
  const jeton = ((await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "482915307" }))).corps as { jeton: string }).jeton;
  auth.lister = async () => { throw Object.assign(new Error("relation \"profiles\" does not exist"), { code: "42P01", table: "profiles" }); };
  auth.creer = async () => { throw new Error("boom"); };
  const lignes: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { lignes.push(a.map(String).join(" ")); };
  try {
    const r = await gererRequete(ctx, req("GET", "/api/utilisateurs", undefined, jeton, { secret: "ne-pas-journaliser" }));
    assert.equal(r.statut, 500);
    const corps = r.corps as { erreur: string; message: string; reference: string };
    assert.equal(corps.erreur, "erreur_interne");
    assert.match(corps.reference, /^[0-9a-f]{8}$/);
    assert.equal(JSON.stringify(corps).includes("profiles"), false, "aucun détail SQL côté client");
    assert.equal(lignes.length, 1, "exactement une ligne de journal");
    assert.match(lignes[0]!, /\[ERREUR 500\]/);
    assert.ok(lignes[0]!.includes(`ref=${corps.reference}`));
    assert.ok(lignes[0]!.includes("GET /api/utilisateurs") && lignes[0]!.includes("code=42P01"));
    assert.equal(lignes[0]!.includes("ne-pas-journaliser"), false, "paramètres d'URL jamais journalisés");

    lignes.length = 0;
    const c = await gererRequete(ctx, req("POST", "/api/utilisateurs", { identifiant: "chef.test", motDePasse: "Secret-Tres-Prive-123", role: "responsable", servicesGeres: [SERVICE_ID] }, jeton));
    assert.equal(c.statut, 500);
    assert.equal(lignes.join("\n").includes("Secret-Tres-Prive-123"), false, "corps de requête jamais journalisé");
    assert.equal(lignes.join("\n").includes(jeton), false, "jeton jamais journalisé");
  } finally { console.error = original; }
});

test("erreur métier attendue (403, 400, 404) : aucune ligne de journal d'erreur serveur", async () => {
  const auth = new FauxAuth();
  const ctx = contextePersistant(auth);
  const jeton = ((await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "482915307" }))).corps as { jeton: string }).jeton;
  const lignes: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { lignes.push(a.map(String).join(" ")); };
  try {
    assert.equal((await gererRequete(ctx, req("PATCH", "/api/moi", { motDePasseActuel: "x", nouveauMotDePasse: "y" }, jeton))).statut, 403);
    assert.equal((await gererRequete(ctx, req("POST", "/api/utilisateurs", { identifiant: "a", motDePasse: "x", role: "responsable" }, jeton))).statut, 400);
  } finally { console.error = original; }
  assert.deepEqual(lignes, []);
});

// ---------- 5. Retrait (archivage) d'un message ----------

function fakePool(handler: (sql: string, values: readonly unknown[]) => ResultatPg = () => ({ rows: [], rowCount: 0 })) {
  const appels: { sql: string; values: readonly unknown[] }[] = [];
  const query = async (sql: string, values: readonly unknown[] = []) => { appels.push({ sql, values }); return handler(sql, values); };
  return { pool: { query, connect: async () => ({ query, release() {} }) } as unknown as PoolPg, appels };
}
const admin: Utilisateur = { id: ADMIN_ID, identifiant: "admin", hash: "", role: "administrateur", agentId: null, servicesGeres: [], actif: true };
const agent: Utilisateur = { id: AGENT_USER_ID, identifiant: "agent", hash: "", role: "brancardier", agentId: AGENT_ID, servicesGeres: [], actif: true };
const MESSAGE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

test("message : DELETE /api/messages/:id archive (administrateur seul), audit écrit, jamais de DELETE SQL", async () => {
  const f = fakePool((sql) => sql.includes("UPDATE messages_diffusion SET archive_le") ? { rows: [{ id: MESSAGE_ID, titre: "Urgent", portee: "tous", priorite: "urgente" }], rowCount: 1 } : { rows: [], rowCount: 1 });
  const ops = new OperationsPostgres(f.pool, SECRET);
  const r = await ops.gerer(req("DELETE", `/api/messages/${MESSAGE_ID}`), admin, NOW);
  assert.equal(r?.statut, 200);
  assert.equal((r?.corps as { archive: boolean }).archive, true);
  assert.ok(f.appels.some((a) => a.sql.includes("INSERT INTO journal_audit") && a.values.includes("message_archive")));
  assert.equal(f.appels.some((a) => /DELETE\s+FROM/i.test(a.sql)), false);

  const refus = fakePool();
  await assert.rejects(() => new OperationsPostgres(refus.pool, SECRET).gerer(req("DELETE", `/api/messages/${MESSAGE_ID}`), agent, NOW), /rôle ne permet pas/i);
  assert.equal(refus.appels.some((a) => a.sql.includes("UPDATE messages_diffusion")), false);
});

test("message : archivage idempotent (déjà archivé → 200) et identifiant inconnu → 404 ; identifiant mal formé → 400", async () => {
  const deja = fakePool((sql) => sql.includes("SELECT 1 FROM messages_diffusion WHERE id") ? { rows: [{ ok: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 });
  const r = await new OperationsPostgres(deja.pool, SECRET).gerer(req("DELETE", `/api/messages/${MESSAGE_ID}`), admin, NOW);
  assert.equal(r?.statut, 200);
  assert.equal((r?.corps as { dejaArchive: boolean }).dejaArchive, true);
  const inconnu = fakePool();
  await assert.rejects(() => new OperationsPostgres(inconnu.pool, SECRET).gerer(req("DELETE", `/api/messages/${MESSAGE_ID}`), admin, NOW), /introuvable/i);
  await assert.rejects(() => new OperationsPostgres(inconnu.pool, SECRET).gerer(req("DELETE", "/api/messages/pas-un-uuid"), admin, NOW), /invalide|uuid/i);
});

test("messagerie : une seule définition du ciblage (liste, lecture, vérification) et date de Dakar, jamais CURRENT_DATE", async () => {
  const f = fakePool();
  const ops = new OperationsPostgres(f.pool, SECRET);
  await ops.gerer(req("GET", "/api/messages"), agent, NOW);
  await assert.rejects(() => ops.gerer(req("POST", `/api/messages/${MESSAGE_ID}/lu`, {}), agent, NOW));
  const sqls = f.appels.map((a) => a.sql).filter((s) => s.includes("messages_services_destinataires"));
  assert.ok(sqls.length >= 3, "liste + lecture + vérification");
  assert.ok(sqls.every((x) => x.includes(sqlMessageVisiblePour("$1")) || x.includes(sqlMessageVisiblePour("$2"))), "chaque requête reprend exactement le fragment partagé");
  assert.ok(f.appels.every((a) => !/CURRENT_DATE/.test(a.sql)), "pas de CURRENT_DATE");
  assert.ok(sqls.every((s) => s.includes("Africa/Dakar")));
  const liste = f.appels.find((a) => a.sql.includes("FROM messages_diffusion m") && a.sql.includes("ORDER BY"))!;
  assert.deepEqual(liste.values, [AGENT_USER_ID, false, false], "un agent n'inclut jamais les messages archivés");
  const listeAdmin = fakePool();
  await new OperationsPostgres(listeAdmin.pool, SECRET).gerer(req("GET", "/api/messages", undefined, undefined, { archives: "1" }), admin, NOW);
  assert.deepEqual(listeAdmin.appels.find((a) => a.sql.includes("ORDER BY"))!.values, [ADMIN_ID, true, true]);
  const listeAgentArchives = fakePool();
  await new OperationsPostgres(listeAgentArchives.pool, SECRET).gerer(req("GET", "/api/messages", undefined, undefined, { archives: "1" }), agent, NOW);
  assert.deepEqual(listeAgentArchives.appels.find((a) => a.sql.includes("ORDER BY"))!.values, [AGENT_USER_ID, false, false], "?archives=1 ignoré pour un non-administrateur");
});

// ---------- 2 (suite). Création automatique du compte agent ----------

function poolCatalogue(opts: { telephone: string | null; matricule: string | null; compteExistant?: boolean; identifiantPris?: boolean }) {
  const f = fakePool((sql) => {
    if (sql.includes("FROM services WHERE id=$1::uuid AND actif")) return { rows: [{ id: SERVICE_ID }], rowCount: 1 };
    if (sql.includes("(now() AT TIME ZONE 'Africa/Dakar')::date::text AS today")) return { rows: [{ today: "2026-10-22" }], rowCount: 1 };
    if (sql.includes("FROM agents a") && sql.includes("WHERE a.id=$1::uuid")) return { rows: [{ id: AGENT_ID, prenom: "Awa", nom: "Diop", matricule: opts.matricule, actif: true, photoDataUrl: null, profession: null, adresse: null, telephone: opts.telephone, serviceId: SERVICE_ID, service: "Kinésie", regime: "general" }], rowCount: 1 };
    if (sql.includes("SELECT user_id FROM profiles WHERE agent_id")) return opts.compteExistant ? { rows: [{ user_id: AGENT_USER_ID }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (sql.includes("SELECT 1 FROM identifiants_application WHERE lower(identifiant)")) return opts.identifiantPris ? { rows: [{ x: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
  return f;
}
const SAISIE = { prenom: "Awa", nom: "Diop", serviceId: SERVICE_ID, regime: "general" as const };

// Depuis la v32 (audit v31 F-02) le mode par défaut est « aleatoire » : ces deux tests vérifient explicitement le mode « telephone ».
async function modeTelephone<T>(f: () => Promise<T>): Promise<T> {
  const avant = process.env.FANN_MDP_PROVISOIRE;
  process.env.FANN_MDP_PROVISOIRE = "telephone";
  try { return await f(); } finally { if (avant === undefined) delete process.env.FANN_MDP_PROVISOIRE; else process.env.FANN_MDP_PROVISOIRE = avant; }
}

test("création d'un agent : compte créé dans la même transaction (identifiant = matricule, mot de passe = téléphone en chiffres, changement obligatoire, mode telephone)", () => modeTelephone(async () => {
  const f = poolCatalogue({ telephone: "+221 77 123 45 67", matricule: "MAT-4521" });
  const r = await new DepotCataloguePostgres(f.pool).creerAgent({ ...SAISIE, matricule: "MAT-4521", telephone: "+221 77 123 45 67" }, ADMIN_ID, "127.0.0.1");
  assert.deepEqual(r.compteAgent, { cree: true, identifiant: "mat-4521" });
  const sqls = f.appels.map((a) => a.sql);
  assert.equal(sqls[0], "BEGIN");
  assert.equal(sqls.at(-1), "COMMIT");
  const profil = f.appels.find((a) => a.sql.includes("INSERT INTO profiles"))!;
  const idAgentInsere = f.appels.find((a) => a.sql.includes("INSERT INTO agents"))!.values[0];
  assert.ok(profil.sql.includes("'brancardier'") && profil.values[1] === idAgentInsere, "profil lié à l'agent créé dans la même transaction");
  const cred = f.appels.find((a) => a.sql.includes("INSERT INTO identifiants_application"))!;
  assert.ok(cred.sql.includes("doit_changer_mot_de_passe") && cred.sql.includes(", true)"), "changement obligatoire");
  assert.equal(cred.values[1], "mat-4521");
  assert.ok(verifierMotDePasse("771234567", String(cred.values[2])), "mot de passe provisoire = téléphone normalisé");
  assert.equal(f.appels.some((a) => a.values.includes("771234567") || a.values.includes("+221 77 123 45 67") && a.sql.includes("journal_audit")), false, "aucun mot de passe dans l'audit");
  assert.ok(f.appels.some((a) => a.sql.includes("INSERT INTO journal_audit") && a.values.includes("compte_agent_cree_automatiquement")));
}));

test("création d'un agent : pas de compte sans téléphone, sans matricule, avec identifiant déjà pris ou compte déjà lié — la fiche est créée quand même (mode telephone)", () => modeTelephone(async () => {
  const cas: [Parameters<typeof poolCatalogue>[0], string][] = [
    [{ telephone: null, matricule: "MAT-4521" }, "telephone_absent"],
    [{ telephone: "1234", matricule: "MAT-4521" }, "telephone_absent"],
    [{ telephone: "771234567", matricule: null }, "matricule_absent"],
    [{ telephone: "771234567", matricule: "ab" }, "matricule_trop_court"],
    [{ telephone: "771234567", matricule: "MAT-4521", identifiantPris: true }, "identifiant_deja_utilise"],
    [{ telephone: "771234567", matricule: "MAT-4521", compteExistant: true }, "deja_existant"],
  ];
  for (const [opts, raison] of cas) {
    const f = poolCatalogue(opts);
    const r = await new DepotCataloguePostgres(f.pool).creerAgent({ ...SAISIE, matricule: opts.matricule, telephone: opts.telephone }, ADMIN_ID, "127.0.0.1");
    assert.deepEqual(r.compteAgent, { cree: false, raison }, JSON.stringify(opts));
    assert.ok(f.appels.some((a) => a.sql.includes("INSERT INTO agents")), "fiche agent créée");
    assert.equal(f.appels.some((a) => a.sql.includes("INSERT INTO identifiants_application")), false);
    assert.equal(f.appels.at(-1)!.sql, "COMMIT");
  }
}));

test("POST /api/agents : la réponse indique le compte créé, sans mot de passe ; POST /api/comptes-agents réservé à l'administrateur", async () => {
  const auth = new FauxAuth();
  const ctx = contextePersistant(auth);
  ctx.cataloguePersistant = {
    listerAgents: async () => [], listerServices: async () => [],
    creerAgent: async () => ({ id: AGENT_ID, prenom: "Awa", nom: "Diop", matricule: "MAT-4521", serviceId: SERVICE_ID, service: "Kinésie", regime: "general" as const, actif: true, profession: null, adresse: null, telephone: "+221 77 123 45 67", compteAgent: { cree: true as const, identifiant: "mat-4521" } }),
    modifierAgent: async () => { throw new Error("non utilisé"); }, creerService: async () => { throw new Error("non utilisé"); }, modifierService: async () => { throw new Error("non utilisé"); },
    creerComptesAgentsManquants: async () => ({ crees: 2, ignores: [{ agentId: AGENT_ID, prenom: "Awa", nom: "Diop", raison: "telephone_absent" }] }),
  };
  const jeton = ((await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "482915307" }))).corps as { jeton: string }).jeton;
  const r = await gererRequete(ctx, req("POST", "/api/agents", { prenom: "Awa", nom: "Diop", matricule: "MAT-4521", serviceId: SERVICE_ID, regime: "general", telephone: "+221 77 123 45 67" }, jeton));
  assert.equal(r.statut, 201);
  const corps = r.corps as { compteAgent: { cree: boolean }; message: string; agent: Record<string, unknown> };
  assert.equal(corps.compteAgent.cree, true);
  assert.match(corps.message, /mat-4521/);
  assert.equal("compteAgent" in corps.agent, false);
  assert.equal(JSON.stringify(r.corps).includes("771234567"), false, "mot de passe provisoire jamais renvoyé");
  const rattrapage = await gererRequete(ctx, req("POST", "/api/comptes-agents", {}, jeton));
  assert.equal(rattrapage.statut, 200);
  assert.equal((rattrapage.corps as { crees: number }).crees, 2);
  assert.equal((await gererRequete(ctx, req("GET", "/api/comptes-agents", undefined, jeton))).statut, 405);
});

test("route inconnue en mode PostgreSQL : 404 (pas 503) ; une route connue non migrée reste 503", async () => {
  const auth = new FauxAuth();
  const ctx = contextePersistant(auth);
  const jeton = ((await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "482915307" }))).corps as { jeton: string }).jeton;
  assert.equal((await gererRequete(ctx, req("GET", "/api/route-inconnue", undefined, jeton))).statut, 404);
  assert.equal((await gererRequete(ctx, req("GET", "/api/n-importe/quoi", undefined, jeton))).statut, 404);
  assert.equal((await gererRequete(ctx, req("GET", "/api/messages", undefined, jeton))).statut, 503, "route connue mais dépôt non raccordé dans ce contexte de test");
});
