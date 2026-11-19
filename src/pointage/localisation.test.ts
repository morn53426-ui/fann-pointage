import { test } from "node:test";
import assert from "node:assert/strict";
import { lirePositionBrute, verifierLocalisation } from "./localisation.ts";
import type { PositionRecue, ZoneLoc } from "./localisation.ts";

const now = new Date("2026-10-12T08:00:30Z");
// Coordonnées FICTIVES
const zone: ZoneLoc = { id: "z1", nom: "Zone test", serviceId: "s1", actif: true, latitude: 14.0, longitude: -17.0, rayonM: 150, precisionMaxM: 50, horsZoneAction: "refuser" };
const pos = (o: Partial<PositionRecue> = {}): PositionRecue =>
  ({ latitude: 14.0005, longitude: -17.0, precisionM: 10, collecteeLe: new Date(now.getTime() - 5000), ageMs: null, simulee: false, methode: "gps", ...o });
const verif = (o: Partial<Parameters<typeof verifierLocalisation>[0]> = {}) =>
  verifierLocalisation({ permission: "accordee", position: pos(), zone, maintenant: now, ...o });

test("dans la zone : accepté, distance ≈ 55,6 m, écart 0", () => {
  const v = verif();
  assert.equal(v.validation, "accepte");
  assert.equal(v.statut, "dans_zone");
  assert.ok(Math.abs(v.distanceM! - 55.6) < 0.5);
  assert.equal(v.ecartZoneM, 0);
});
test("hors zone (≈ 222 m) : refusé, écart ≈ 72 m", () => {
  const v = verif({ position: pos({ latitude: 14.002 }) });
  assert.deepEqual([v.statut, v.validation, v.code], ["hors_zone", "refuse", "hors_zone"]);
  assert.ok(Math.abs(v.ecartZoneM! - 72.4) < 0.5);
});
test("hors zone avec configuration « anomalie » : à vérifier", () => {
  assert.equal(verif({ position: pos({ latitude: 14.002 }), zone: { ...zone, horsZoneAction: "anomalie" } }).validation, "a_verifier");
});
test("précision insuffisante : à vérifier par défaut, refusé si configuré", () => {
  assert.deepEqual([verif({ position: pos({ precisionM: 120 }) }).statut, verif({ position: pos({ precisionM: 120 }) }).validation], ["precision_insuffisante", "a_verifier"]);
  const strict = verif({ position: pos({ precisionM: 120 }), params: { ageMaxS: 30, avanceMaxS: 10, precisionAction: "refuser" } });
  assert.equal(strict.validation, "refuse");
  assert.equal(verif({ position: pos({ precisionM: null }) }).statut, "precision_insuffisante");
});
test("autorisation de localisation refusée", () => {
  assert.deepEqual([verif({ permission: "refusee", position: null }).statut, verif({ permission: "refusee", position: null }).code], ["refusee", "permission_refusee"]);
});
test("GPS indisponible ou position absente", () => {
  assert.equal(verif({ permission: "indisponible", position: null }).statut, "indisponible");
  assert.equal(verif({ position: null }).statut, "indisponible");
});
test("position ancienne / mise en cache (10 min) refusée", () => {
  const v = verif({ position: pos({ collecteeLe: new Date(now.getTime() - 600_000) }) });
  assert.deepEqual([v.statut, v.validation], ["ancienne", "refuse"]);
  assert.equal(verif({ position: pos({ collecteeLe: null }) }).statut, "ancienne");
});
test("horodatage de position dans le futur refusé", () => {
  assert.equal(verif({ position: pos({ collecteeLe: new Date(now.getTime() + 120_000) }) }).statut, "ancienne");
});
test("position simulée : à vérifier et marquée suspecte", () => {
  const v = verif({ position: pos({ simulee: true }) });
  assert.deepEqual([v.statut, v.validation, v.positionSuspecte], ["suspecte", "a_verifier", true]);
});
test("hors zone prioritaire sur suspecte (refus plus sévère)", () => {
  assert.equal(verif({ position: pos({ latitude: 14.002, simulee: true }) }).statut, "hors_zone");
});
test("zone inactive et zone inexistante", () => {
  assert.equal(verif({ zone: { ...zone, actif: false } }).statut, "zone_inactive");
  assert.equal(verif({ zone: null }).statut, "zone_inconnue");
});
test("lecture d'une position brute : coordonnées invalides rejetées", () => {
  assert.equal(lirePositionBrute({ latitude: 91, longitude: 0 }), null);
  assert.equal(lirePositionBrute({ latitude: "14", longitude: 0 }), null);
  assert.equal(lirePositionBrute(null), null);
  assert.equal(lirePositionBrute({ latitude: 14, longitude: -17, collecteeLe: "n'importe quoi" })!.collecteeLe, null);
});

test("horloge du téléphone décalée de 3 h : l'âge mesuré sur l'appareil (ageMs) prime", () => {
  const v = verif({ position: pos({ collecteeLe: new Date(now.getTime() - 3 * 3_600_000), ageMs: 2000 }) });
  assert.equal(v.validation, "accepte");
});
test("ageMs trop grand : position refusée même si l'horodatage semble récent", () => {
  assert.equal(verif({ position: pos({ ageMs: 600_000 }) }).statut, "ancienne");
});
test("ageMs négatif ou invalide ignoré à la lecture", () => {
  assert.equal(lirePositionBrute({ latitude: 14, longitude: -17, ageMs: -5 })!.ageMs, null);
  assert.equal(lirePositionBrute({ latitude: 14, longitude: -17, ageMs: 1500 })!.ageMs, 1500);
});


test("précision GPS négative rejetée comme donnée de précision invalide", () => {
  const lu = lirePositionBrute({ latitude: 14.0005, longitude: -17, precisionM: -100, ageMs: 1000 });
  assert.equal(lu?.precisionM, null);
  assert.equal(verif({ position: lu }).statut, "precision_insuffisante");
  assert.notEqual(verif({ position: lu }).validation, "accepte");
});
