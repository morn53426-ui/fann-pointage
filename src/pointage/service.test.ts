import { test } from "node:test";
import assert from "node:assert/strict";
import { traiterPointage } from "./service.ts";
import type { PostePlanifie } from "./service.ts";
import { DepotMemoire } from "./memoire.ts";
import { emettreQr, emettreQrPermanent, verifierQr } from "./qr.ts";
import { creerPosteJour, creerPosteNuit } from "../regimes/urgences/index.ts";
import { creerGarde } from "../regimes/garde/index.ts";

const T = (h: number, m = 0, s = 0, day = 12) => new Date(Date.UTC(2026, 9, day, h, m, s));

function monter(horloge = T(8, 0, 20)) {
  const d = new DepotMemoire(horloge);
  d.agents.set("a1", { id: "a1", actif: true, serviceId: "s1", regime: "urgences" });
  d.agents.set("a2", { id: "a2", actif: true, serviceId: "s2", regime: "garde" });
  d.zones.set("z1", { id: "z1", nom: "Urgences (fictif)", serviceId: "s1", actif: true, latitude: 14.0, longitude: -17.0, rayonM: 150, precisionMaxM: 50, horsZoneAction: "refuser" });
  d.zones.set("z2", { id: "z2", nom: "Zone inactive", serviceId: "s1", actif: false, latitude: 14.0, longitude: -17.0, rayonM: 150, precisionMaxM: 50, horsZoneAction: "refuser" });
  const jour: PostePlanifie = { ...creerPosteJour(T(8)), planningId: "pl-jour" };
  const nuit: PostePlanifie = { ...creerPosteNuit(T(20, 0, 0, 13)), planningId: "pl-nuit" };
  d.ajouterPoste("a1", jour); d.ajouterPoste("a1", nuit);
  return d;
}
const scan = (d: DepotMemoire, o: Record<string, unknown> = {}) => {
  const zoneId = (o.zoneId as string) ?? "z1";
  const qr = emettreQr({ zoneId, secret: d.secret, maintenant: d.horloge });
  const position = { latitude: 14.0005, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 5000).toISOString(), simulee: false, methode: "gps" };
  return traiterPointage(d, {
    agentId: "a1", qrToken: qr.token, idempotencyKey: `k-${Math.random()}`, permission: "accordee", position, ...o,
  } as Parameters<typeof traiterPointage>[1]);
};

test("arrivée acceptée : enregistrée, heure serveur, zone et distance affichées", async () => {
  const d = monter();
  const r = await scan(d);
  assert.deepEqual([r.confirme, r.enregistre, r.validation, r.type], [true, true, "accepte", "arrivee"]);
  assert.equal(r.zone?.nom, "Urgences (fictif)");
  assert.ok(Math.abs(r.zone!.distanceM! - 55.6) < 0.5);
  assert.equal(r.serverTs, d.horloge.toISOString());
  assert.equal(d.pointages[0].planningId, "pl-jour");
});
test("heure du téléphone ignorée : un champ « serverTs » envoyé par le client n'est pas utilisé", async () => {
  const d = monter();
  const r = await scan(d, { serverTs: "2020-01-01T00:00:00Z", horodatageClient: "2020-01-01T00:00:00Z" });
  assert.equal(r.serverTs, d.horloge.toISOString());
});
test("départ après l'arrivée (type déterminé par le serveur)", async () => {
  const d = monter();
  await scan(d);
  d.horloge = T(19, 55);
  const r = await scan(d);
  assert.deepEqual([r.type, r.validation], ["depart", "accepte"]);
});
test("poste complet : un 3e pointage est refusé et non enregistré", async () => {
  const d = monter();
  await scan(d); d.horloge = T(19, 55); await scan(d); d.horloge = T(20, 30);
  const r = await scan(d);
  assert.deepEqual([r.code, r.enregistre, r.confirme], ["poste_deja_complet", false, false]);
  assert.equal(d.pointages.length, 2);
});
test("double soumission (même clé d'idempotence) : un seul enregistrement, réponse rejouée", async () => {
  const d = monter();
  const a = await scan(d, { idempotencyKey: "cle-1" });
  const b = await scan(d, { idempotencyKey: "cle-1" });
  assert.equal(d.pointages.length, 1);
  assert.deepEqual([a.rejoue, b.rejoue, b.pointageId], [false, true, a.pointageId]);
});
test("double scan rapproché avec une autre clé : refusé", async () => {
  const d = monter();
  await scan(d); d.horloge = T(8, 0, 50);
  assert.equal((await scan(d)).code, "trop_rapproche");
  assert.equal(d.pointages.length, 1);
});
test("QR invalide, falsifié ou expiré : refusé, non enregistré, journalisé", async () => {
  const d = monter();
  assert.equal((await scan(d, { qrToken: "n'importe quoi" })).code, "qr_invalide");
  const vieux = emettreQr({ zoneId: "z1", secret: d.secret, maintenant: T(7, 0) });
  assert.equal((await scan(d, { qrToken: vieux.token })).code, "qr_expire");
  assert.equal(d.pointages.length, 0);
  assert.equal(d.journal.filter((e) => e.type === "qr_invalide").length, 2);
});
test("réutilisation d'un même QR par le même agent : refusée", async () => {
  const d = monter();
  const qr = emettreQr({ zoneId: "z1", secret: d.secret, maintenant: d.horloge });
  const pos = { latitude: 14.0005, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 5000).toISOString() };
  await traiterPointage(d, { agentId: "a1", qrToken: qr.token, idempotencyKey: "k1", permission: "accordee", position: pos });
  d.horloge = T(8, 0, 50);
  const r = await traiterPointage(d, { agentId: "a1", qrToken: qr.token, idempotencyKey: "k2", permission: "accordee", position: { ...pos, collecteeLe: d.horloge.toISOString() } });
  assert.equal(r.code, "qr_reutilise");
});
test("QR d'un autre service : refusé, non enregistré, tracé (l'agent doit utiliser son badge ou son matricule)", async () => {
  const d = monter();
  d.zones.set("z3", { id: "z3", nom: "Autre service", serviceId: "s9", actif: true, latitude: 14.0, longitude: -17.0, rayonM: 150, precisionMaxM: 50, horsZoneAction: "refuser" });
  const r = await scan(d, { zoneId: "z3" });
  assert.deepEqual([r.code, r.enregistre, r.confirme], ["qr_autre_service", false, false]);
  assert.match(r.message, /autre service/);
  assert.equal(d.pointages.length, 0);
  assert.equal(d.journal.some((e) => e.type === "qr_autre_service_refuse"), true);
});
test("QR permanent d'un autre service : refusé aussi, alors que celui de son service est accepté", async () => {
  const d = monter();
  d.zones.set("z3", { id: "z3", nom: "Autre service", serviceId: "s9", actif: true, latitude: 14.0, longitude: -17.0, rayonM: 150, precisionMaxM: 50, horsZoneAction: "refuser" });
  const pos = () => ({ latitude: 14.0005, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 3000).toISOString() });
  const autre = await traiterPointage(d, { agentId: "a1", qrToken: emettreQrPermanent({ zoneId: "z3", secret: d.secret }).token, idempotencyKey: "pa1", permission: "accordee", position: pos() });
  assert.deepEqual([autre.code, autre.enregistre], ["qr_autre_service", false]);
  const sien = await traiterPointage(d, { agentId: "a1", qrToken: emettreQrPermanent({ zoneId: "z1", secret: d.secret }).token, idempotencyKey: "pa2", permission: "accordee", position: pos() });
  assert.deepEqual([sien.validation, sien.confirme], ["accepte", true]);
});
test("QR d'un autre service : le QR temporaire n'est pas consommé par le refus", async () => {
  const d = monter();
  d.zones.set("z3", { id: "z3", nom: "Autre service", serviceId: "s9", actif: true, latitude: 14.0, longitude: -17.0, rayonM: 150, precisionMaxM: 50, horsZoneAction: "refuser" });
  const qr = emettreQr({ zoneId: "z3", secret: d.secret, maintenant: d.horloge });
  const r = await scan(d, { qrToken: qr.token });
  assert.equal(r.code, "qr_autre_service");
  assert.equal(await d.qrDejaUtilise(qr.tokenHash, "a1"), false);
});
test("QR de son service mais position dans la zone d'un autre service : refusé (il faut être dans son service)", async () => {
  const d = monter();
  d.zones.set("z3", { id: "z3", nom: "Autre service", serviceId: "s9", actif: true, latitude: 14.05, longitude: -17.0, rayonM: 150, precisionMaxM: 50, horsZoneAction: "refuser" });
  const r = await scan(d, { position: { latitude: 14.05, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 5000).toISOString() } });
  assert.deepEqual([r.code, r.validation, r.confirme], ["hors_zone", "refuse", false]);
});
test("matricule ou badge : accepté dans la zone d'un AUTRE service de l'hôpital, tracé pour l'audit", async () => {
  const d = monter();
  d.zones.set("z3", { id: "z3", nom: "Autre service", serviceId: "s9", actif: true, latitude: 14.05, longitude: -17.0, rayonM: 150, precisionMaxM: 50, horsZoneAction: "refuser" });
  d.zones.delete("z1");
  const pos = { latitude: 14.05, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 5000).toISOString() };
  const r = await traiterPointage(d, { agentId: "a1", qrToken: undefined, idempotencyKey: "m1", permission: "accordee", position: pos, identification: { mode: "matricule" } });
  assert.deepEqual([r.validation, r.confirme], ["accepte", true]);
  assert.equal(d.pointages[0].zoneId, "z3");
  assert.equal(d.journal.some((e) => e.type === "pointage_zone_autre_service"), true);
});
test("rotation : deux agents (ou plus) font la même garde dans le même service, chacun pointe son arrivée et son départ", async () => {
  const d = new DepotMemoire(T(8, 0, 20));
  for (const id of ["g1", "g2", "g3"]) {
    d.agents.set(id, { id, actif: true, serviceId: "s2", regime: "garde" });
    d.ajouterPoste(id, { ...creerGarde(T(8)), planningId: `pl-${id}` });
  }
  d.zones.set("z9", { id: "z9", nom: "Service de garde", serviceId: "s2", actif: true, latitude: 14.0, longitude: -17.0, rayonM: 150, precisionMaxM: 50, horsZoneAction: "refuser" });
  const { token } = emettreQrPermanent({ zoneId: "z9", secret: d.secret });
  const pos = () => ({ latitude: 14.0005, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 3000).toISOString() });
  for (const id of ["g1", "g2", "g3"]) {
    const r = await traiterPointage(d, { agentId: id, qrToken: token, idempotencyKey: `arr-${id}`, permission: "accordee", position: pos() });
    assert.deepEqual([r.validation, r.type], ["accepte", "arrivee"], id);
  }
  d.horloge = T(8, 5, 0, 13);
  for (const id of ["g1", "g2", "g3"]) {
    const r = await traiterPointage(d, { agentId: id, qrToken: token, idempotencyKey: `dep-${id}`, permission: "accordee", position: pos() });
    assert.deepEqual([r.validation, r.type], ["accepte", "depart"], id);
  }
  assert.equal(d.pointages.length, 6);
  assert.equal(new Set(d.pointages.map((p) => p.posteId)).size, 1, "les trois agents partagent la même garde");
});
test("hors de toutes les zones actives : toujours refusé", async () => {
  const d = monter();
  const r = await scan(d, { position: { latitude: 14.2, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 5000).toISOString() } });
  assert.deepEqual([r.code, r.validation, r.confirme], ["hors_zone", "refuse", false]);
});
test("zone du QR désactivée : refusée même si une autre zone couvre la position (révocation d'une affiche)", async () => {
  const d = monter();
  const r = await scan(d, { zoneId: "z2" });
  assert.deepEqual([r.statutLocalisation, r.confirme], ["zone_inactive", false]);
});
test("QR permanent : réutilisable sans « qr_reutilise », accepté tant que la position est dans la zone", async () => {
  const d = monter();
  const { token } = emettreQrPermanent({ zoneId: "z1", secret: d.secret });
  const pos = () => ({ latitude: 14.0005, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 3000).toISOString() });
  const a = await traiterPointage(d, { agentId: "a1", qrToken: token, idempotencyKey: "p1", permission: "accordee", position: pos() });
  assert.deepEqual([a.validation, a.type], ["accepte", "arrivee"]);
  d.horloge = T(16, 0, 0);
  const b = await traiterPointage(d, { agentId: "a1", qrToken: token, idempotencyKey: "p2", permission: "accordee", position: pos() });
  assert.deepEqual([b.code === "qr_reutilise", b.validation, b.type], [false, "accepte", "depart"]);
});
test("QR permanent : sans position valide il ne prouve rien (hors zone refusé, GPS refusé refusé)", async () => {
  const d = monter();
  const { token } = emettreQrPermanent({ zoneId: "z1", secret: d.secret });
  const loin = await traiterPointage(d, { agentId: "a1", qrToken: token, idempotencyKey: "p3", permission: "accordee", position: { latitude: 14.3, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 3000).toISOString() } });
  assert.equal(loin.confirme, false);
  const sansGps = await traiterPointage(d, { agentId: "a1", qrToken: token, idempotencyKey: "p4", permission: "refusee", position: null });
  assert.equal(sansGps.confirme, false);
});
test("QR permanent : falsifié, mauvais secret ou zone modifiée → invalide", async () => {
  const d = monter();
  const { token } = emettreQrPermanent({ zoneId: "z1", secret: d.secret });
  assert.equal(verifierQr(token, d.secret, d.horloge).ok, true);
  assert.equal(verifierQr(token, "x".repeat(40), d.horloge).ok, false);
  assert.equal(verifierQr(token.replace(".z1.", ".z2."), d.secret, d.horloge).ok, false);
  assert.equal(verifierQr(`${token}0`, d.secret, d.horloge).ok, false);
  assert.equal(emettreQrPermanent({ zoneId: "z1", secret: d.secret }).token, token); // stable : même affiche à chaque impression
});
test("zone inactive et zone inexistante : refusées", async () => {
  const d = monter();
  assert.equal((await scan(d, { zoneId: "z2" })).statutLocalisation, "zone_inactive");
  assert.equal((await scan(d, { zoneId: "zzz" })).statutLocalisation, "zone_inconnue");
});
test("hors zone : refusé, enregistré avec la distance, procédure GPS affichée", async () => {
  const d = monter();
  const r = await scan(d, { position: { latitude: 14.002, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 3000).toISOString() } });
  assert.deepEqual([r.code, r.confirme, r.enregistre], ["hors_zone", false, true]);
  assert.ok(r.procedureGps?.includes("GPS"));
  assert.ok(r.zone!.ecartZoneM! > 70);
});
test("tentatives répétées hors zone : alerte de sécurité à la 3e", async () => {
  const d = monter();
  const hors = () => ({ latitude: 14.002, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 3000).toISOString() });
  for (let i = 0; i < 3; i++) { await scan(d, { position: hors() }); d.horloge = new Date(d.horloge.getTime() + 60_000); }
  assert.equal(d.journal.filter((e) => e.type === "tentatives_hors_zone_repetees").length, 1);
});
test("autorisation refusée / GPS indisponible : refusé avec procédure", async () => {
  const d = monter();
  const a = await scan(d, { permission: "refusee", position: null });
  assert.deepEqual([a.code, a.confirme], ["permission_refusee", false]);
  d.horloge = T(8, 5);
  const b = await scan(d, { permission: "indisponible", position: null });
  assert.equal(b.code, "gps_indisponible");
  assert.ok(b.procedureGps);
});
test("position ancienne (réutilisation d'une ancienne localisation) : refusée", async () => {
  const d = monter();
  const r = await scan(d, { position: { latitude: 14.0005, longitude: -17.0, precisionM: 10, collecteeLe: T(5, 0).toISOString() } });
  assert.deepEqual([r.code, r.confirme], ["position_ancienne", false]);
});
test("position simulée : à vérifier, non confirmée, événement de sécurité", async () => {
  const d = monter();
  const r = await scan(d, { position: { latitude: 14.0005, longitude: -17.0, precisionM: 10, simulee: true, collecteeLe: new Date(d.horloge.getTime() - 3000).toISOString() } });
  assert.deepEqual([r.validation, r.code, r.confirme], ["a_verifier", "position_suspecte", false]);
  assert.equal(d.journal.some((e) => e.type === "position_suspecte"), true);
});
test("aucun poste planifié : à vérifier (jamais confirmé automatiquement)", async () => {
  const d = monter(T(2, 0, 20));
  const r = await scan(d);
  assert.deepEqual([r.validation, r.code, r.confirme], ["a_verifier", "aucun_poste_planifie", false]);
});
test("agent non planifié en urgences : les postes d'un autre agent ne sont pas utilisés", async () => {
  const d = monter();
  d.zones.set("z4", { id: "z4", nom: "Service de a2", serviceId: "s2", actif: true, latitude: 14.0, longitude: -17.0, rayonM: 150, precisionMaxM: 50, horsZoneAction: "refuser" });
  const r = await scan(d, { agentId: "a2", zoneId: "z4" });
  assert.deepEqual([r.code, r.validation, r.confirme], ["aucun_poste_planifie", "a_verifier", false]);
});
test("compte inconnu ou inactif : refusé, non enregistré", async () => {
  const d = monter();
  assert.equal((await scan(d, { agentId: "inconnu" })).code, "compte_inconnu");
  d.agents.set("a3", { id: "a3", actif: false, serviceId: "s1", regime: "urgences" });
  assert.equal((await scan(d, { agentId: "a3" })).code, "compte_inactif");
  assert.equal(d.pointages.length, 0);
});
test("échec d'enregistrement : jamais de confirmation", async () => {
  const d = monter();
  d.echecEnregistrement = true;
  const r = await scan(d);
  assert.deepEqual([r.confirme, r.enregistre, r.validation, r.code], [false, false, "non_enregistre", "non_enregistre"]);
});
test("poste de nuit : arrivée 19 h 50, départ 08 h 05 le lendemain rattachés au même poste", async () => {
  const d = monter(T(19, 50, 0, 13));
  const a = await scan(d);
  d.horloge = T(8, 5, 0, 14);
  const b = await scan(d);
  assert.deepEqual([a.type, b.type], ["arrivee", "depart"]);
  assert.equal(d.pointages[0].posteId, d.pointages[1].posteId);
  assert.equal(d.pointages[0].planningId, "pl-nuit");
});
test("requête invalide : clé d'idempotence absente", async () => {
  const d = monter();
  assert.equal((await scan(d, { idempotencyKey: "" })).code, "requete_invalide");
});

test("pointage personnel par badge ou matricule : sans QR de zone, mais sur place (GPS) et dans la zone du service", async () => {
  const d = monter();
  const position = (lat: number) => ({ latitude: lat, longitude: -17.0, precisionM: 10, collecteeLe: new Date(d.horloge.getTime() - 5000).toISOString(), simulee: false, methode: "gps" });
  const base = { agentId: "a1", permission: "accordee", qrToken: undefined } as const;
  // Sur place : accepté, zone du service, aucun QR consommé.
  const ok = await traiterPointage(d, { ...base, idempotencyKey: "p1", position: position(14.0005), identification: { mode: "badge" } } as Parameters<typeof traiterPointage>[1]);
  assert.deepEqual([ok.confirme, ok.validation, ok.type], [true, "accepte", "arrivee"]);
  assert.equal(ok.zone?.nom, "Urgences (fictif)");
  assert.equal(d.pointages[0].tokenHash, null);
  assert.equal(d.pointages[0].source, "badge_perso");
  // Loin du site : refusé, même avec un badge valide.
  d.horloge = new Date(d.horloge.getTime() + 180_000);
  const loin = await traiterPointage(d, { ...base, idempotencyKey: "p2", position: position(14.5), identification: { mode: "matricule" } } as Parameters<typeof traiterPointage>[1]);
  assert.equal(loin.confirme, false);
  assert.equal(loin.code, "hors_zone");
  // Sans localisation : refusé (la preuve de présence sur site reste obligatoire).
  d.horloge = new Date(d.horloge.getTime() + 180_000);
  const sansGps = await traiterPointage(d, { ...base, idempotencyKey: "p3", permission: "refusee", position: null, identification: { mode: "matricule" } } as Parameters<typeof traiterPointage>[1]);
  assert.equal(sansGps.code, "permission_refusee");
  // Service sans zone propre : la position est couverte par la zone d'un autre service (périmètre de l'hôpital) → zone reconnue ;
  // sans poste planifié pour cet agent, le pointage reste à vérifier par un responsable (jamais confirmé automatiquement).
  const autreService = await traiterPointage(d, { agentId: "a2", permission: "accordee", idempotencyKey: "p4", position: position(14.0005), identification: { mode: "badge" } } as Parameters<typeof traiterPointage>[1]);
  assert.equal(autreService.validation, "a_verifier");
  assert.equal(autreService.code, "aucun_poste_planifie");
  assert.equal(d.pointages[d.pointages.length - 1].zoneId, "z1");
  // Aucune zone active dans tout l'hôpital : à vérifier par un responsable, jamais accepté automatiquement.
  d.zones.clear();
  d.horloge = new Date(d.horloge.getTime() + 180_000);
  const sansZone = await traiterPointage(d, { agentId: "a2", permission: "accordee", idempotencyKey: "p5", position: position(14.0005), identification: { mode: "badge" } } as Parameters<typeof traiterPointage>[1]);
  assert.equal(sansZone.validation, "a_verifier");
  assert.equal(sansZone.code, "zone_service_non_configuree");
});
