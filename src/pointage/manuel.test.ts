import { test } from "node:test";
import assert from "node:assert/strict";
import { validerManuellement } from "./manuel.ts";
import type { Acteur } from "./manuel.ts";
import { vuePointage } from "./masquage.ts";
import { DepotMemoire } from "./memoire.ts";
import type { NouveauPointage } from "./service.ts";

const base = (o: Partial<NouveauPointage> = {}): NouveauPointage => ({
  agentId: "a1", serviceId: "s1", planningId: null, posteId: "p1", zoneId: "z1", type: "arrivee", serverTs: new Date("2026-10-12T08:00:00Z"),
  validation: "refuse", motifRefus: "hors_zone", idempotencyKey: "k", statutLocalisation: "hors_zone", latitude: 14.002, longitude: -17.0,
  precisionM: 10, positionCollecteeLe: null, distanceM: 222, methodeLoc: "gps", positionSuspecte: false, appVersion: null, tokenHash: null,
  source: "qr_pwa", valideManuellementPar: null, motifValidationManuelle: null, ...o,
});
const resp: Acteur = { id: "r1", role: "responsable", servicesGeres: ["s1"] };

test("responsable du service : validation avec motif, journalisée", async () => {
  const d = new DepotMemoire(new Date("2026-10-12T09:00:00Z"));
  const p = await d.enregistrer(base());
  const r = await validerManuellement(d, resp, p.id, "GPS en panne, présence constatée");
  assert.deepEqual([r.validation, r.valideManuellementPar], ["valide_manuellement", "r1"]);
  assert.equal(d.journal.at(-1)!.type, "validation_manuelle");
});
test("motif obligatoire", async () => {
  const d = new DepotMemoire(new Date());
  const p = await d.enregistrer(base());
  await assert.rejects(validerManuellement(d, resp, p.id, "  "), { code: "motif_obligatoire" });
});
test("responsable d'un autre service, brancardier : refusés et tracés", async () => {
  const d = new DepotMemoire(new Date());
  const p = await d.enregistrer(base());
  await assert.rejects(validerManuellement(d, { id: "r2", role: "responsable", servicesGeres: ["s2"] }, p.id, "x"), { code: "non_autorise" });
  await assert.rejects(validerManuellement(d, { id: "a1", role: "brancardier", servicesGeres: [] }, p.id, "x"), { code: "non_autorise" });
  assert.equal(d.journal.filter((e) => e.type === "validation_manuelle_refusee").length, 2);
});
test("un pointage accepté n'est pas modifiable", async () => {
  const d = new DepotMemoire(new Date());
  const p = await d.enregistrer(base({ validation: "accepte", motifRefus: null }));
  await assert.rejects(validerManuellement(d, resp, p.id, "x"), { code: "non_modifiable" });
});
test("masquage : coordonnées exactes réservées à l'administrateur", async () => {
  const d = new DepotMemoire(new Date());
  const p = await d.enregistrer(base());
  assert.equal(vuePointage(p, { id: "adm", role: "administrateur", servicesGeres: [] })!.latitude, 14.002);
  const r = vuePointage(p, resp)!;
  assert.deepEqual([r.latitude, r.longitude, r.distanceM], [null, null, 222]);
  const soi = vuePointage(p, { id: "a1", role: "brancardier", servicesGeres: [], agentId: "a1" })!;
  assert.deepEqual([soi.latitude, soi.distanceM], [null, 222]);
  assert.equal(vuePointage(p, { id: "a9", role: "brancardier", servicesGeres: [], agentId: "a9" }), null);
  assert.equal(vuePointage(p, { id: "r2", role: "responsable", servicesGeres: ["s2"] }), null);
});
