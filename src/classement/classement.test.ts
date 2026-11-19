import { test } from "node:test";
import assert from "node:assert/strict";
import { REGLES_SCORE_DEFAUT, validerReglesScore } from "./regles.ts";
import { calculerScoreMensuel, calculerScores, classerScores } from "./moteur.ts";
import { creerClassementMensuel, validerMois } from "./classement.ts";
import { exporterClassementMensuelCsv } from "./export.ts";
import type { DonneesAgentMensuelles, ReglesScore } from "./types.ts";

const DATE = new Date("2026-10-01T12:00:00.000Z");
function agent(id: string, overrides: Partial<DonneesAgentMensuelles> = {}): DonneesAgentMensuelles {
  return {
    agentId: id, nom: `Agent ${id}`, service: "Urgences", regime: "urgences",
    postesPlanifies: 12, postesHonores: 12, retards: 0, absencesInjustifiees: 0,
    pointagesComplets: 12, anomaliesNonResolues: 0, pointagesHorsZone: 0, ...overrides,
  };
}
function regles(overrides: Partial<ReglesScore> = {}): ReglesScore {
  return validerReglesScore({ ...REGLES_SCORE_DEFAUT, ...overrides, criteres: { ...REGLES_SCORE_DEFAUT.criteres, ...overrides.criteres } });
}

test("calcul de points pondéré sur 100, détails arrondis de manière déterministe", () => {
  const s = calculerScoreMensuel(agent("a", { postesPlanifies: 10, postesHonores: 10, retards: 1, pointagesComplets: 9, anomaliesNonResolues: 1 }), regles());
  assert.equal(s.tauxPresence, 100);
  assert.equal(s.detail.ponctualite, 90);
  assert.equal(s.detail.pointages_complets, 90);
  assert.equal(s.scoreTotal, 96);
});

test("sans poste planifié, le score est zéro et non un bonus artificiel", () => {
  const s = calculerScoreMensuel(agent("sans-poste", { postesPlanifies: 0, postesHonores: 0, pointagesComplets: 0 }), regles());
  assert.equal(s.scoreTotal, 0);
  assert.deepEqual(Object.values(s.detail), [0, 0, 0, 0, 0, 0]);
});

test("mesures incohérentes, identifiants dupliqués et règles invalides refusés", () => {
  assert.throws(() => calculerScoreMensuel(agent("bad", { postesHonores: 13 }), regles()), /incohérentes/);
  assert.throws(() => calculerScores([agent("a"), agent("a")], regles()), /double/);
  assert.throws(() => validerReglesScore({ ...REGLES_SCORE_DEFAUT, version: 0 }), /version/i);
  assert.throws(() => validerReglesScore({ ...REGLES_SCORE_DEFAUT, criteres: { ...REGLES_SCORE_DEFAUT.criteres, taux_presence: -1 } }), /Pondération/);
});

test("le classement inclut tous les agents et départage les égalités de manière déterministe", () => {
  const r = regles();
  const scores = calculerScores([agent("z"), agent("b"), agent("a"), agent("low", { postesHonores: 8, pointagesComplets: 8 })], r);
  const ranked = classerScores(scores, r);
  assert.deepEqual(ranked.map((x) => [x.rang, x.agentId]), [[1, "a"], [2, "b"], [3, "z"], [4, "low"]]);
});

test("top 5 mensuel : classement complet, cinq premières places et audit de génération", () => {
  const agents = Array.from({ length: 8 }, (_, i) => agent(`a${i + 1}`, { retards: i, pointagesComplets: 12 - i, postesHonores: 12 }));
  const c = creerClassementMensuel({ id: "cl-1", mois: "2026-09-01", agents, generePar: "admin", maintenant: DATE });
  assert.equal(c.scores.length, 8);
  assert.equal(c.classement.length, 8);
  assert.equal(c.top5.length, 5);
  assert.deepEqual(c.top5.map((x) => x.rang), [1, 2, 3, 4, 5]);
  assert.deepEqual(c.top5, c.classement.slice(0, 5));
  assert.equal(c.audit[0].action, "classement_mensuel_genere");
  assert.throws(() => creerClassementMensuel({ id: " ", mois: "2026-09-01", agents, generePar: "admin", maintenant: DATE }), /obligatoires/);
});

test("validation de période mensuelle", () => {
  assert.equal(validerMois("2026-09-01"), "2026-09-01");
  assert.throws(() => validerMois("2026-9-01"), /AAAA-MM-01/);
  assert.throws(() => validerMois("2026-13-01"), /invalide/);
});

test("export CSV du classement protège les formules et ne contient aucune donnée financière", () => {
  const c = creerClassementMensuel({
    id: "cl-2", mois: "2026-09-01", agents: [agent("=cmd", { nom: "=HYPERLINK(\"x\")" })], generePar: "admin", maintenant: DATE,
  });
  const out = exporterClassementMensuelCsv(c);
  assert.match(out.nomFichier, /classement-mensuel-2026-09-01/);
  assert.ok(out.csv.startsWith("\uFEFF"));
  assert.match(out.csv, /'=/);
  assert.doesNotMatch(out.csv, /FCFA|montant|prime|paiement|référence/i);
});


test("absence injustifiée non raccordée : critère neutralisé, aucun bonus fictif", () => {
  const sansDonnee = calculerScoreMensuel(agent("absent-inconnu", {
    postesPlanifies: 10, postesHonores: 0, retards: 0, absencesInjustifiees: null,
    pointagesComplets: 0, anomaliesNonResolues: 10, pointagesHorsZone: 10,
  }), regles());
  const fauxZero = calculerScoreMensuel(agent("absent-zero", {
    postesPlanifies: 10, postesHonores: 0, retards: 0, absencesInjustifiees: 0,
    pointagesComplets: 0, anomaliesNonResolues: 10, pointagesHorsZone: 10,
  }), regles());
  assert.equal(sansDonnee.detail.absences_injustifiees, null);
  assert.equal(sansDonnee.absencesInjustifiees, null);
  assert.equal(sansDonnee.scoreTotal, 0);
  assert.equal(fauxZero.scoreTotal, 15); // démontre le bonus injustifié qu'aurait produit la valeur 0
});

test("export classement : une absence inconnue est affichée comme non disponible", () => {
  const c = creerClassementMensuel({
    id: "cl-absence-inconnue", mois: "2026-09-01",
    agents: [agent("a", { absencesInjustifiees: null })], generePar: "admin", maintenant: DATE,
  });
  assert.match(exporterClassementMensuelCsv(c).csv, /Non disponible/);
});
