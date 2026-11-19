// Tests de « caractérisation » (faux pool SQL) des jours fériés, badges et zones/QR PostgreSQL : droits, validations, transactions,
// journal d'audit et formes de réponse, figés AVANT le déplacement du code hors de operations-postgres.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { OperationsPostgres } from "./operations-postgres.ts";
import type { Utilisateur } from "./magasin.ts";
import type { PoolPg, ResultatPg } from "../pointage/postgres.ts";
import type { Requete } from "./routes.ts";
import { ErreurRegime } from "../shared/types.ts";
import { hashToken } from "../pointage/qr.ts";

const SERVICE_ID = "33333333-3333-4333-8333-333333333333";
const AUTRE_SERVICE = "44444444-4444-4444-8444-444444444444";
const AGENT_ID = "22222222-2222-4222-8222-222222222222";
const ZONE_ID = "55555555-5555-4555-8555-555555555555";
const mk = (id: string, role: Utilisateur["role"], servicesGeres: string[] = [], agentId: string | null = null): Utilisateur => ({ id, identifiant: role, hash: "", role, agentId, servicesGeres, actif: true });
const admin = mk("11111111-1111-4111-8111-111111111111", "administrateur");
const responsable = mk("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "responsable", [SERVICE_ID]);
const brancardier = mk("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "brancardier", [], AGENT_ID);
const now = new Date("2026-10-14T12:00:00Z");
const secret = "fann-test-secret-long-and-random-0123456789";
const req = (methode: string, chemin: string, corps: unknown = undefined, requete: Record<string, string> = {}): Requete => ({ methode, chemin, requete, corps, entetes: {}, ip: "127.0.0.1" });
function fake(handler: (sql: string, values: readonly unknown[]) => ResultatPg = () => ({ rows: [], rowCount: 0 })) {
  const appels: { sql: string; values: readonly unknown[] }[] = [];
  const query = async (sql: string, values: readonly unknown[] = []) => { appels.push({ sql, values }); return handler(sql, values); };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as PoolPg;
  return { appels, ops: new OperationsPostgres(pool, secret) };
}
const refus = (code: string, message: string | RegExp) => (e: unknown) => {
  assert.ok(e instanceof ErreurRegime, "ErreurRegime attendue");
  assert.equal((e as ErreurRegime).code, code);
  if (typeof message === "string") assert.equal((e as ErreurRegime).message, message); else assert.match((e as ErreurRegime).message, message);
  return true;
};
const ROLE = "Votre rôle ne permet pas cette opération.";
const tx = (f: { appels: { sql: string }[] }) => f.appels.map((a) => a.sql).filter((s) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(s));
const audits = (f: { appels: { sql: string; values: readonly unknown[] }[] }) => f.appels.filter((a) => a.sql.includes("INSERT INTO journal_audit"));
const tokenBadge = (agentId: string, version: number) => createHmac("sha256", secret).update(`FANN-POINTAGE:BADGE:v1:${agentId}:${version}`).digest("base64url");

test("jours fériés — lecture : encadrement seul ; création et suppression : administrateur seul", async () => {
  const f = fake(() => ({ rows: [{ date: "2026-12-25", nom: "Noël", note: null }], rowCount: 1 }));
  await assert.rejects(() => f.ops.gerer(req("GET", "/api/jours-feries"), brancardier, now), refus("non_autorise", ROLE));
  assert.equal(f.appels.length, 0);
  for (const u of [admin, responsable]) assert.deepEqual((await fake(() => ({ rows: [{ date: "2026-12-25", nom: "Noël", note: null }], rowCount: 1 })).ops.gerer(req("GET", "/api/jours-feries"), u, now))?.corps, { joursFeries: [{ date: "2026-12-25", nom: "Noël", note: null }] });
  for (const u of [responsable, brancardier]) {
    await assert.rejects(() => fake().ops.gerer(req("POST", "/api/jours-feries", { date: "2026-12-25", nom: "Noël" }), u, now), refus("non_autorise", ROLE));
    await assert.rejects(() => fake().ops.gerer(req("DELETE", "/api/jours-feries/2026-12-25"), u, now), refus("non_autorise", ROLE));
  }
});

test("jours fériés — création : validations, transaction, postes annulés/préservés, audit ; suppression", async () => {
  await assert.rejects(() => fake().ops.gerer(req("POST", "/api/jours-feries", {}), admin, now), refus("requete_invalide", "Date du jour férié est obligatoire."));
  await assert.rejects(() => fake().ops.gerer(req("POST", "/api/jours-feries", { date: "2026-13-45", nom: "X" }), admin, now), refus("requete_invalide", /Date du jour férié doit être une date/));
  await assert.rejects(() => fake().ops.gerer(req("POST", "/api/jours-feries", { date: "2026-12-25", nom: "  \u0000 " }), admin, now), refus("requete_invalide", "Le nom du jour férié est obligatoire."));
  const f = fake((sql) => sql.includes("UPDATE plannings") ? { rows: [{ id: "p1" }, { id: "p2" }], rowCount: 2 } : sql.includes("SELECT p.id::text AS id FROM plannings") ? { rows: [{ id: "garde-pointee" }], rowCount: 1 } : { rows: [], rowCount: 1 });
  const r = await f.ops.gerer(req("POST", "/api/jours-feries", { date: "2026-12-25", nom: "  Noël \n 2026 ", note: "  férié national  " }), admin, now);
  assert.equal(r?.statut, 201);
  const c = r?.corps as { succes: boolean; jourFerie: unknown; impactPlanning: unknown; message: string };
  assert.deepEqual(c.jourFerie, { date: "2026-12-25", nom: "Noël 2026", note: "férié national" });
  assert.deepEqual(c.impactPlanning, { retires: 2, aExaminer: ["garde-pointee"] });
  assert.deepEqual(tx(f), ["BEGIN", "COMMIT"]);
  assert.deepEqual(f.appels.find((a) => a.sql.includes("INSERT INTO jours_feries"))!.values, ["2026-12-25", "Noël 2026"]);
  const upd = f.appels.find((a) => a.sql.includes("UPDATE plannings"))!;
  assert.ok(upd.sql.includes("p.regime='general'"), "seuls les postes du régime général sont annulés");
  assert.equal(audits(f).length, 1);
  assert.ok(audits(f)[0]!.sql.includes("'jour_ferie_cree'"));
  // Doublon (23505) : ROLLBACK et conflit explicite.
  const dup = fake((sql) => { if (sql.includes("INSERT INTO jours_feries")) throw Object.assign(new Error("dup"), { code: "23505" }); return { rows: [], rowCount: 0 }; });
  await assert.rejects(() => dup.ops.gerer(req("POST", "/api/jours-feries", { date: "2026-12-25", nom: "Noël" }), admin, now), refus("conflit", "Cette opération crée un doublon ou un élément déjà enregistré."));
  assert.deepEqual(tx(dup), ["BEGIN", "ROLLBACK"]);
  // Suppression logique.
  await assert.rejects(() => fake().ops.gerer(req("DELETE", "/api/jours-feries/2026-12-25"), admin, now), refus("introuvable", "Jour férié introuvable."));
  const ok = fake(() => ({ rows: [{ date_ferie: "2026-12-25" }], rowCount: 1 }));
  assert.deepEqual((await ok.ops.gerer(req("DELETE", "/api/jours-feries/2026-12-25"), admin, now))?.corps, { succes: true });
  assert.equal(audits(ok)[0]!.values[1], "jour_ferie_desactive"); assert.equal(audits(ok)[0]!.values[3], "2026-12-25");
});

test("badges — lecture : administrateur seul ; codes signés par le secret serveur, uniquement les badges actifs", async () => {
  for (const u of [responsable, brancardier]) await assert.rejects(() => fake().ops.gerer(req("GET", "/api/badges"), u, now), refus("non_autorise", ROLE));
  const f = fake(() => ({ rows: [{ agentId: AGENT_ID, prenom: "Awa", nom: "Diop", version: 3, badgeActif: true }], rowCount: 1 }));
  const r = await f.ops.gerer(req("GET", "/api/badges"), admin, now);
  const c = r?.corps as { badges: { badgeCode: string }[]; source: string; fictif: boolean };
  assert.equal(r?.statut, 200); assert.equal(c.source, "postgresql"); assert.equal(c.fictif, false);
  assert.equal(c.badges[0]!.badgeCode, `FANN-BADGE:${AGENT_ID}:${tokenBadge(AGENT_ID, 3)}`);
  assert.ok(f.appels[0]!.sql.includes("b.actif"), "seuls les badges actifs sont listés");
});

test("badges — émission : administrateur seul, agent actif, un seul badge actif, version suivante, audit", async () => {
  for (const u of [responsable, brancardier]) await assert.rejects(() => fake().ops.gerer(req("POST", `/api/badges/${AGENT_ID}/emettre`), u, now), refus("non_autorise", ROLE));
  await assert.rejects(() => fake().ops.gerer(req("POST", "/api/badges/pas-un-uuid/emettre"), admin, now), refus("requete_invalide", "Agent invalide."));
  const inconnu = fake();
  await assert.rejects(() => inconnu.ops.gerer(req("POST", `/api/badges/${AGENT_ID}/emettre`), admin, now), refus("introuvable", "Agent actif introuvable."));
  assert.deepEqual(tx(inconnu), ["BEGIN", "ROLLBACK"]);
  const deja = fake((sql) => sql.includes("FROM agents WHERE") ? { rows: [{ id: AGENT_ID }], rowCount: 1 } : sql.includes("FROM badges_agents WHERE agent_id=$1::uuid AND actif") ? { rows: [{ id: "b1" }], rowCount: 1 } : { rows: [], rowCount: 0 });
  await assert.rejects(() => deja.ops.gerer(req("POST", `/api/badges/${AGENT_ID}/emettre`), admin, now), refus("conflit", "Un badge actif existe déjà. Utilisez le renouvellement si le badge doit être remplacé."));
  assert.deepEqual(tx(deja), ["BEGIN", "ROLLBACK"]);
  const f = fake((sql) => sql.includes("FROM agents WHERE") ? { rows: [{ id: AGENT_ID }], rowCount: 1 } : sql.includes("max(version)") ? { rows: [{ version: 4 }], rowCount: 1 } : sql.includes("INSERT INTO badges_agents") ? { rows: [{ id: "nouveau" }], rowCount: 1 } : { rows: [], rowCount: 0 });
  const r = await f.ops.gerer(req("POST", `/api/badges/${AGENT_ID}/emettre`), admin, now);
  assert.equal(r?.statut, 201);
  const jeton = tokenBadge(AGENT_ID, 4);
  assert.deepEqual(r?.corps, { succes: true, badgeCode: `FANN-BADGE:${AGENT_ID}:${jeton}`, message: "Badge émis et enregistré dans PostgreSQL. Imprimez-le et remettez-le à son titulaire." });
  assert.deepEqual(f.appels.find((a) => a.sql.includes("INSERT INTO badges_agents"))!.values, [AGENT_ID, hashToken(jeton), 4, admin.id], "seul le hash du jeton est stocké");
  assert.deepEqual(tx(f), ["BEGIN", "COMMIT"]);
  assert.ok(audits(f)[0]!.sql.includes("'badge_emis'"));
  for (const a of audits(f)) assert.ok(!JSON.stringify(a.values).includes(jeton), "le jeton en clair n'est jamais journalisé");
});

test("badges — révocation et renouvellement : administrateur seul, ancien badge désactivé, nouvelle version, audit", async () => {
  for (const act of ["revoquer", "renouveler"]) for (const u of [responsable, brancardier]) await assert.rejects(() => fake().ops.gerer(req("POST", `/api/badges/${AGENT_ID}/${act}`), u, now), refus("non_autorise", ROLE));
  const aucun = fake();
  await assert.rejects(() => aucun.ops.gerer(req("POST", `/api/badges/${AGENT_ID}/revoquer`), admin, now), refus("introuvable", "Aucun badge actif à révoquer pour cet agent."));
  assert.deepEqual(tx(aucun), ["BEGIN", "ROLLBACK"]);
  const rev = fake((sql) => sql.includes("SELECT id::text AS id,version FROM badges_agents") ? { rows: [{ id: "b1", version: 2 }], rowCount: 1 } : { rows: [], rowCount: 1 });
  const r1 = await rev.ops.gerer(req("POST", `/api/badges/${AGENT_ID}/revoquer`), admin, now);
  assert.equal(r1?.statut, 200); assert.equal((r1?.corps as { succes: boolean }).succes, true);
  assert.deepEqual(rev.appels.find((a) => a.sql.includes("UPDATE badges_agents"))!.values, ["b1", admin.id, now]);
  assert.deepEqual(tx(rev), ["BEGIN", "COMMIT"]); assert.ok(audits(rev)[0]!.sql.includes("'badge_revoque'"));
  await assert.rejects(() => fake().ops.gerer(req("POST", `/api/badges/${AGENT_ID}/renouveler`), admin, now), refus("introuvable", "Agent actif introuvable."));
  const ren = fake((sql) => sql.includes("FROM agents WHERE") ? { rows: [{ id: AGENT_ID }], rowCount: 1 } : sql.includes("SELECT id::text AS id,version FROM badges_agents") ? { rows: [{ id: "b1", version: 2 }], rowCount: 1 } : sql.includes("max(version)") ? { rows: [{ version: 3 }], rowCount: 1 } : sql.includes("INSERT INTO badges_agents") ? { rows: [{ id: "b2" }], rowCount: 1 } : { rows: [], rowCount: 1 });
  const r2 = await ren.ops.gerer(req("POST", `/api/badges/${AGENT_ID}/renouveler`), admin, now);
  assert.equal(r2?.statut, 200);
  assert.equal((r2?.corps as { badgeCode: string }).badgeCode, `FANN-BADGE:${AGENT_ID}:${tokenBadge(AGENT_ID, 3)}`);
  assert.equal((r2?.corps as { message: string }).message, "Ancien badge révoqué. Le nouveau badge est actif ; réimprimez-le.");
  const sqls = ren.appels.map((a) => a.sql);
  const iUpdate = sqls.findIndex((s) => s.includes("UPDATE badges_agents")), iInsert = sqls.findIndex((s) => s.includes("INSERT INTO badges_agents"));
  assert.ok(iUpdate >= 0 && iUpdate < iInsert, "l'ancien badge est désactivé avant l'émission du nouveau");
  assert.deepEqual(ren.appels[iUpdate]!.values, ["b1", admin.id, now]);
  assert.deepEqual(tx(ren), ["BEGIN", "COMMIT"]); assert.ok(audits(ren)[0]!.sql.includes("'badge_renouvele'"));
});

test("zones — lecture : administrateur voit tout, responsable ses services, brancardier refusé", async () => {
  await assert.rejects(() => fake().ops.gerer(req("GET", "/api/zones"), brancardier, now), refus("non_autorise", ROLE));
  const a = fake(() => ({ rows: [{ id: ZONE_ID, nom: "Urgences" }], rowCount: 1 }));
  const ra = await a.ops.gerer(req("GET", "/api/zones"), admin, now);
  assert.deepEqual(ra?.corps, { zones: [{ id: ZONE_ID, nom: "Urgences" }], source: "postgresql" });
  assert.deepEqual(a.appels[0]!.values, []); assert.ok(!a.appels[0]!.sql.includes("ANY($1::uuid[])"));
  const r = fake(); await r.ops.gerer(req("GET", "/api/zones"), responsable, now);
  assert.deepEqual(r.appels[0]!.values, [[SERVICE_ID]]); assert.ok(r.appels[0]!.sql.includes("z.service_id=ANY($1::uuid[])"));
});

test("zones — création : administrateur seul, bornes de validation, service actif, audit", async () => {
  const bon = { nom: "  Bloc   A ", serviceId: SERVICE_ID, latitude: 14.69, longitude: -17.44 };
  for (const u of [responsable, brancardier]) await assert.rejects(() => fake().ops.gerer(req("POST", "/api/zones", bon), u, now), refus("non_autorise", ROLE));
  await assert.rejects(() => fake().ops.gerer(req("POST", "/api/zones", { ...bon, serviceId: "x" }), admin, now), refus("requete_invalide", "Service invalide."));
  const inval = "Nom, coordonnées et rayons de zone invalides.";
  for (const c of [{ ...bon, nom: "  " }, { ...bon, latitude: 91 }, { ...bon, latitude: "abc" }, { ...bon, longitude: -181 }, { ...bon, rayonM: 19 }, { ...bon, rayonM: 5001 }, { ...bon, rayonM: 20.5 }, { ...bon, precisionMaxM: 9 }, { ...bon, precisionMaxM: 1001 }])
    await assert.rejects(() => fake().ops.gerer(req("POST", "/api/zones", c), admin, now), refus("requete_invalide", inval));
  await assert.rejects(() => fake().ops.gerer(req("POST", "/api/zones", bon), admin, now), refus("introuvable", "Service actif introuvable."));
  const f = fake(() => ({ rows: [{ id: ZONE_ID, nom: "Bloc A", serviceId: SERVICE_ID, actif: true }], rowCount: 1 }));
  const r = await f.ops.gerer(req("POST", "/api/zones", bon), admin, now);
  assert.equal(r?.statut, 201);
  assert.deepEqual(r?.corps, { zone: { id: ZONE_ID, nom: "Bloc A", serviceId: SERVICE_ID, actif: true }, message: "Zone de pointage enregistrée." });
  assert.deepEqual(f.appels.find((a) => a.sql.includes("INSERT INTO zones_pointage"))!.values, ["Bloc A", SERVICE_ID, 14.69, -17.44, 150, 50, admin.id], "rayon 150 m et précision 50 m par défaut");
  assert.ok(audits(f)[0]!.sql.includes("zone_pointage_creee"));
  assert.deepEqual(tx(f), ["BEGIN", "COMMIT"], "audit v31 F-06 : insertion et audit dans une même transaction");
});

test("QR de zone — encadrement seul, zone active, périmètre du responsable, permanent audité, éphémère 60 s enregistré", async () => {
  await assert.rejects(() => fake().ops.gerer(req("GET", "/api/qr", undefined, { zoneId: ZONE_ID }), brancardier, now), refus("non_autorise", ROLE));
  await assert.rejects(() => fake().ops.gerer(req("GET", "/api/qr", undefined, { zoneId: "x" }), admin, now), refus("requete_invalide", "Zone invalide."));
  await assert.rejects(() => fake().ops.gerer(req("GET", "/api/qr", undefined, { zoneId: ZONE_ID }), admin, now), refus("introuvable", "Zone active introuvable."));
  const zone = (service: string) => () => ({ rows: [{ id: ZONE_ID, nom: "Bloc A", serviceId: service }], rowCount: 1 });
  await assert.rejects(() => fake(zone(AUTRE_SERVICE)).ops.gerer(req("GET", "/api/qr", undefined, { zoneId: ZONE_ID }), responsable, now), refus("non_autorise", "Cette zone est hors de votre périmètre."));
  const perm = fake(zone(SERVICE_ID));
  const rp = await perm.ops.gerer(req("GET", "/api/qr", undefined, { zoneId: ZONE_ID, permanent: "1" }), responsable, now);
  const cp = rp?.corps as { token: string; permanent: boolean; expireLe: unknown; zone: string; serviceId: string };
  assert.equal(rp?.statut, 200); assert.equal(cp.permanent, true); assert.equal(cp.expireLe, null); assert.equal(cp.zone, "Bloc A"); assert.equal(cp.serviceId, SERVICE_ID);
  assert.ok(cp.token.length > 20); assert.equal(audits(perm)[0]!.values[1], "qr_permanent_emis");
  assert.ok(!perm.appels.some((a) => a.sql.includes("INSERT INTO qr_tokens")), "un QR permanent n'est pas stocké comme jeton éphémère");
  const eph = fake((sql) => sql.includes("FROM zones_pointage") ? zone(AUTRE_SERVICE)() : { rows: [], rowCount: 1 });
  const re = await eph.ops.gerer(req("GET", "/api/qr", undefined, { zoneId: ZONE_ID }), admin, now);
  const ce = re?.corps as { token: string; expireLe: string; zone: string };
  assert.equal(ce.expireLe, "2026-10-14T12:01:00.000Z"); assert.equal(ce.zone, "Bloc A");
  const ins = eph.appels.find((a) => a.sql.includes("INSERT INTO qr_tokens"))!;
  assert.equal(ins.values[0], ZONE_ID); assert.equal(ins.values[1], hashToken(ce.token), "seul le hash du QR est stocké");
});

test("audit v31 F-06 : si l'écriture du journal échoue, la création de zone est annulée (ROLLBACK) et l'erreur remonte", async () => {
  const f = fake((sql) => {
    if (sql.includes("INSERT INTO journal_audit")) throw new Error("journal indisponible");
    return { rows: [{ id: ZONE_ID, nom: "Bloc A", serviceId: SERVICE_ID, actif: true }], rowCount: 1 };
  });
  await assert.rejects(() => f.ops.gerer(req("POST", "/api/zones", { nom: "Bloc A", serviceId: SERVICE_ID, latitude: 14.69, longitude: -17.44 }), admin, now), /journal indisponible/);
  assert.deepEqual(tx(f), ["BEGIN", "ROLLBACK"]);
});

test("audit v31 F-05 : désactivation/réactivation d'une zone — administrateur seul, motif obligatoire, transaction + audit", async () => {
  const URL = `/api/zones/${ZONE_ID}`;
  for (const u of [responsable, brancardier]) await assert.rejects(() => fake().ops.gerer(req("PATCH", URL, { actif: false, motif: "Affiche volée" }), u, now), refus("non_autorise", ROLE));
  await assert.rejects(() => fake().ops.gerer(req("PATCH", "/api/zones/x", { actif: false, motif: "Affiche volée" }), admin, now), refus("requete_invalide", "Zone invalide."));
  await assert.rejects(() => fake().ops.gerer(req("PATCH", URL, { motif: "Affiche volée" }), admin, now), refus("requete_invalide", /actif/));
  await assert.rejects(() => fake().ops.gerer(req("PATCH", URL, { actif: "non", motif: "Affiche volée" }), admin, now), refus("requete_invalide", /actif/));
  for (const motif of [undefined, "", "  ab ", 42]) await assert.rejects(() => fake().ops.gerer(req("PATCH", URL, { actif: false, motif }), admin, now), refus("requete_invalide", /motif/i));
  await assert.rejects(() => fake().ops.gerer(req("PATCH", URL, { actif: false, motif: "Affiche volée" }), admin, now), refus("introuvable", "Zone introuvable."));

  const off = fake((sql) => sql.includes("SELECT id::text AS id,nom,actif FROM zones_pointage") ? { rows: [{ id: ZONE_ID, nom: "Bloc A", actif: true }], rowCount: 1 } : { rows: [], rowCount: 1 });
  const r = await off.ops.gerer(req("PATCH", URL, { actif: false, motif: "  Affiche   volée  " }), admin, now);
  assert.equal(r?.statut, 200);
  assert.deepEqual((r?.corps as { zone: unknown }).zone, { id: ZONE_ID, nom: "Bloc A", actif: false });
  assert.deepEqual(tx(off), ["BEGIN", "COMMIT"]);
  assert.ok(off.appels.some((a) => a.sql.includes("FOR UPDATE")), "ligne verrouillée");
  const maj = off.appels.find((a) => a.sql.includes("UPDATE zones_pointage SET actif"))!;
  assert.deepEqual(maj.values, [ZONE_ID, false]);
  const a = audits(off)[0]!;
  assert.deepEqual([a.values[0], a.values[1], a.values[2]], [admin.id, "zone_pointage_desactivee", ZONE_ID]);
  assert.equal(a.values[5], "Affiche volée", "motif normalisé");

  const on = fake((sql) => sql.includes("SELECT id::text AS id,nom,actif FROM zones_pointage") ? { rows: [{ id: ZONE_ID, nom: "Bloc A", actif: false }], rowCount: 1 } : { rows: [], rowCount: 1 });
  await on.ops.gerer(req("PATCH", URL, { actif: true, motif: "Affiche retrouvée" }), admin, now);
  assert.equal(audits(on)[0]!.values[1], "zone_pointage_reactivee");

  // Idempotence : aucun changement ni audit si la zone est déjà dans l'état demandé.
  const deja = fake((sql) => sql.includes("SELECT id::text AS id,nom,actif FROM zones_pointage") ? { rows: [{ id: ZONE_ID, nom: "Bloc A", actif: false }], rowCount: 1 } : { rows: [], rowCount: 1 });
  const rd = await deja.ops.gerer(req("PATCH", URL, { actif: false, motif: "Affiche volée" }), admin, now);
  assert.match((rd?.corps as { message: string }).message, /déjà désactivée/);
  assert.equal(audits(deja).length, 0);
  assert.ok(!deja.appels.some((a) => a.sql.includes("UPDATE zones_pointage")));
});

test("audit v31 F-05 : seul l'administrateur peut lister les zones désactivées (?inclureInactives=1)", async () => {
  const a = fake(); await a.ops.gerer(req("GET", "/api/zones", undefined, { inclureInactives: "1" }), admin, now);
  assert.ok(!/WHERE z\.actif/.test(a.appels[0]!.sql));
  const b = fake(); await b.ops.gerer(req("GET", "/api/zones"), admin, now);
  assert.ok(/WHERE z\.actif/.test(b.appels[0]!.sql));
  const c = fake(); await c.ops.gerer(req("GET", "/api/zones", undefined, { inclureInactives: "1" }), responsable, now);
  assert.ok(/z\.actif AND z\.service_id/.test(c.appels[0]!.sql), "un responsable ne voit jamais les zones inactives");
});
