import { test } from "node:test";
import assert from "node:assert/strict";
import { OperationsPostgres } from "./operations-postgres.ts";
import type { Utilisateur } from "./magasin.ts";
import type { PoolPg, ResultatPg } from "../pointage/postgres.ts";
import type { Requete } from "./routes.ts";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
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

test("PostgreSQL planning Mobil : garde normale 16 h–08 h et contrôle les 56 h de repos", async () => {
  let numero = 0;
  const f = fakePool((sql, values) => {
    if (sql.includes("FROM agents a JOIN LATERAL")) return { rows: [{ id: AGENT_ID, prenom: "Awa", nom: "Mobil", actif: true, serviceId: SERVICE_ID, regime: "mobil", service: "Mobile" }], rowCount: 1 };
    if (sql.includes("SELECT date_ferie::text AS date FROM jours_feries")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM plannings") && sql.includes("WHERE agent_id=$1::uuid")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("INSERT INTO plannings")) {
      numero++;
      return { rows: [{ planningId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(numero).padStart(12, "0")}`, posteId: values[0], debut: values[5], fin: values[6], type: values[4] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const ops = new OperationsPostgres(f.pool, secret);
  const result = await ops.gerer(req("POST", "/api/plannings", { agentId: AGENT_ID, dateDebut: "2026-10-12", dateFin: "2026-10-18", equipeMobil: "nuit", groupeNuitMobil: "A" }), admin, now);
  assert.equal(result?.statut, 201);
  const postes = (result?.corps as { postes: Array<{ debut: string; fin: string; type: string }> }).postes;
  assert.deepEqual(postes.map((p) => p.debut), ["2026-10-12T16:00:00.000Z", "2026-10-15T16:00:00.000Z"]);
  assert.equal(postes[0]!.fin, "2026-10-13T08:00:00.000Z");
  assert.equal(new Date(postes[1]!.debut).getTime() - new Date(postes[0]!.fin).getTime(), 56 * 3_600_000);
  assert.ok(f.appels.some((a) => a.sql === "COMMIT"));
  assert.ok(f.appels.some((a) => a.sql.includes("pg_advisory_xact_lock")), "les créations concurrentes d'un même agent doivent être sérialisées");
});

test("PostgreSQL planning Mobil : crée 24 h de garde le week-end puis respecte 56 h de repos", async () => {
  let numero = 0;
  const f = fakePool((sql, values) => {
    if (sql.includes("FROM agents a JOIN LATERAL")) return { rows: [{ id: AGENT_ID, prenom: "Awa", nom: "Mobil", actif: true, serviceId: SERVICE_ID, regime: "mobil", service: "Mobile" }], rowCount: 1 };
    if (sql.includes("SELECT date_ferie::text AS date FROM jours_feries")) return { rows: [], rowCount: 0 };
    if (sql.includes("FROM plannings") && sql.includes("WHERE agent_id=$1::uuid")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("INSERT INTO plannings")) {
      numero++;
      return { rows: [{ planningId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(numero).padStart(12, "0")}`, posteId: values[0], debut: values[5], fin: values[6], type: values[4] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const ops = new OperationsPostgres(f.pool, secret);
  const result = await ops.gerer(req("POST", "/api/plannings", { agentId: AGENT_ID, dateDebut: "2026-10-17", dateFin: "2026-10-20", equipeMobil: "nuit", groupeNuitMobil: "A" }), admin, now);
  assert.equal(result?.statut, 201);
  const postes = (result?.corps as { postes: Array<{ debut: string; fin: string }> }).postes;
  assert.deepEqual(postes.map((p) => p.debut), ["2026-10-17T08:00:00.000Z", "2026-10-20T16:00:00.000Z"]);
  assert.equal(postes[0]!.fin, "2026-10-18T08:00:00.000Z");
  assert.equal(new Date(postes[1]!.debut).getTime() - new Date(postes[0]!.fin).getTime(), 56 * 3_600_000);
});

test("PostgreSQL planning général : respecte lundi–vendredi et exclut les jours fériés", async () => {
  let numero = 0;
  const f = fakePool((sql, values) => {
    if (sql.includes("FROM agents a JOIN LATERAL")) return { rows: [{ id: AGENT_ID, prenom: "Awa", nom: "Général", actif: true, serviceId: SERVICE_ID, regime: "general", service: "Pneumologie" }], rowCount: 1 };
    if (sql.includes("SELECT date_ferie::text AS date FROM jours_feries")) return { rows: [{ date: "2026-10-21" }], rowCount: 1 };
    if (sql.includes("FROM plannings") && sql.includes("WHERE agent_id=$1::uuid")) return { rows: [], rowCount: 0 };
    if (sql.startsWith("INSERT INTO plannings")) {
      numero++;
      return { rows: [{ planningId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(numero).padStart(12, "0")}`, posteId: values[0], debut: values[5], fin: values[6], type: values[4] }], rowCount: 1 };
    }
    return { rows: [], rowCount: 1 };
  });
  const ops = new OperationsPostgres(f.pool, secret);
  const result = await ops.gerer(req("POST", "/api/plannings", { agentId: AGENT_ID, dateDebut: "2026-10-19", dateFin: "2026-10-25" }), admin, now);
  assert.equal(result?.statut, 201);
  const postes = (result?.corps as { postes: Array<{ debut: string; fin: string }> }).postes;
  assert.deepEqual(postes.map((p) => p.debut), [
    "2026-10-19T08:00:00.000Z", "2026-10-20T08:00:00.000Z",
    "2026-10-22T08:00:00.000Z", "2026-10-23T08:00:00.000Z",
  ]);
  assert.equal(postes.length, 4, "ni samedi/dimanche ni le mercredi férié ne doivent être créés");
});

function poolModificationGenerale() {
  return fakePool((sql) => {
    if (sql.includes("FROM plannings p WHERE p.id=$1::uuid")) {
      return { rows: [{ agent_id: AGENT_ID, starts_at: "2026-10-21T08:00:00.000Z", service_txt: SERVICE_ID, regime_txt: "general", type_txt: "service" }], rowCount: 1 };
    }
    if (sql.includes("id <> $2::uuid")) return { rows: [], rowCount: 0 };
    if (sql.includes("UPDATE plannings")) return { rows: [{ id: PLANNING_ID }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
}

test("modification de planning PostgreSQL : le service général ne peut pas être déplacé au samedi ou dimanche", async () => {
  for (const date of ["2026-10-24", "2026-10-25"]) {
    const f = poolModificationGenerale();
    const ops = new OperationsPostgres(f.pool, secret);
    await assert.rejects(
      () => ops.gerer(req("PATCH", `/api/plannings/${PLANNING_ID}`, corpsModif(`${date}T08:00:00Z`, `${date}T16:00:00Z`)), admin, now),
      /lundi au vendredi/i,
    );
    assert.ok(!f.appels.some((a) => a.sql.includes("UPDATE plannings")), "aucune écriture ne doit avoir lieu le week-end");
  }
});

test("modification de planning PostgreSQL : les débuts avec secondes ou millisecondes sont refusés", async () => {
  for (const debut of ["2026-10-26T08:00:30Z", "2026-10-26T08:00:00.250Z"]) {
    const f = poolModificationGenerale();
    const ops = new OperationsPostgres(f.pool, secret);
    await assert.rejects(
      () => ops.gerer(req("PATCH", `/api/plannings/${PLANNING_ID}`, corpsModif(debut, debut.replace("08:00", "16:00"))), admin, now),
      /sans secondes ni millisecondes/i,
    );
    assert.ok(!f.appels.some((a) => a.sql.includes("UPDATE plannings")), "aucune écriture ne doit avoir lieu hors de la minute exacte");
  }
});

test("PostgreSQL planning Mobil : contrôle aussi les postes d'autres régimes lors d'une modification", async () => {
  const f = fakePool((sql) => {
    if (sql.includes("FROM plannings p WHERE p.id=$1::uuid")) return { rows: [{ id_txt: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", agent_id: AGENT_ID, service_txt: SERVICE_ID, regime_txt: "mobil", type_txt: "nuit", starts_at: "2026-10-20T16:00:00.000Z", ends_at: "2026-10-21T08:00:00.000Z", statut: "prevu" }], rowCount: 1 };
    if (sql.includes("SELECT id::text AS id, regime::text AS regime, type_poste::text AS type")) return { rows: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", regime: "garde", type: "garde", debut: "2026-10-22T08:00:00.000Z", fin: "2026-10-23T08:00:00.000Z" }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const ops = new OperationsPostgres(f.pool, secret);
  await assert.rejects(() => ops.gerer(req("PATCH", "/api/plannings/cccccccc-cccc-4ccc-8ccc-cccccccccccc", { debut: "2026-10-20T16:00:00Z", fin: "2026-10-21T08:00:00Z", motif: "Modification planning Mobil" }), admin, now), /repos/i);
  const query = f.appels.find((a) => a.sql.includes("SELECT id::text AS id, regime::text AS regime"));
  assert.ok(query);
  assert.match(query.sql, /\$3::regime_code='mobil' OR regime=\$3::regime_code/i);
  assert.ok(f.appels.some((a) => a.sql.includes("pg_advisory_xact_lock")), "une modification partage le verrou des créations");
});

test("PostgreSQL opérationnel : la liste des badges est réservée à l'administrateur avant toute requête SQL", async () => {
  const f = fakePool();
  const ops = new OperationsPostgres(f.pool, secret);
  for (const u of [responsable, brancardier]) {
    await assert.rejects(() => ops.gerer(req("GET", "/api/badges"), u, now), /Votre rôle ne permet pas/);
  }
  assert.equal(f.appels.length, 0, "un rôle non autorisé ne doit provoquer aucune requête SQL");
});

test("PostgreSQL opérationnel : émission, renouvellement et révocation de badge sont réservés à l'administrateur", async () => {
  const f = fakePool();
  const ops = new OperationsPostgres(f.pool, secret);
  for (const action of ["emettre", "renouveler", "revoquer"]) {
    for (const u of [responsable, brancardier]) {
      await assert.rejects(() => ops.gerer(req("POST", `/api/badges/${AGENT_ID}/${action}`), u, now), /Votre rôle ne permet pas/);
    }
  }
  assert.equal(f.appels.length, 0, "aucune requête SQL ne doit être faite avant le refus d'accès");
});

test("PostgreSQL opérationnel : la création/modification des zones est réservée à l'administrateur", async () => {
  const f = fakePool();
  const ops = new OperationsPostgres(f.pool, secret);
  await assert.rejects(() => ops.gerer(req("POST", "/api/zones", { nom: "Zone", serviceId: SERVICE_ID, latitude: 14.69, longitude: -17.47 }), responsable, now), /Votre rôle ne permet pas/);
  await assert.rejects(() => ops.gerer(req("POST", "/api/zones", { nom: "Zone", serviceId: SERVICE_ID, latitude: 14.69, longitude: -17.47 }), brancardier, now), /Votre rôle ne permet pas/);
  assert.equal(f.appels.length, 0);
});

test("PostgreSQL opérationnel : GET des badges renvoie explicitement la source persistante", async () => {
  const f = fakePool((sql) => {
    if (sql.includes("FROM agents a JOIN LATERAL")) return { rows: [], rowCount: 0 };
    throw new Error(`Requête inattendue dans le test : ${sql}`);
  });
  const ops = new OperationsPostgres(f.pool, secret);
  const response = await ops.gerer(req("GET", "/api/badges"), admin, now);
  assert.equal(response?.statut, 200);
  assert.deepEqual(response?.corps, {
    badges: [], source: "postgresql", fictif: false,
    note: "Seuls les badges actifs sont affichés. L'émission, la révocation et le renouvellement sont explicites et inscrits au journal d'audit.",
  });
  assert.equal(f.appels.length, 1, "la consultation des badges ne doit pas créer de badge par effet de bord");
});


test("PostgreSQL opérationnel : le responsable ne voit que les agents de ses services pour préparer les plannings", async () => {
  const f = fakePool((sql) => {
    if (sql.includes("FROM agents a JOIN LATERAL")) return { rows: [{ id: AGENT_ID, prenom: "Awa", nom: "Diop", serviceId: SERVICE_ID, service: "Accueil urgences", regime: "urgences", actif: true }], rowCount: 1 };
    throw new Error(`Requête inattendue dans le test : ${sql}`);
  });
  const ops = new OperationsPostgres(f.pool, secret);
  const response = await ops.gerer(req("GET", "/api/agents"), responsable, now);
  assert.equal(response?.statut, 200);
  assert.equal((response?.corps as { source: string }).source, "postgresql");
  assert.deepEqual(f.appels[0]?.values, [responsable.servicesGeres]);
});


test("PostgreSQL opérationnel : émission explicite d'un badge retourne un code non stocké en clair", async () => {
  const f = fakePool((sql) => {
    if (sql.startsWith("SELECT id::text AS id FROM agents WHERE")) return { rows: [{ id: AGENT_ID }], rowCount: 1 };
    if (sql.startsWith("SELECT id FROM badges_agents")) return { rows: [], rowCount: 0 };
    if (sql.includes("COALESCE(max(version),0)+1")) return { rows: [{ version: 1 }], rowCount: 1 };
    if (sql.startsWith("INSERT INTO badges_agents")) return { rows: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }], rowCount: 1 };
    if (sql.startsWith("INSERT INTO journal_audit")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const ops = new OperationsPostgres(f.pool, secret);
  const response = await ops.gerer(req("POST", `/api/badges/${AGENT_ID}/emettre`), admin, now);
  assert.equal(response?.statut, 201);
  const data = response?.corps as { badgeCode: string; succes: boolean };
  assert.equal(data.succes, true);
  assert.match(data.badgeCode, new RegExp(`^FANN-BADGE:${AGENT_ID}:`));
  assert.ok(f.appels.some((x) => x.sql.startsWith("INSERT INTO badges_agents") && x.values[1] !== data.badgeCode.split(":").at(-1)), "seul le hash du jeton doit être stocké");
  assert.ok(f.appels.some((x) => x.sql === "COMMIT"));
});

test("PostgreSQL opérationnel : la révocation désactive le badge, pas la fiche agent", async () => {
  const f = fakePool((sql) => {
    if (sql.startsWith("SELECT id::text AS id,version FROM badges_agents")) return { rows: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", version: 2 }], rowCount: 1 };
    if (sql.startsWith("UPDATE badges_agents SET actif=false")) return { rows: [], rowCount: 1 };
    if (sql.startsWith("INSERT INTO journal_audit")) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const ops = new OperationsPostgres(f.pool, secret);
  const response = await ops.gerer(req("POST", `/api/badges/${AGENT_ID}/revoquer`), admin, now);
  assert.equal(response?.statut, 200);
  assert.match(String((response?.corps as { message: string }).message), /agent reste actif/i);
  assert.ok(f.appels.some((x) => x.sql.startsWith("UPDATE badges_agents SET actif=false")));
  assert.ok(!f.appels.some((x) => x.sql.includes("UPDATE agents SET actif=false")));
  assert.ok(f.appels.some((x) => x.sql === "COMMIT"));
});

const BADGE_TEST = `FANN-BADGE:${AGENT_ID}:${"A".repeat(43)}`;
const corpsStation = { badgeCode: BADGE_TEST, type: "arrivee", idempotencyKey: "cle-station-0001" };

test("PostgreSQL station : le pointage d'un agent est sérialisé par un verrou avancé avant toute lecture (anti double arrivée)", async () => {
  const f = fakePool(() => ({ rows: [], rowCount: 0 }));
  const ops = new OperationsPostgres(f.pool, secret);
  // Badge inconnu : la requête échoue, mais le verrou doit avoir été pris juste après BEGIN et avant la lecture des pointages.
  await assert.rejects(() => ops.gerer(req("POST", "/api/pointage-station", corpsStation), admin, now), /Badge invalide/);
  const sqls = f.appels.map((a) => a.sql);
  const begin = sqls.indexOf("BEGIN");
  const verrou = sqls.findIndex((s) => s.includes("pg_advisory_xact_lock"));
  const lecture = sqls.findIndex((s) => s.includes("FROM pointages p WHERE p.agent_id"));
  assert.ok(begin >= 0 && verrou === begin + 1 && lecture > verrou, `ordre inattendu : ${sqls.join(" | ")}`);
  assert.deepEqual(f.appels[verrou]!.values, [`fann-pointage:station:${AGENT_ID}`]);
  assert.ok(sqls.includes("ROLLBACK"));
});

test("PostgreSQL station : un responsable peut rejouer un pointage d'un agent d'un autre service (poste de pointage de l'hôpital)", async () => {
  const autreService = "99999999-9999-4999-8999-999999999999";
  const rejeu = (serviceId: string) => fakePool((sql) => sql.includes("FROM pointages p WHERE p.agent_id")
    ? { rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", serviceId, type: "arrivee", validation: "accepte", serverTs: now.toISOString(), capturedTs: null }], rowCount: 1 }
    : { rows: [], rowCount: 0 });
  for (const serviceId of [autreService, SERVICE_ID]) {
    const f = rejeu(serviceId);
    const r = await new OperationsPostgres(f.pool, secret).gerer(req("POST", "/api/pointage-station", corpsStation), responsable, now);
    assert.equal(r?.statut, 201);
    assert.equal((r?.corps as { rejoue: boolean }).rejoue, true);
  }
});

test("PostgreSQL station : matricule seul refusé pour un responsable hors de ses services, badge accepté (tracé)", async () => {
  const autre = "99999999-9999-4999-8999-999999999999";
  const pool = (idsServices: string) => fakePool((sql) => {
    if (sql.includes("lower(matricule)")) return { rows: [{ id: AGENT_ID }], rowCount: 1 };
    if (sql.includes("FROM agents a")) return { rows: [{ id: AGENT_ID, prenom: "Awa", nom: "Ndiaye", matricule: "FANN-1", serviceId: idsServices, regime: "garde", service: "Autre", badgeId: "b1" }], rowCount: 1 };
    if (sql.includes("INSERT INTO pointages")) return { rows: [{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", serverTs: now.toISOString() }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const parMatricule = pool(autre);
  await assert.rejects(() => new OperationsPostgres(parMatricule.pool, secret).gerer(req("POST", "/api/pointage-station", { matricule: "FANN-1", type: "arrivee", idempotencyKey: "cle-mat-autre-01" }), responsable, now), /badge imprimé/);
  assert.ok(parMatricule.appels.some((a) => a.sql === "ROLLBACK") && !parMatricule.appels.some((a) => a.sql.includes("INSERT INTO pointages")));
  const parBadge = pool(autre);
  const r = await new OperationsPostgres(parBadge.pool, secret).gerer(req("POST", "/api/pointage-station", { ...corpsStation, idempotencyKey: "cle-badge-autre-01" }), responsable, now);
  assert.equal(r?.statut, 201);
  const audit = parBadge.appels.find((a) => a.sql.includes("INSERT INTO journal_audit"));
  assert.match(String(audit?.values[3]), /agentAutreService/);
});

// Régression : le départ (et le contrôle de doublon d'arrivée) doivent voir TOUS les pointages du poste, pas seulement ceux des 2 dernières minutes.
function stationAvecArrivee(arriveeIlYa: number) {
  const PLANNING = "dddddddd-dddd-4ddd-8ddd-dddddddddddd", POSTE = "poste-garde-1";
  const arrivee = new Date(now.getTime() - arriveeIlYa);
  return fakePool((sql, values) => {
    if (sql.includes("FROM pointages p WHERE p.agent_id")) return { rows: [], rowCount: 0 };           // pas de rejeu
    if (sql.includes("JOIN badges_agents b")) return { rows: [{ id: AGENT_ID, prenom: "Awa", nom: "Ndiaye", matricule: null, serviceId: SERVICE_ID, regime: "garde", service: "Accueil", badgeId: "b1" }], rowCount: 1 };
    if (sql.includes("FROM plannings WHERE agent_id")) return { rows: [{ id: PLANNING, posteId: POSTE, debut: new Date(now.getTime() - 9 * 3600_000).toISOString(), fin: new Date(now.getTime() + 3600_000).toISOString(), regime: "garde", type: "garde" }], rowCount: 1 };
    if (sql.includes("FROM pointages WHERE agent_id=$1::uuid AND (server_ts")) {
      // Émule la base : l'arrivée n'est renvoyée que si la requête cherche aussi par planning_id.
      const parPlanning = sql.includes("planning_id=$3::uuid") && values[2] === PLANNING;
      const dansFenetre = now.getTime() - arrivee.getTime() < 120_000;
      return parPlanning || dansFenetre ? { rows: [{ type: "arrivee", validation: "accepte", at: arrivee.toISOString(), posteCode: POSTE }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO pointages")) return { rows: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", serverTs: now.toISOString() }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
}

test("PostgreSQL station : un départ 8 h après l'arrivée est accepté (le poste est retrouvé par son planning)", async () => {
  const f = stationAvecArrivee(8 * 3600_000);
  const r = await new OperationsPostgres(f.pool, secret).gerer(req("POST", "/api/pointage-station", { ...corpsStation, type: "depart", idempotencyKey: "cle-depart-0001" }), admin, now);
  assert.equal(r?.statut, 201);
  assert.equal((r?.corps as { type: string }).type, "depart");
  assert.ok(f.appels.some((a) => a.sql === "COMMIT"));
});

test("PostgreSQL station : une seconde arrivée tardive sur le même poste est refusée", async () => {
  const f = stationAvecArrivee(30 * 60_000);
  await assert.rejects(() => new OperationsPostgres(f.pool, secret).gerer(req("POST", "/api/pointage-station", { ...corpsStation, idempotencyKey: "cle-arrivee-0002" }), admin, now), /arrivée existe déjà/i);
  assert.ok(f.appels.some((a) => a.sql === "ROLLBACK") && !f.appels.some((a) => a.sql === "COMMIT"));
});

// ---- Correctifs de l'audit du 18/10/2026 : modification de planning et heure hors ligne ----
const PLANNING_ID = "44444444-4444-4444-8444-444444444444";
const AUTRE_ID = "55555555-5555-4555-8555-555555555555";
// Heures de Dakar = UTC. Poste de jour d'urgences du mercredi 21/10/2026 08 h-20 h.
const ligneUrgences = (id: string, debut: string, fin: string, type = "jour") => ({ id, regime: "urgences", type, debut, fin });
function poolModification(voisins: ReturnType<typeof ligneUrgences>[]) {
  return fakePool((sql) => {
    if (sql.includes("FROM plannings p WHERE p.id=")) {
      return { rows: [{ agent_id: AGENT_ID, starts_at: "2026-10-21T08:00:00Z", service_txt: SERVICE_ID, regime_txt: "urgences", type_txt: "jour" }], rowCount: 1 };
    }
    if (sql.includes("id <> $2::uuid")) return { rows: voisins, rowCount: voisins.length };
    if (sql.includes("UPDATE plannings")) return { rows: [{ id: PLANNING_ID }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
}
const corpsModif = (debut: string, fin: string) => ({ debut, fin, motif: "Échange de poste validé" });

test("modification de planning PostgreSQL : un nouveau début dans le passé est refusé", async () => {
  const f = poolModification([]);
  const ops = new OperationsPostgres(f.pool, secret);
  await assert.rejects(() => ops.gerer(req("PATCH", `/api/plannings/${PLANNING_ID}`, corpsModif("2026-10-13T08:00:00Z", "2026-10-13T20:00:00Z")), admin, now), /postérieur à l’heure actuelle/);
  assert.ok(!f.appels.some((a) => a.sql.includes("UPDATE plannings")), "aucune écriture ne doit avoir lieu");
});

test("modification de planning PostgreSQL : un repos insuffisant (36 h après un poste de jour) est refusé", async () => {
  // Poste voisin la veille 08 h-20 h ; déplacer le poste au lendemain 08 h ne laisse que 12 h de repos.
  const f = poolModification([ligneUrgences(AUTRE_ID, "2026-10-19T08:00:00Z", "2026-10-19T20:00:00Z")]);
  const ops = new OperationsPostgres(f.pool, secret);
  await assert.rejects(() => ops.gerer(req("PATCH", `/api/plannings/${PLANNING_ID}`, corpsModif("2026-10-20T08:00:00Z", "2026-10-20T20:00:00Z")), admin, now), /Repos de 36 h non respecté/);
  assert.ok(!f.appels.some((a) => a.sql.includes("UPDATE plannings")), "aucune écriture ne doit avoir lieu");
});

test("modification de planning PostgreSQL : un déplacement qui respecte la rotation est enregistré", async () => {
  const f = poolModification([ligneUrgences(AUTRE_ID, "2026-10-19T08:00:00Z", "2026-10-19T20:00:00Z")]);
  const ops = new OperationsPostgres(f.pool, secret);
  const r = await ops.gerer(req("PATCH", `/api/plannings/${PLANNING_ID}`, corpsModif("2026-10-21T08:00:00Z", "2026-10-21T20:00:00Z")), admin, now);
  assert.equal(r?.statut, 200);
  assert.ok(f.appels.some((a) => a.sql.includes("UPDATE plannings")));
});

test("rapports, historique, tableau de bord et classement utilisent l'heure capturée des pointages validés manuellement", async () => {
  const sources = await import("node:fs").then((m) => m.readFileSync(new URL("./operations-postgres.ts", import.meta.url), "utf8"));
  assert.match(sources, /const tsEff = /);
  assert.equal((sources.match(/min\(x\.server_ts\)|min\(pt\.server_ts\)/g) ?? []).length, 0, "plus aucun min(server_ts) brut pour arrivée/départ");
  assert.ok((sources.match(/\$\{tsEff\("(x|pt)"\)\}/g) ?? []).length >= 8);
});

test("Messagerie PostgreSQL : seuls les administrateurs peuvent diffuser un message à tout le personnel", async () => {
  const f = fakePool((sql, values) => {
    if (sql.includes("INSERT INTO messages_diffusion")) return { rows: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", titre: values[0], contenu: values[1], creeLe: "2026-10-22T12:00:00.000Z" }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const ops = new OperationsPostgres(f.pool, secret);
  const diffuse = await ops.gerer(req("POST", "/api/messages", { titre: "Changement de garde", contenu: "Le planning est disponible dans l'application." }), admin, now);
  assert.equal(diffuse?.statut, 201);
  assert.match(String((diffuse?.corps as { messageInfo: string }).messageInfo), /tous les comptes actifs/i);
  assert.ok(f.appels.some((a) => a.sql.includes("INSERT INTO messages_diffusion")));
  assert.ok(f.appels.some((a) => a.sql.includes("INSERT INTO journal_audit")));

  const nonAutorise = fakePool();
  await assert.rejects(
    () => new OperationsPostgres(nonAutorise.pool, secret).gerer(req("POST", "/api/messages", { titre: "Annonce", contenu: "Texte" }), responsable, now),
    /Votre rôle ne permet pas/i,
  );
  assert.equal(nonAutorise.appels.length, 0, "le contrôle du rôle doit précéder toute requête SQL");
});

test("Messagerie PostgreSQL : valide les tailles de texte et marque la lecture sans doublon", async () => {
  const invalide = fakePool();
  await assert.rejects(
    () => new OperationsPostgres(invalide.pool, secret).gerer(req("POST", "/api/messages", { titre: "x", contenu: "Texte" }), admin, now),
    /titre doit contenir/i,
  );
  assert.equal(invalide.appels.length, 0);

  const messageId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const lecture = fakePool((sql) => {
    if (sql.includes("INSERT INTO messages_lectures")) return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT 1 FROM messages_diffusion")) return { rows: [{ ok: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const reponse = await new OperationsPostgres(lecture.pool, secret).gerer(req("POST", `/api/messages/${messageId}/lu`, {}), brancardier, now);
  assert.equal(reponse?.statut, 200);
  assert.equal((reponse?.corps as { lu: boolean }).lu, true);
});

test("Sauvegarde en ligne : export métier réservé à l’administrateur et exclut les secrets", async () => {
  const nonAutorise = fakePool();
  await assert.rejects(
    () => new OperationsPostgres(nonAutorise.pool, secret).gerer(req("GET", "/api/sauvegarde/export"), responsable, now),
    /Votre rôle ne permet pas/i,
  );
  assert.equal(nonAutorise.appels.length, 0);

  const f = fakePool((sql) => ({ rows: [{ donnees: [] }], rowCount: 1 }));
  const reponse = await new OperationsPostgres(f.pool, secret).gerer(req("GET", "/api/sauvegarde/export"), admin, now);
  assert.equal(reponse?.statut, 200);
  assert.match(String(reponse?.typeContenu), /application\/json/i);
  const corps = JSON.parse(String(reponse?.texte)) as { format: string; donnees: Record<string, unknown> };
  assert.equal(corps.format, "fann-pointage-export-metier-v2");
  assert.ok("agents" in corps.donnees && "pointages" in corps.donnees && "messages" in corps.donnees);
  assert.ok(f.appels.every((a) => !/mot_de_passe_hash|token_hash|session_version/i.test(a.sql)), "aucun hash d'authentification ou secret de badge/QR ne doit être exporté");
  assert.ok(f.appels.every((a) => !/photo_data_url|latitude|longitude|adresse|telephone/i.test(a.sql)), "les photos, coordonnées GPS exactes et contacts personnels sont expurgés de l'export métier");
});


test("Messagerie ciblée : un administrateur peut envoyer à des comptes précis dans une transaction", async () => {
  const destinataireId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const f = fakePool((sql, values) => {
    if (sql.includes("SELECT user_id::text AS id FROM profiles")) return { rows: [{ id: destinataireId }], rowCount: 1 };
    if (sql.includes("INSERT INTO messages_diffusion")) return { rows: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", titre: values[0], contenu: values[1], creeLe: now.toISOString(), portee: values[3], priorite: values[4] }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
  const resultat = await new OperationsPostgres(f.pool, secret).gerer(req("POST", "/api/messages", {
    titre: "Changement de garde", contenu: "Votre garde commence à 20 h.", portee: "comptes", priorite: "urgente", destinataireIds: [destinataireId], serviceIds: [],
  }), admin, now);
  assert.equal(resultat?.statut, 201);
  assert.match(String((resultat?.corps as { messageInfo: string }).messageInfo), /1 compte/);
  const ciblage = f.appels.find((a) => a.sql.includes("INSERT INTO messages_destinataires"));
  assert.ok(ciblage, "le lien de destinataire doit être enregistré");
  assert.deepEqual(ciblage.values, ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", [destinataireId]]);
  assert.ok(f.appels.some((a) => a.sql === "BEGIN") && f.appels.some((a) => a.sql === "COMMIT"), "message et destinataires sont écrits dans la même transaction");
});

test("Messagerie ciblée : un agent ne peut pas confirmer la lecture d'un message qui ne lui est pas destiné", async () => {
  const messageId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const f = fakePool((sql) => {
    if (sql.includes("INSERT INTO messages_lectures")) return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT 1 FROM messages_diffusion m WHERE")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  });
  await assert.rejects(
    () => new OperationsPostgres(f.pool, secret).gerer(req("POST", `/api/messages/${messageId}/lu`, {}), brancardier, now),
    /Message introuvable ou vous n’êtes pas destinataire/i,
  );
  const insertionLecture = f.appels.find((a) => a.sql.includes("INSERT INTO messages_lectures"));
  assert.ok(insertionLecture?.sql.includes("messages_destinataires") && insertionLecture.sql.includes("messages_services_destinataires"), "la vérification des destinataires doit être côté serveur");
});

test("Messagerie destinataires : l'annuaire de ciblage est strictement réservé à l'administrateur", async () => {
  const f = fakePool();
  await assert.rejects(
    () => new OperationsPostgres(f.pool, secret).gerer(req("GET", "/api/messages/destinataires"), responsable, now),
    /Votre rôle ne permet pas/i,
  );
  assert.equal(f.appels.length, 0);
});
