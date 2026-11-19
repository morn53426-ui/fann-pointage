import { test } from "node:test";
import assert from "node:assert/strict";
import { DepotAuthentificationPostgres, type NouveauComptePersistant } from "./auth-postgres.ts";
import type { ClientPg, PoolPg, ResultatPg } from "../pointage/postgres.ts";

const ID = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const SERVICE = "33333333-3333-4333-8333-333333333333";
const HASH = `scrypt$${"s".repeat(22)}$${"h".repeat(43)}`;
const compte = (o: Record<string, unknown> = {}) => ({
  id: ID, identifiant: "admin", hash: HASH, role: "administrateur", agentId: null, actif: true,
  sessionVersion: 0, servicesGeres: [], doitChangerMotDePasse: false, provisoireDepuis: null, ...o,
});

class FakePg implements PoolPg {
  calls: { sql: string; values: readonly unknown[] }[] = [];
  responses: ((sql: string, values: readonly unknown[]) => ResultatPg | undefined)[] = [];
  failure: ((sql: string, values: readonly unknown[]) => unknown | null) | null = null;
  released = 0;

  private async run(sql: string, values: readonly unknown[] = []): Promise<ResultatPg> {
    this.calls.push({ sql: sql.trim(), values });
    const thrown = this.failure?.(sql, values);
    if (thrown) throw thrown;
    for (const fn of this.responses) {
      const result = fn(sql, values);
      if (result !== undefined) return result;
    }
    return { rows: [], rowCount: 0 };
  }
  async query(sql: string, values: readonly unknown[] = []): Promise<ResultatPg> { return this.run(sql, values); }
  async connect(): Promise<ClientPg> {
    return { query: (sql, values = []) => this.run(sql, values), release: () => { this.released += 1; } };
  }
}

const nouveau = (o: Partial<NouveauComptePersistant> = {}): NouveauComptePersistant => ({ identifiant: " Administrateur ", hash: HASH, role: "administrateur", agentId: null, ...o });

 test("auth PostgreSQL : recherche de compte insensible à la casse, paramétrée et sans filtrer un compte désactivé", async () => {
  const db = new FakePg();
  db.responses.push((sql) => /FROM profiles p[\s\S]*WHERE lower\(btrim\(c\.identifiant\)\) = \$1/i.test(sql)
    ? { rows: [compte({ identifiant: "admin", actif: false, sessionVersion: 7 })], rowCount: 1 } : undefined);
  const repo = new DepotAuthentificationPostgres(db);
  assert.deepEqual(await repo.parIdentifiant("  ADMIN  "), compte({ identifiant: "admin", actif: false, sessionVersion: 7 }));
  assert.equal(db.calls[0].values[0], "admin");
  assert.match(db.calls[0].sql, /JOIN identifiants_application/);
  assert.match(db.calls[0].sql, /responsable_services/);
});

test("auth PostgreSQL : identifiant trop long ignoré sans aller en base", async () => {
  const db = new FakePg();
  assert.equal(await new DepotAuthentificationPostgres(db).parIdentifiant("x".repeat(161)), null);
  assert.equal(db.calls.length, 0);
});

test("auth PostgreSQL : refuser UUID mal formé sans requête", async () => {
  const db = new FakePg();
  const repo = new DepotAuthentificationPostgres(db);
  assert.equal(await repo.parId("not-an-uuid"), null);
  assert.equal(await repo.revoquerSessions("not-an-uuid"), false);
  assert.equal(db.calls.length, 0);
});

test("auth PostgreSQL : création atomique d'un compte et de ses services, sans écrire un secret en clair", async () => {
  const db = new FakePg();
  db.responses.push((sql, values) => /SELECT id::text AS id FROM services WHERE actif AND id = ANY/i.test(sql)
    ? { rows: (values[0] as string[]).map((id) => ({ id })), rowCount: (values[0] as string[]).length } : undefined);
  db.responses.push((sql) => /SELECT p\.user_id::text AS id[\s\S]*GROUP BY/i.test(sql)
    ? { rows: [compte({ id: db.calls.find((x) => /INSERT INTO profiles/i.test(x.sql))?.values[0], identifiant: "chef", role: "responsable", agentId: null, servicesGeres: [SERVICE], sessionVersion: 0 })], rowCount: 1 } : undefined);
  const repo = new DepotAuthentificationPostgres(db);
  const result = await repo.creer(nouveau({ identifiant: " Chef ", role: "responsable", servicesGeres: [SERVICE, SERVICE] }));
  assert.equal(result.identifiant, "chef");
  assert.equal(result.role, "responsable");
  assert.deepEqual(result.servicesGeres, [SERVICE]);
  const sql = db.calls.map((x) => x.sql);
  assert.equal(sql[0], "BEGIN");
  assert.ok(sql.some((s) => /INSERT INTO profiles/i.test(s)));
  assert.ok(sql.some((s) => /INSERT INTO identifiants_application/i.test(s)));
  assert.ok(sql.some((s) => /INSERT INTO responsable_services[\s\S]*unnest/i.test(s)));
  assert.ok(sql.some((s) => /INSERT INTO journal_audit/i.test(s)));
  assert.equal(sql.at(-1), "COMMIT");
  assert.ok(db.calls.every((c) => !c.sql.includes(HASH)), "aucune valeur utilisateur ne doit être concaténée dans le SQL");
  const credentialInsert = db.calls.find((x) => /INSERT INTO identifiants_application/i.test(x.sql));
  assert.deepEqual(credentialInsert?.values.slice(1), ["chef", HASH, false]);
  assert.equal(db.released, 1);
});

test("auth PostgreSQL : compte brancardier sans agent refusé avant transaction", async () => {
  const db = new FakePg();
  await assert.rejects(new DepotAuthentificationPostgres(db).creer(nouveau({ role: "brancardier", agentId: null })), /lié à une fiche agent/);
  assert.equal(db.calls.length, 0);
});

test("auth PostgreSQL : échec de création restaure toute la transaction", async () => {
  const db = new FakePg();
  db.failure = (sql) => /INSERT INTO identifiants_application/i.test(sql) ? new Error("injected failure") : null;
  await assert.rejects(new DepotAuthentificationPostgres(db).creer(nouveau()), /injected failure/);
  assert.ok(db.calls.some((x) => x.sql === "ROLLBACK"));
  assert.ok(!db.calls.some((x) => x.sql === "COMMIT"));
  assert.equal(db.released, 1);
});

test("auth PostgreSQL : changement de mot de passe modifie uniquement le hash et révoque les sessions", async () => {
  const db = new FakePg();
  db.responses.push((sql) => /UPDATE identifiants_application SET mot_de_passe_hash/i.test(sql) ? { rows: [{ user_id: ID }], rowCount: 1 } : undefined);
  const repo = new DepotAuthentificationPostgres(db);
  assert.equal(await repo.changerMotDePasse(ID, HASH), true);
  assert.ok(db.calls.some((c) => /UPDATE identifiants_application SET mot_de_passe_hash/i.test(c.sql) && /session_version = session_version \+ 1/.test(c.sql)));
  assert.deepEqual(db.calls.find((c) => /UPDATE identifiants_application SET mot_de_passe_hash/i.test(c.sql))?.values, [ID, HASH]);
  const audit = db.calls.find((c) => /INSERT INTO journal_audit/i.test(c.sql));
  if (!audit) throw new Error("Le changement de mot de passe doit être audité.");
  assert.doesNotMatch(String(audit.values[3]), /scrypt\$/i, "le hash ne doit jamais entrer dans le journal");
  assert.ok(db.calls.some((c) => c.sql === "COMMIT"));
  const count = db.calls.length;
  await assert.rejects(repo.changerMotDePasse(ID, "mot-de-passe-clair"), /Hash scrypt invalide/);
  assert.equal(db.calls.length, count);
  assert.equal(db.released, 1);
});

test("auth PostgreSQL : révocation de sessions incrémente la version", async () => {
  const db = new FakePg();
  db.responses.push((sql) => /UPDATE identifiants_application SET session_version/i.test(sql) ? { rows: [{ user_id: ID }], rowCount: 1 } : undefined);
  assert.equal(await new DepotAuthentificationPostgres(db).revoquerSessions(ID), true);
  const update = db.calls.find((c) => /UPDATE identifiants_application SET session_version/i.test(c.sql));
  if (!update) throw new Error("La mise à jour de version de session est absente.");
  assert.match(update.sql, /session_version = session_version \+ 1/);
  assert.equal(update.values[0], ID);
  assert.ok(db.calls.some((c) => /INSERT INTO journal_audit/i.test(c.sql)));
  assert.ok(db.calls.some((c) => c.sql === "COMMIT"));
  assert.equal(db.released, 1);
});

test("auth PostgreSQL : désactivation et révocation sont atomiques", async () => {
  const db = new FakePg();
  db.responses.push((sql) => /SELECT user_id FROM profiles WHERE role = 'administrateur'/i.test(sql)
    ? { rows: [{ user_id: ID }, { user_id: AGENT }], rowCount: 2 } : undefined);
  db.responses.push((sql) => /SELECT p\.role::text AS role, p\.actif/i.test(sql)
    ? { rows: [{ role: "administrateur", actif: true, agentId: null }], rowCount: 1 } : undefined);
  db.responses.push((sql) => /SELECT p\.user_id::text AS id[\s\S]*GROUP BY/i.test(sql)
    ? { rows: [compte({ actif: false, sessionVersion: 1 })], rowCount: 1 } : undefined);
  assert.equal(await new DepotAuthentificationPostgres(db).desactiver(ID, AGENT, "127.0.0.1"), true);
  const sql = db.calls.map((c) => c.sql);
  assert.deepEqual(sql.filter((s) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(s)), ["BEGIN", "COMMIT"]);
  assert.ok(sql.some((s) => /UPDATE profiles SET actif = \$2/i.test(s)));
  assert.ok(sql.some((s) => /session_version = session_version \+ 1/i.test(s)));
  const audit = db.calls.find((c) => /INSERT INTO journal_audit/i.test(c.sql));
  assert.equal(audit?.values[0], AGENT);
  assert.equal(audit?.values[6], "127.0.0.1");
  assert.equal(db.released, 1);
});

test("auth PostgreSQL : le dernier administrateur ne peut pas être désactivé", async () => {
  const db = new FakePg();
  db.responses.push((sql) => /SELECT user_id FROM profiles WHERE role = 'administrateur'/i.test(sql)
    ? { rows: [{ user_id: ID }], rowCount: 1 } : undefined);
  db.responses.push((sql) => /SELECT p\.role::text AS role, p\.actif/i.test(sql)
    ? { rows: [{ role: "administrateur", actif: true, agentId: null }], rowCount: 1 } : undefined);
  await assert.rejects(new DepotAuthentificationPostgres(db).modifierCompte(ID, { actif: false }, AGENT), /dernier compte administrateur/);
  assert.ok(db.calls.some((c) => c.sql === "ROLLBACK"));
  assert.ok(!db.calls.some((c) => /UPDATE profiles SET actif/i.test(c.sql)));
});

test("auth PostgreSQL : liste des comptes bornée et triée depuis PostgreSQL", async () => {
  const db = new FakePg();
  db.responses.push((sql) => /GROUP BY p\.user_id, c\.user_id ORDER BY lower\(c\.identifiant\)/i.test(sql)
    ? { rows: [compte({ identifiant: "admin" }), compte({ id: AGENT, identifiant: "resp", role: "responsable", servicesGeres: [SERVICE] })], rowCount: 2 } : undefined);
  const liste = await new DepotAuthentificationPostgres(db).lister();
  assert.deepEqual(liste.map((x) => x.identifiant), ["admin", "resp"]);
  assert.match(db.calls[0].sql, /ORDER BY lower\(c\.identifiant\)/i);
  assert.equal(db.calls[0].values.length, 0);
});


test("auth PostgreSQL : l’administrateur voit uniquement les services actifs", async () => {
  const db = new FakePg();
  db.responses.push((sql) => /SELECT id::text AS id, nom FROM services WHERE actif ORDER BY nom/i.test(sql)
    ? { rows: [{ id: SERVICE, nom: "Neuro" }, { id: AGENT, nom: "Urgences" }], rowCount: 2 } : undefined);
  const repo = new DepotAuthentificationPostgres(db);
  assert.deepEqual(await repo.servicesVisibles(compte() as never), [
    { id: SERVICE, nom: "Neuro" }, { id: AGENT, nom: "Urgences" },
  ]);
  assert.match(db.calls[0].sql, /WHERE actif ORDER BY nom/);
});

test("auth PostgreSQL : un responsable ne reçoit que ses services affectés", async () => {
  const db = new FakePg();
  db.responses.push((sql) => /JOIN responsable_services rs ON rs.service_id = s.id/i.test(sql)
    ? { rows: [{ id: SERVICE, nom: "Neuro" }], rowCount: 1 } : undefined);
  const repo = new DepotAuthentificationPostgres(db);
  assert.deepEqual(await repo.servicesVisibles(compte({ role: "responsable", servicesGeres: [SERVICE] }) as never), [
    { id: SERVICE, nom: "Neuro" },
  ]);
  assert.deepEqual(db.calls[0].values, [ID]);
  assert.match(db.calls[0].sql, /rs\.user_id = \$1::uuid AND s\.actif/);
});
