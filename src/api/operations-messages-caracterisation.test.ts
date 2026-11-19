// Tests de « caractérisation » de la messagerie PostgreSQL (faux pool SQL) : ils figent droits, validations, requêtes SQL clés
// et formes de réponse AVANT le déplacement du code hors de operations-postgres.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { OperationsPostgres, sqlMessageVisiblePour } from "./operations-postgres.ts";
import type { Utilisateur } from "./magasin.ts";
import type { PoolPg, ResultatPg } from "../pointage/postgres.ts";
import type { Requete } from "./routes.ts";
import { ErreurRegime } from "../shared/types.ts";

const SERVICE_ID = "33333333-3333-4333-8333-333333333333";
const MSG = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const admin: Utilisateur = { id: "11111111-1111-4111-8111-111111111111", identifiant: "admin", hash: "", role: "administrateur", agentId: null, servicesGeres: [], actif: true };
const responsable: Utilisateur = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", identifiant: "responsable", hash: "", role: "responsable", agentId: null, servicesGeres: [SERVICE_ID], actif: true };
const brancardier: Utilisateur = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", identifiant: "agent", hash: "", role: "brancardier", agentId: "22222222-2222-4222-8222-222222222222", servicesGeres: [], actif: true };
const now = new Date("2026-10-14T12:00:00Z");
const secret = "fann-test-secret-long-and-random-0123456789";
const req = (methode: string, chemin: string, corps: unknown = undefined, requete: Record<string, string> = {}): Requete => ({ methode, chemin, requete, corps, entetes: {}, ip: "127.0.0.1" });
function fakePool(handler: (sql: string, values: readonly unknown[]) => ResultatPg = () => ({ rows: [], rowCount: 0 })) {
  const appels: { sql: string; values: readonly unknown[] }[] = [];
  const query = async (sql: string, values: readonly unknown[] = []) => { appels.push({ sql, values }); return handler(sql, values); };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as PoolPg;
  return { pool, appels, ops: new OperationsPostgres(pool, secret) };
}
const refus = (code: string, message: string | RegExp) => (e: unknown) => {
  assert.ok(e instanceof ErreurRegime, "ErreurRegime attendue");
  assert.equal((e as ErreurRegime).code, code);
  if (typeof message === "string") assert.equal((e as ErreurRegime).message, message); else assert.match((e as ErreurRegime).message, message);
  return true;
};

test("messages — destinataires : administrateur seul, deux requêtes, projection id/role/nom", async () => {
  for (const u of [responsable, brancardier]) {
    const f = fakePool();
    await assert.rejects(() => f.ops.gerer(req("GET", "/api/messages/destinataires"), u, now), refus("non_autorise", "Votre rôle ne permet pas cette opération."));
    assert.equal(f.appels.length, 0);
  }
  const f = fakePool((sql) => sql.includes("FROM profiles p")
    ? { rows: [{ id: "u1", role: "brancardier", nom: "Awa Diop", motDePasse: "secret" }], rowCount: 1 }
    : { rows: [{ id: SERVICE_ID, nom: "Radiologie" }], rowCount: 1 });
  const r = await f.ops.gerer(req("GET", "/api/messages/destinataires"), admin, now);
  assert.equal(r?.statut, 200);
  assert.deepEqual(r?.corps, { comptes: [{ id: "u1", role: "brancardier", nom: "Awa Diop" }], services: [{ id: SERVICE_ID, nom: "Radiologie" }] });
  assert.equal(f.appels.length, 2);
  assert.ok(f.appels[0]!.sql.includes("p.role <> 'administrateur'"), "les administrateurs ne sont jamais destinataires");
});

test("messages — liste : paramètres selon le rôle, archives réservées à l'administrateur, compteurs", async () => {
  const lignes = [
    { id: MSG, titre: "T1", contenu: "C1", creeLe: new Date("2026-10-14T08:00:00Z"), archiveLe: null, portee: "tous", priorite: "urgente", auteur: "admin", lu: false, nombreLectures: 3, nombreComptesDestinataires: 0, nombreServicesDestinataires: 0 },
    { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", titre: "T2", contenu: "C2", creeLe: "2026-10-13T08:00:00Z", archiveLe: new Date("2026-10-14T09:00:00Z"), portee: null, priorite: null, auteur: null, lu: true, nombreLectures: 1, nombreComptesDestinataires: 2, nombreServicesDestinataires: 1 },
  ];
  const agent = fakePool(() => ({ rows: lignes, rowCount: 2 }));
  const ra = await agent.ops.gerer(req("GET", "/api/messages", undefined, { archives: "1" }), brancardier, now);
  assert.deepEqual(agent.appels[0]!.values, [brancardier.id, false, false], "archives ignorées pour un non-administrateur");
  const ca = ra?.corps as { messages: Record<string, unknown>[]; nonLus: number; source: string };
  assert.equal(ra?.statut, 200); assert.equal(ca.source, "postgresql"); assert.equal(ca.nonLus, 1);
  assert.equal(ca.messages[0]!.lu, false); assert.equal(ca.messages[0]!.creeLe, "2026-10-14T08:00:00.000Z");
  assert.equal("nombreLectures" in ca.messages[0]!, false, "compteurs réservés à l'administrateur");
  assert.equal(ca.messages[1]!.auteur, "Administration"); assert.equal(ca.messages[1]!.portee, "tous"); assert.equal(ca.messages[1]!.priorite, "normale");

  const adm = fakePool(() => ({ rows: lignes, rowCount: 2 }));
  const rm = await adm.ops.gerer(req("GET", "/api/messages", undefined, { archives: "1" }), admin, now);
  assert.deepEqual(adm.appels[0]!.values, [admin.id, true, true]);
  const cm = rm?.corps as { messages: Record<string, unknown>[]; nonLus: number };
  assert.equal(cm.nonLus, 0); assert.equal(cm.messages[0]!.lu, true);
  assert.equal(cm.messages[0]!.nombreLectures, 3); assert.equal(cm.messages[0]!.archive, false); assert.equal("archiveLe" in cm.messages[0]!, false);
  assert.equal(cm.messages[1]!.archive, true); assert.equal(cm.messages[1]!.archiveLe, "2026-10-14T09:00:00.000Z");
  const sans = fakePool(); await sans.ops.gerer(req("GET", "/api/messages"), admin, now);
  assert.deepEqual(sans.appels[0]!.values, [admin.id, true, false]);
  assert.ok(sans.appels[0]!.sql.includes("LIMIT 200"));
});

test("messages — archivage : administrateur seul, uuid valide, introuvable, déjà archivé, succès audité", async () => {
  for (const u of [responsable, brancardier]) {
    const f = fakePool();
    await assert.rejects(() => f.ops.gerer(req("DELETE", `/api/messages/${MSG}`), u, now), refus("non_autorise", "Votre rôle ne permet pas cette opération."));
    assert.equal(f.appels.length, 0);
  }
  await assert.rejects(() => fakePool().ops.gerer(req("DELETE", "/api/messages/pas-un-uuid"), admin, now), refus("requete_invalide", "Identifiant du message invalide."));
  await assert.rejects(() => fakePool().ops.gerer(req("DELETE", `/api/messages/${MSG}`), admin, now), refus("introuvable", "Message introuvable."));
  const deja = fakePool((sql) => sql.startsWith("SELECT 1 FROM messages_diffusion") ? { rows: [{ "?column?": 1 }], rowCount: 1 } : { rows: [], rowCount: 0 });
  const r1 = await deja.ops.gerer(req("DELETE", `/api/messages/${MSG}`), admin, now);
  assert.deepEqual(r1?.corps, { ok: true, archive: true, dejaArchive: true, message: "Ce message était déjà retiré." });
  assert.ok(!deja.appels.some((a) => a.sql.includes("INSERT INTO journal_audit")));
  const ok = fakePool((sql) => sql.startsWith("UPDATE messages_diffusion") ? { rows: [{ id: MSG, titre: "T", portee: "tous", priorite: "normale" }], rowCount: 1 } : { rows: [], rowCount: 1 });
  const r2 = await ok.ops.gerer(req("DELETE", `/api/messages/${MSG}`), admin, now);
  assert.equal(r2?.statut, 200);
  assert.deepEqual(r2?.corps, { ok: true, archive: true, dejaArchive: false, message: "Message retiré : il n’apparaît plus chez les destinataires." });
  const audit = ok.appels.find((a) => a.sql.includes("INSERT INTO journal_audit"))!;
  assert.equal(audit.values[0], admin.id); assert.equal(audit.values[1], "message_archive"); assert.equal(audit.values[2], "messages_diffusion");
  assert.equal(audit.values[3], MSG); assert.equal(audit.values[5], "Message retiré par l’administrateur"); assert.equal(audit.values[6], "127.0.0.1");
});

test("messages — diffusion : validations de contenu, portée, destinataires", async () => {
  const essai = (corps: unknown, u: Utilisateur = admin) => fakePool().ops.gerer(req("POST", "/api/messages", corps), u, now);
  const base = { titre: "Annonce", contenu: "Texte" };
  await assert.rejects(() => essai(base, responsable), refus("non_autorise", "Votre rôle ne permet pas cette opération."));
  await assert.rejects(() => essai({ ...base, titre: "ab" }), refus("requete_invalide", "Le titre doit contenir entre 3 et 120 caractères."));
  await assert.rejects(() => essai({ ...base, titre: "x".repeat(121) }), refus("requete_invalide", "Le titre doit contenir entre 3 et 120 caractères."));
  await assert.rejects(() => essai({ ...base, contenu: "   " }), refus("requete_invalide", "Le message est obligatoire et limité à 4 000 caractères."));
  await assert.rejects(() => essai({ ...base, contenu: "x".repeat(4001) }), refus("requete_invalide", "Le message est obligatoire et limité à 4 000 caractères."));
  await assert.rejects(() => essai({ ...base, portee: "monde" }), refus("requete_invalide", "Choisissez une portée de message valide."));
  await assert.rejects(() => essai({ ...base, priorite: "haute" }), refus("requete_invalide", "Choisissez une priorité valide."));
  await assert.rejects(() => essai({ ...base, portee: "comptes", destinataireIds: Array(101).fill(admin.id) }), refus("requete_invalide", "La liste des destinataires dépasse la limite autorisée."));
  await assert.rejects(() => essai({ ...base, portee: "comptes", destinataireIds: ["nope"] }), refus("requete_invalide", "Identifiant destinataire invalide."));
  await assert.rejects(() => essai({ ...base, portee: "services", serviceIds: ["nope"] }), refus("requete_invalide", "Identifiant de service invalide."));
  await assert.rejects(() => essai({ ...base, portee: "comptes" }), refus("requete_invalide", "Sélectionnez au moins un compte destinataire."));
  await assert.rejects(() => essai({ ...base, portee: "services" }), refus("requete_invalide", "Sélectionnez au moins un service destinataire."));
  await assert.rejects(() => essai({ ...base, serviceIds: [SERVICE_ID] }), refus("requete_invalide", "Les destinataires ciblés doivent être vides pour une diffusion générale."));
  await assert.rejects(() => essai({ ...base, portee: "comptes", destinataireIds: [brancardier.id], serviceIds: [SERVICE_ID] }), refus("requete_invalide", "Le type de destinataire ne correspond pas à la portée sélectionnée."));
});

test("messages — diffusion : transaction, destinataires vérifiés, ROLLBACK en cas d'écart, audit", async () => {
  const insere = (sql: string, values: readonly unknown[]): ResultatPg => sql.includes("INSERT INTO messages_diffusion")
    ? { rows: [{ id: MSG, titre: values[0], contenu: values[1], creeLe: new Date("2026-10-14T12:00:00Z"), portee: values[3], priorite: values[4] }], rowCount: 1 }
    : { rows: [], rowCount: 1 };
  // Diffusion générale : texte nettoyé, une seule insertion, audit.
  const tous = fakePool(insere);
  const r = await tous.ops.gerer(req("POST", "/api/messages", { titre: "  Garde \u0000 du \n week-end ", contenu: "Ligne1\r\nLigne2\u0001 " }), admin, now);
  assert.equal(r?.statut, 201);
  const c = r?.corps as { message: Record<string, unknown>; messageInfo: string };
  assert.equal(c.message.titre, "Garde du week-end"); assert.equal(c.message.contenu, "Ligne1\nLigne2");
  assert.equal(c.message.auteur, "admin"); assert.equal(c.message.lu, true); assert.equal(c.message.creeLe, "2026-10-14T12:00:00.000Z");
  assert.equal(c.messageInfo, "Message enregistré : tous les comptes actifs.");
  const sqls = tous.appels.map((a) => a.sql);
  assert.deepEqual(sqls.filter((s) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(s)), ["BEGIN", "COMMIT"]);
  assert.ok(!sqls.some((s) => s.includes("messages_destinataires") || s.includes("messages_services_destinataires")));
  const audit = tous.appels.find((a) => a.sql.includes("INSERT INTO journal_audit"))!;
  assert.equal(audit.values[1], "message_diffuse"); assert.equal(audit.values[5], "Message envoyé à tous les comptes actifs");
  assert.deepEqual(JSON.parse(String(audit.values[4])), { titre: "Garde du week-end", portee: "tous", priorite: "normale", nombreDestinataires: null });

  // Comptes ciblés (dédoublonnés, uuid en minuscules) : validation puis insertion des destinataires.
  const majuscules = brancardier.id.toUpperCase();
  const comptes = fakePool((sql, v) => sql.includes("FROM profiles") ? { rows: [{ id: brancardier.id }], rowCount: 1 } : insere(sql, v));
  const rc = await comptes.ops.gerer(req("POST", "/api/messages", { titre: "Ciblé", contenu: "Texte", portee: "comptes", priorite: "urgente", destinataireIds: [brancardier.id, majuscules] }), admin, now);
  assert.equal((rc?.corps as { messageInfo: string }).messageInfo, "Message enregistré : 1 compte(s) sélectionné(s).");
  const ins = comptes.appels.find((a) => a.sql.startsWith("INSERT INTO messages_destinataires"))!;
  assert.deepEqual(ins.values, [MSG, [brancardier.id]]);

  // Services ciblés.
  const services = fakePool((sql, v) => sql.startsWith("SELECT id::text AS id FROM services") ? { rows: [{ id: SERVICE_ID }], rowCount: 1 } : insere(sql, v));
  const rs = await services.ops.gerer(req("POST", "/api/messages", { titre: "Service", contenu: "Texte", portee: "services", serviceIds: [SERVICE_ID] }), admin, now);
  assert.equal((rs?.corps as { messageInfo: string }).messageInfo, "Message enregistré : 1 service(s) sélectionné(s).");
  assert.ok(services.appels.some((a) => a.sql.startsWith("INSERT INTO messages_services_destinataires")));

  // Destinataire introuvable ou inactif : refus, ROLLBACK, aucun message inséré, aucun audit.
  const ecart = fakePool();
  await assert.rejects(() => ecart.ops.gerer(req("POST", "/api/messages", { titre: "Ciblé", contenu: "Texte", portee: "comptes", destinataireIds: [brancardier.id] }), admin, now),
    refus("requete_invalide", "Un ou plusieurs destinataires sont introuvables, inactifs ou ne peuvent pas recevoir ce message."));
  const sq = ecart.appels.map((a) => a.sql);
  assert.deepEqual(sq.filter((s) => ["BEGIN", "COMMIT", "ROLLBACK"].includes(s)), ["BEGIN", "ROLLBACK"]);
  assert.ok(!sq.some((s) => s.includes("INSERT INTO messages_diffusion") || s.includes("INSERT INTO journal_audit")));
  const ecartS = fakePool();
  await assert.rejects(() => ecartS.ops.gerer(req("POST", "/api/messages", { titre: "Service", contenu: "Texte", portee: "services", serviceIds: [SERVICE_ID] }), admin, now),
    refus("requete_invalide", "Un ou plusieurs services destinataires sont inactifs ou introuvables."));
});

test("messages — marquer comme lu : idempotent, introuvable si archivé ou non destinataire", async () => {
  await assert.rejects(() => fakePool().ops.gerer(req("POST", "/api/messages/pas-un-uuid/lu"), brancardier, now), refus("requete_invalide", "Identifiant du message invalide."));
  const nouveau = fakePool((sql) => sql.includes("INSERT INTO messages_lectures") ? { rows: [{ message_id: MSG }], rowCount: 1 } : { rows: [], rowCount: 0 });
  const r = await nouveau.ops.gerer(req("POST", `/api/messages/${MSG}/lu`), brancardier, now);
  assert.equal(r?.statut, 200); assert.deepEqual(r?.corps, { ok: true, lu: true });
  assert.deepEqual(nouveau.appels[0]!.values, [MSG, brancardier.id]);
  assert.equal(nouveau.appels.length, 1);
  // Confidentialité : un message ciblé ne peut être marqué lu que par un destinataire (condition de visibilité commune), jamais s'il est archivé.
  assert.ok(nouveau.appels[0]!.sql.includes(sqlMessageVisiblePour("$2")) && nouveau.appels[0]!.sql.includes("m.archive_le IS NULL"));
  const dejaLu = fakePool((sql) => sql.startsWith("SELECT 1 FROM messages_diffusion") ? { rows: [{ "?column?": 1 }], rowCount: 1 } : { rows: [], rowCount: 0 });
  assert.deepEqual((await dejaLu.ops.gerer(req("POST", `/api/messages/${MSG}/lu`), brancardier, now))?.corps, { ok: true, lu: true });
  assert.ok(dejaLu.appels[1]!.sql.includes(sqlMessageVisiblePour("$2")) && dejaLu.appels[1]!.sql.includes("m.archive_le IS NULL"), "la vérification « déjà lu » applique aussi la visibilité");
  await assert.rejects(() => fakePool().ops.gerer(req("POST", `/api/messages/${MSG}/lu`), brancardier, now), refus("introuvable", "Message introuvable ou vous n’êtes pas destinataire."));
});
