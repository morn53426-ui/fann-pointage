import { test } from "node:test";
import assert from "node:assert/strict";
import { OperationsPostgres } from "./operations-postgres.ts";
import type { Utilisateur } from "./magasin.ts";
import type { PoolPg, ResultatPg } from "../pointage/postgres.ts";
import type { Requete } from "./routes.ts";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const ABSENCE_ID = "44444444-4444-4444-8444-444444444444";
const admin: Utilisateur = { id: ADMIN_ID, identifiant: "admin", hash: "", role: "administrateur", agentId: null, servicesGeres: [], actif: true };
const responsable: Utilisateur = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", identifiant: "responsable", hash: "", role: "responsable", agentId: null, servicesGeres: [SERVICE_ID], actif: true };
const brancardier: Utilisateur = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", identifiant: "agent", hash: "", role: "brancardier", agentId: AGENT_ID, servicesGeres: [], actif: true };
const now = new Date("2026-10-14T12:00:00Z");
const secret = "fann-test-secret-long-and-random-0123456789";
function req(methode: string, chemin: string, corps: unknown = undefined, requete: Record<string, string> = {}): Requete {
  return { methode, chemin, requete, corps, entetes: {}, ip: "127.0.0.1" };
}
function fakePool(handler: (sql: string, values: readonly unknown[]) => ResultatPg = () => ({ rows: [], rowCount: 0 })) {
  const appels: { sql: string; values: readonly unknown[] }[] = [];
  const query = async (sql: string, values: readonly unknown[] = []) => {
    appels.push({ sql, values });
    return handler(sql, values);
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as PoolPg;
  return { pool, appels };
}

const agentLigne = { id: AGENT_ID, serviceId: SERVICE_ID };

test("absences PostgreSQL : brancardier refusé avant toute requête SQL", async () => {
  const f = fakePool();
  const ops = new OperationsPostgres(f.pool, secret);
  await assert.rejects(() => ops.gerer(req("GET", "/api/absences"), brancardier, now), /Votre rôle ne permet pas/);
  await assert.rejects(() => ops.gerer(req("POST", "/api/absences", { agentId: AGENT_ID, debut: "2026-10-01", fin: "2026-10-01", categorie: "absence" }), brancardier, now), /Votre rôle ne permet pas/);
  assert.equal(f.appels.length, 0);
});

test("absences PostgreSQL : le responsable ne peut pas enregistrer une absence hors périmètre", async () => {
  const f = fakePool((sql) => sql.includes("FROM agents a JOIN LATERAL") ? { rows: [{ ...agentLigne, serviceId: "55555555-5555-4555-8555-555555555555" }], rowCount: 1 } : { rows: [], rowCount: 1 });
  const ops = new OperationsPostgres(f.pool, secret);
  await assert.rejects(() => ops.gerer(req("POST", "/api/absences", { agentId: AGENT_ID, debut: "2026-10-01", fin: "2026-10-02", categorie: "absence" }), responsable, now), /hors de votre périmètre/);
  assert.equal(f.appels.some((a) => a.sql.includes("INSERT INTO absences_anomalies")), false);
});

test("absences PostgreSQL : création transactionnelle, note nettoyée, statut initial sans impact score", async () => {
  const f = fakePool((sql) => {
    if (sql.includes("FROM agents a JOIN LATERAL")) return { rows: [{ ...agentLigne }], rowCount: 1 };
    if (sql.includes("INSERT INTO absences_anomalies")) return { rows: [{ id: ABSENCE_ID, creeLe: now }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const ops = new OperationsPostgres(f.pool, secret);
  const response = await ops.gerer(req("POST", "/api/absences", { agentId: AGENT_ID, debut: "2026-10-01", fin: "2026-10-03", categorie: "congé", note: "  Congé familial\nà traiter  " }), admin, now);
  assert.equal(response?.statut, 201);
  const result = response?.corps as { absence: Record<string, unknown>; message: string };
  assert.equal(result.absence.statut, "a_confirmer");
  assert.equal(result.absence.note, "Congé familial à traiter");
  const insert = f.appels.find((a) => a.sql.includes("INSERT INTO absences_anomalies"));
  assert.ok(insert);
  assert.match(insert.sql, /'a_confirmer', NULL, NULL, NULL, false/);
  assert.ok(f.appels.some((a) => a.sql.includes("INSERT INTO journal_audit") && a.values.includes("127.0.0.1")));
  assert.ok(f.appels.some((a) => a.sql === "COMMIT"));
});

test("absences PostgreSQL : décision motivée atomique et impact de score uniquement si injustifiée", async () => {
  const f = fakePool((sql) => {
    if (sql.includes("FROM absences_anomalies WHERE id=$1::uuid FOR UPDATE")) return { rows: [{ id: ABSENCE_ID, agentId: AGENT_ID, serviceId: SERVICE_ID, statut: "a_confirmer", debut: "2026-10-01", fin: "2026-10-02", categorie: "absence", creePar: ADMIN_ID, creeLe: now }], rowCount: 1 };
    if (sql.includes("UPDATE absences_anomalies SET statut")) return { rows: [{ statut: "injustifiee", validePar: ADMIN_ID, valideLe: now, motifValidation: "Aucun justificatif fourni" }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const ops = new OperationsPostgres(f.pool, secret);
  const response = await ops.gerer(req("PATCH", `/api/absences/${ABSENCE_ID}`, { statut: "injustifiee", motif: "Aucun justificatif fourni" }), admin, now);
  assert.equal(response?.statut, 200);
  const update = f.appels.find((a) => a.sql.includes("UPDATE absences_anomalies SET statut"));
  assert.ok(update);
  assert.match(update.sql, /impact_score=\(\$2::statut_absence='injustifiee'::statut_absence\)/);
  assert.deepEqual(update.values.slice(0, 3), [ABSENCE_ID, "injustifiee", ADMIN_ID]);
  assert.ok(f.appels.some((a) => a.sql === "COMMIT"));
});

test("absences PostgreSQL : une absence déjà décidée ne peut pas être réécrite", async () => {
  const f = fakePool((sql) => sql.includes("FROM absences_anomalies WHERE id=$1::uuid FOR UPDATE") ? { rows: [{ id: ABSENCE_ID, agentId: AGENT_ID, serviceId: SERVICE_ID, statut: "justifiee", debut: "2026-10-01", fin: "2026-10-02", categorie: "absence", creeLe: now }], rowCount: 1 } : { rows: [], rowCount: 1 });
  const ops = new OperationsPostgres(f.pool, secret);
  await assert.rejects(() => ops.gerer(req("PATCH", `/api/absences/${ABSENCE_ID}`, { statut: "injustifiee", motif: "Nouvelle décision non permise" }), admin, now), /déjà fait l’objet d’une décision/);
  assert.equal(f.appels.some((a) => a.sql.includes("UPDATE absences_anomalies SET statut")), false);
});

test("rapports PostgreSQL : brancardier reste limité à son propre agent et ne reçoit jamais les coordonnées précises", async () => {
  const f = fakePool((sql) => {
    if (sql.includes("WITH postes AS")) return { rows: [{ id: "p-1", agent_id: AGENT_ID, starts_at: new Date("2026-10-14T08:00:00Z"), ends_at: new Date("2026-10-14T16:00:00Z"), agent_nom: "Diop", agent_prenom: "Awa", matricule: "M-1", service: "Urgences", regime: "urgences", type_poste: "jour", arrivee: new Date("2026-10-14T08:02:00Z"), depart: new Date("2026-10-14T16:00:00Z"), a_verifier: false, refuse: false, position_suspecte: false, validation_manuelle: false, motif_validation_manuelle: null, statut_localisation: "dans_zone", distance_m: 12, precision_m: 6, latitude: 14.69, longitude: -17.45, retard_min: 0, depart_anticipe_min: 0, duree_reelle_min: 478, statut_presence: "complet" }], rowCount: 1 };
    throw new Error(`Requête inattendue : ${sql}`);
  });
  const ops = new OperationsPostgres(f.pool, secret);
  const response = await ops.gerer(req("GET", "/api/rapports", undefined, { type: "jour", date: "2026-10-14" }), brancardier, now);
  assert.equal(response?.statut, 200);
  const rapport = response?.corps as { lignes: Array<Record<string, unknown>>; synthese: unknown; periode: { libelle: string } };
  assert.equal(rapport.lignes.length, 1);
  assert.equal(rapport.lignes[0]?.agentId, AGENT_ID);
  assert.equal(rapport.lignes[0]?.latitude, null);
  assert.equal(rapport.lignes[0]?.longitude, null);
  assert.equal(rapport.synthese, undefined);
  assert.equal(rapport.periode.libelle, "2026-10-14");
  const sql = f.appels[0]?.sql ?? "";
  assert.match(sql, /p\.agent_id=\$\d+::uuid/);
  assert.ok(f.appels[0]?.values.includes(AGENT_ID));
});

test("rapports PostgreSQL : le format CSV est généré depuis les données persistantes", async () => {
  const f = fakePool((sql) => sql.includes("WITH postes AS") ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 0 });
  const ops = new OperationsPostgres(f.pool, secret);
  const response = await ops.gerer(req("GET", "/api/rapports", undefined, { type: "mois", date: "2026-09-09", format: "csv" }), admin, now);
  assert.equal(response?.statut, 200);
  assert.equal(response?.typeContenu, "text/csv; charset=utf-8");
  assert.match(response?.entetes?.["Content-Disposition"] ?? "", /pointages-/);
  assert.match(response?.texte ?? "", /Nom;Prénom/);
});

test("émargement PostgreSQL : feuilles lues dans la base, périmètre du responsable, export xlsx, brancardier refusé", async () => {
  const AUTRE_SERVICE = "55555555-5555-4555-8555-555555555555";
  const f = fakePool((sql) => {
    if (sql.includes("FROM agents a JOIN LATERAL")) return { rows: [
      { id: AGENT_ID, prenom: "Awa", nom: "Diop", actif: true, serviceId: SERVICE_ID, regime: "general" },
      { id: "66666666-6666-4666-8666-666666666666", prenom: "Ali", nom: "Fall", actif: true, serviceId: AUTRE_SERVICE, regime: "garde" },
    ], rowCount: 2 };
    if (sql.includes("FROM services WHERE actif")) return { rows: [{ id: SERVICE_ID, nom: "Imagerie" }, { id: AUTRE_SERVICE, nom: "ORL" }], rowCount: 2 };
    if (sql.includes("FROM plannings p")) return { rows: [{ agentId: AGENT_ID, debut: new Date("2026-10-14T08:00:00Z"), regime: "general", type: "service" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const ops = new OperationsPostgres(f.pool, secret);
  await assert.rejects(() => ops.gerer(req("GET", "/api/emargement"), brancardier, now), /Votre rôle ne permet pas/);
  const adminRep = await ops.gerer(req("GET", "/api/emargement", undefined, { date: "2026-10-14" }), admin, now);
  assert.equal(adminRep?.statut, 200);
  const toutes = adminRep?.corps as { debut: string; services: { service: string; agents: { jours: string[] }[] }[] };
  assert.equal(toutes.debut, "2026-10-12");
  assert.equal(toutes.services.length, 2);
  assert.equal(toutes.services.find((s) => s.service === "Imagerie")!.agents[0]!.jours[2], "poste"); // mercredi 14/10
  const resp = await ops.gerer(req("GET", "/api/emargement", undefined, { date: "2026-10-14" }), responsable, now);
  assert.deepEqual((resp?.corps as { services: { service: string }[] }).services.map((s) => s.service), ["Imagerie"]);
  const xlsx = await ops.gerer(req("GET", "/api/emargement", undefined, { date: "2026-10-14", format: "xlsx" }), admin, now);
  assert.equal(xlsx?.statut, 200);
  assert.equal((xlsx?.corps as { nomFichier: string }).nomFichier, "emargement-brancardiers-2026-10-12.xlsx");
  await assert.rejects(() => ops.gerer(req("GET", "/api/emargement", undefined, { date: "2026-13-45" }), admin, now), /Date invalide/);
});

test("tableau de bord PostgreSQL : filtre régime/service appliqué, seuil de retard de 20 min dans le SQL, régime inconnu refusé", async () => {
  const f = fakePool();
  const ops = new OperationsPostgres(f.pool, secret);
  const rep = await ops.gerer(req("GET", "/api/tableau-de-bord", undefined, { regime: "garde", service: SERVICE_ID }), admin, now);
  assert.equal(rep?.statut, 200);
  const sqlPostes = f.appels.find((a) => a.sql.includes("WITH poste AS"));
  assert.ok(sqlPostes);
  assert.match(sqlPostes!.sql, /p\.regime=\$2::regime_code/);
  assert.match(sqlPostes!.sql, /s\.id=\$3::uuid/);
  assert.deepEqual(sqlPostes!.values, [now, "garde", SERVICE_ID]);
  // Un responsable reste limité à ses services, le filtre de régime s'ajoute au périmètre.
  const f2 = fakePool(); const ops2 = new OperationsPostgres(f2.pool, secret);
  await ops2.gerer(req("GET", "/api/tableau-de-bord", undefined, { regime: "urgences" }), responsable, now);
  const sql2 = f2.appels.find((a) => a.sql.includes("WITH poste AS"))!;
  assert.match(sql2.sql, /s\.id=ANY\(\$2::uuid\[\]\) AND p\.regime=\$3::regime_code/);
  assert.deepEqual(sql2.values, [now, [SERVICE_ID], "urgences"]);
  await assert.rejects(() => ops.gerer(req("GET", "/api/tableau-de-bord", undefined, { regime: "inconnu" }), admin, now), /Régime inconnu/);
  const g = fakePool(); const o3 = new OperationsPostgres(g.pool, secret);
  await o3.gerer(req("GET", "/api/rapports", undefined, { type: "jour", date: "2026-10-14" }), admin, now);
  assert.ok(g.appels.some((a) => a.sql.includes("interval '20 minutes'")), "le rapport doit utiliser la tolérance de 20 min");
  assert.ok(g.appels.every((a) => !a.sql.includes("${")), "aucune interpolation JavaScript ne doit rester dans le SQL");
});
