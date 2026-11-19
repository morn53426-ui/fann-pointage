import { test } from "node:test";
import assert from "node:assert/strict";
import { calculerTableauDeBord } from "./indicateurs.ts";
import { jeuDemo, pointage, T } from "./jeu.ts";
import type { ActeurApp } from "./donnees.ts";

const admin: ActeurApp = { id: "adm", role: "administrateur", servicesGeres: [] };
const respUrg: ActeurApp = { id: "r1", role: "responsable", servicesGeres: ["s-urg"] };

test("indicateurs séparés par régime à 10 h", () => {
  const t = calculerTableauDeBord(jeuDemo(), admin, T(12, 10));
  const { urgences: u, garde: g, general: n } = t.parRegime;
  assert.deepEqual([u.attendus, u.presents, u.retards, u.enRepos, u.postesEnCours], [1, 1, 1, 1, { jour: 1 }]);
  assert.deepEqual([g.attendus, g.presents, g.enAttenteArrivee, g.enRepos, g.postesEnCours], [1, 0, 1, 1, { garde: 1 }]);
  assert.deepEqual([n.attendus, n.presents, n.enRepos, n.postesEnCours], [1, 1, null, { service: 1 }]);
});
test("les pointages hors zone d'une garde ne sont pas comptés aux urgences", () => {
  const t = calculerTableauDeBord(jeuDemo(), admin, T(12, 10));
  assert.deepEqual([t.parRegime.garde.horsZone, t.parRegime.urgences.horsZone, t.parRegime.general.horsZone], [1, 0, 0]);
  assert.equal(t.parRegime.garde.aVerifier, 0); // refusé, pas « à vérifier »
});
test("poste de nuit en cours à 22 h", () => {
  const t = calculerTableauDeBord(jeuDemo(), admin, T(12, 22));
  assert.deepEqual(t.parRegime.urgences.postesEnCours, { nuit: 1 });
});
test("absence à confirmer après la fin d'un poste sans pointage", () => {
  const d = jeuDemo();
  d.pointages = d.pointages.filter((p) => p.agentId !== "n1");
  assert.equal(calculerTableauDeBord(d, admin, T(12, 17)).parRegime.general.absentsAConfirmer, 1);
});
test("pointage incomplet après la fin du poste (arrivée sans départ)", () => {
  assert.equal(calculerTableauDeBord(jeuDemo(), admin, T(12, 17)).parRegime.general.pointagesIncomplets, 1);
});

test("pointage hors ligne à vérifier : ne compte pas comme présence avant validation manuelle", () => {
  const d = jeuDemo();
  const poste = d.postes.find((p) => p.agentId === "n1")!;
  d.pointages = d.pointages.filter((p) => p.agentId !== "n1");
  const horsLigne = pointage({
    agentId: "n1", serviceId: "s-gen", posteId: poste.posteId, type: "arrivee",
    serverTs: T(12, 10), capturedTs: T(12, 8), validation: "a_verifier",
    source: "station_hors_ligne", motifRefus: "pointage_hors_ligne_a_verifier",
  });
  d.pointages.push(horsLigne);
  const enAttente = calculerTableauDeBord(d, admin, T(12, 10)).parRegime.general;
  assert.equal(enAttente.presents, 0);
  assert.equal(enAttente.enAttenteArrivee, 1);

  horsLigne.validation = "valide_manuellement";
  const valide = calculerTableauDeBord(d, admin, T(12, 10)).parRegime.general;
  assert.equal(valide.presents, 1);
  assert.equal(valide.retards, 0, "après validation, l'heure capturée approuvée est utilisée");
});

test("responsable : uniquement les agents de ses services", () => {
  const t = calculerTableauDeBord(jeuDemo(), respUrg, T(12, 10));
  assert.deepEqual([t.parRegime.urgences.attendus, t.parRegime.garde.attendus, t.parRegime.general.attendus], [1, 0, 0]);
});
test("brancardier : accès refusé", () => {
  assert.throws(() => calculerTableauDeBord(jeuDemo(), { id: "u1", role: "brancardier", servicesGeres: [], agentId: "u1" }, T(12, 10)), { code: "non_autorise" });
});
test("filtre par régime et par service", () => {
  const t = calculerTableauDeBord(jeuDemo(), admin, T(12, 10), { regime: "urgences" });
  assert.deepEqual([t.parRegime.urgences.attendus, t.parRegime.garde.attendus], [1, 0]);
  assert.equal(calculerTableauDeBord(jeuDemo(), admin, T(12, 10), { serviceId: "s-gen" }).parRegime.urgences.attendus, 0);
});
test("dernier pointage seulement, un par agent présent, coordonnées réservées à l'administrateur", () => {
  const a = calculerTableauDeBord(jeuDemo(), admin, T(12, 10));
  assert.equal(a.derniersPointages.length, 2); // u1 et n1 présents
  assert.ok(a.derniersPointages.every((v) => v.latitude !== null));
  const r = calculerTableauDeBord(jeuDemo(), respUrg, T(12, 10));
  assert.ok(r.derniersPointages.every((v) => v.latitude === null && v.longitude === null));
});
test("indicateurs non alimentés signalés (remplacements, persistance du classement)", () => {
  assert.ok(calculerTableauDeBord(jeuDemo(), admin, T(12, 10)).indisponible.includes("remplacements"));
});
