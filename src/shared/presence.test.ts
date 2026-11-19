import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluerPresence, rattacherPointage } from "./presence.ts";
import { creerPosteJour, creerPosteNuit } from "../regimes/urgences/index.ts";
import { dakarDateTime } from "./time.ts";

const nuit = creerPosteNuit(dakarDateTime(2026, 10, 13, 20));
const t = (day: number, h: number, m = 0) => dakarDateTime(2026, 10, day, h, m);

test("tolérance de retard : 5 min tolérées, 6 min comptées en entier", () => {
  const p = { toleranceRetardMin: 5, toleranceDepartMin: 0 };
  assert.equal(evaluerPresence(nuit, { arrivee: t(13, 20, 5), depart: t(14, 8) }, t(14, 9), p).retardMin, 0);
  assert.equal(evaluerPresence(nuit, { arrivee: t(13, 20, 6), depart: t(14, 8) }, t(14, 9), p).retardMin, 6);
});
test("poste de nuit : arrivée la veille au soir, départ le lendemain matin = un seul poste complet de 12 h", () => {
  const r = evaluerPresence(nuit, { arrivee: t(13, 20), depart: t(14, 8) }, t(14, 9));
  assert.deepEqual([r.statut, r.dureeReelleMin], ["complet", 720]);
});
test("départ avant arrivée = incohérent ; départ seul = incomplet", () => {
  assert.equal(evaluerPresence(nuit, { arrivee: t(14, 1), depart: t(14, 0) }, t(14, 9)).statut, "incoherent");
  assert.equal(evaluerPresence(nuit, { depart: t(14, 8) }, t(14, 9)).statut, "incomplet");
});
test("rattachement par poste : départ de nuit à 08 h 05 rattaché à la nuit de la veille", () => {
  const jourSuivant = creerPosteJour(dakarDateTime(2026, 10, 15, 8));
  assert.equal(rattacherPointage(t(14, 8, 5), [nuit, jourSuivant]), nuit);
  assert.equal(rattacherPointage(t(13, 19, 0), [nuit, jourSuivant]), nuit); // arrivée en avance
  assert.equal(rattacherPointage(t(13, 12, 0), [nuit, jourSuivant]), null);  // hors fenêtre
});

test("règles du 21/10/2026 : retard de 20 min toléré, pointage accepté 1 h avant le début", async () => {
  const { PARAMS_PRESENCE_DEFAUT, AVANT_POSTE_MIN } = await import("./presence.ts");
  const poste = { debut: new Date("2026-10-22T08:00:00Z"), fin: new Date("2026-10-22T16:00:00Z") };
  const apres = (min: number) => new Date(poste.debut.getTime() + min * 60_000);
  const fin = new Date("2026-10-22T17:00:00Z");
  assert.equal(PARAMS_PRESENCE_DEFAUT.toleranceRetardMin, 20);
  assert.equal(evaluerPresence(poste, { arrivee: apres(20), depart: poste.fin }, fin).retardMin, 0);   // 20 min : toléré
  assert.equal(evaluerPresence(poste, { arrivee: apres(21), depart: poste.fin }, fin).retardMin, 21);  // 21 min : compté
  assert.equal(evaluerPresence(poste, { arrivee: apres(-45), depart: poste.fin }, fin).retardMin, 0);  // en avance : jamais en retard
  assert.equal(AVANT_POSTE_MIN, 60);
  assert.equal(rattacherPointage(apres(-60), [poste]), poste);   // 1 h avant : rattaché au poste
  assert.equal(rattacherPointage(apres(-61), [poste]), null);    // plus tôt : à vérifier par l'administrateur
});
