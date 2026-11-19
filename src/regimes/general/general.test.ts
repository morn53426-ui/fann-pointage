import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_GENERAL_DEFAUT, estJourTravaille, evaluerPresenceGeneral, posteDuJour, validerConfigGeneral } from "./index.ts";
import { dakarDateTime } from "../../shared/time.ts";
import { jours, parseCle } from "../../shared/civil.ts";

const d = parseCle;
const t = (day: number, h: number, m = 0) => dakarDateTime(2026, 10, day, h, m);

test("poste du lundi : début 08 h, fin 16 h", () => {
  const p = posteDuJour(d("2026-10-12"))!;
  assert.equal(p.debut.toISOString(), "2026-10-12T08:00:00.000Z");
  assert.equal(p.fin.toISOString(), "2026-10-12T16:00:00.000Z");
  assert.equal(p.type, "service");
});
test("samedi et dimanche sont des jours de repos par défaut", () => {
  assert.equal(posteDuJour(d("2026-10-10")), null);
  assert.equal(posteDuJour(d("2026-10-11")), null);
  assert.equal(estJourTravaille(d("2026-10-10")), false);
  assert.equal(estJourTravaille(d("2026-10-11")), false);
});
test("configuration accepte le dimanche et refuse les doublons", () => {
  assert.doesNotThrow(() => validerConfigGeneral({ ...CONFIG_GENERAL_DEFAUT, joursTravailles: [1, 7] }));
  assert.throws(() => validerConfigGeneral({ ...CONFIG_GENERAL_DEFAUT, joursTravailles: [1, 1] }), { code: "config_invalide" });
});
test("jour férié : repos, sauf exception autorisée", () => {
  const feries = new Set(["2026-12-25"]);
  const c = { ...CONFIG_GENERAL_DEFAUT, joursFeries: feries };
  assert.equal(estJourTravaille(d("2026-12-25"), c), false);
  assert.equal(estJourTravaille(d("2026-12-25"), { ...c, exceptionsTravail: new Set(["2026-12-25"]) }), true);
});
test("semaine du 12 au 18/10 : cinq jours ouvrés, moins les jours fériés", () => {
  const semaine = (c = CONFIG_GENERAL_DEFAUT) => jours(d("2026-10-12"), d("2026-10-18")).filter((j) => posteDuJour(j, c) !== null).length;
  assert.equal(semaine(), 5);
  assert.equal(semaine({ ...CONFIG_GENERAL_DEFAUT, joursFeries: new Set(["2026-10-15"]) }), 4);
});
test("retard de 20 min toléré, retard de 21 min compté", () => {
  const p = posteDuJour(d("2026-10-12"))!;
  const r = evaluerPresenceGeneral(p, { arrivee: t(12, 8, 20), depart: t(12, 16, 0) }, t(12, 17));
  assert.deepEqual([r.statut, r.retardMin, r.departAnticipeMin], ["complet", 0, 0]);
  const r2 = evaluerPresenceGeneral(p, { arrivee: t(12, 8, 21), depart: t(12, 16, 0) }, t(12, 17));
  assert.equal(r2.retardMin, 21);
});
test("départ anticipé de 90 min", () => {
  const p = posteDuJour(d("2026-10-12"))!;
  const r = evaluerPresenceGeneral(p, { arrivee: t(12, 8, 0), depart: t(12, 14, 30) }, t(12, 17));
  assert.equal(r.departAnticipeMin, 90);
});
test("pointage incomplet (pas de départ) et absence à confirmer", () => {
  const p = posteDuJour(d("2026-10-12"))!;
  assert.equal(evaluerPresenceGeneral(p, { arrivee: t(12, 8) }, t(12, 18)).statut, "incomplet");
  assert.equal(evaluerPresenceGeneral(p, {}, t(12, 18)).statut, "absent_a_confirmer");
  assert.equal(evaluerPresenceGeneral(p, {}, t(12, 7)).statut, "a_venir");
});
test("refuse un poste d'un autre régime", () => {
  const p = { ...posteDuJour(d("2026-10-12"))!, regime: "garde" as const };
  assert.throws(() => evaluerPresenceGeneral(p, {}, t(12, 9)), { code: "regime_invalide" });
});

test("service qui termine avant 16 h : heure de fin réglable de 10 h à 16 h", async () => {
  const { posteDuJour, CONFIG_GENERAL_DEFAUT, validerConfigGeneral } = await import("./index.ts");
  const jour = { year: 2026, month: 10, day: 22 };
  const p14 = posteDuJour(jour, { ...CONFIG_GENERAL_DEFAUT, heureFin: 14 })!;
  assert.equal(p14.fin.toISOString(), "2026-10-22T14:00:00.000Z");  // Dakar = UTC
  assert.equal(posteDuJour(jour)!.fin.toISOString(), "2026-10-22T16:00:00.000Z");
  assert.throws(() => validerConfigGeneral({ ...CONFIG_GENERAL_DEFAUT, heureFin: 17 }));
  assert.throws(() => validerConfigGeneral({ ...CONFIG_GENERAL_DEFAUT, heureFin: 9 }));
});
