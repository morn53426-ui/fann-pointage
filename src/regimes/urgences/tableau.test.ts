import assert from "node:assert/strict";
import test from "node:test";
import { construireTableauRotation, couvertureParJour, tableauRotationCsv } from "./tableau.ts";

test("tableau de rotation : noms, équipes, repos, règle du vendredi, passages d'équipe, week-ends et jours fériés", () => {
  const l = construireTableauRotation([
    { nom: "Awa Diop", equipe: "jour", premierJour: "2026-10-12" },
    { nom: "Moussa Ndiaye", equipe: "nuit", premierJour: "2026-10-16" },
  ], "2026-10-12", "2026-10-23", new Set(["2026-10-14"]));
  const jour = l.filter((x) => x.agent === "Awa Diop"), nuit = l.filter((x) => x.agent === "Moussa Ndiaye");
  assert.deepEqual(jour.map((x) => x.jourTravail), ["lundi 12/10/2026", "mercredi 14/10/2026", "vendredi 16/10/2026", "mardi 20/10/2026", "jeudi 22/10/2026"]);
  assert.equal(jour[0].priseService, "08 h 00"); assert.equal(jour[0].finService, "20 h 00"); assert.equal(jour[0].dureeReposH, 36);
  assert.equal(jour[2].reprise, "mardi 20/10/2026 à 08 h 00"); assert.equal(jour[2].dureeReposH, 84); assert.match(jour[2].regle, /mardi à 08 h/);
  assert.match(jour[1].ferie, /2026-10-14/);
  assert.deepEqual(nuit.map((x) => [x.equipe, x.jourTravail]), [["Nuit", "vendredi 16/10/2026"], ["Jour", "dimanche 18/10/2026"], ["Jour", "mardi 20/10/2026"], ["Jour", "jeudi 22/10/2026"]]);
  assert.equal(nuit[0].finService, "08 h 00 (lendemain)"); assert.equal(nuit[0].weekend, "Nuit du vendredi au samedi");
  assert.equal(nuit[0].dureeReposH, 24); assert.equal(nuit[0].equipeReprise, "Jour"); assert.match(nuit[0].regle, /passage à l'équipe de jour/);
  assert.equal(nuit[1].weekend, "Dimanche travaillé"); assert.equal(nuit[1].equipeReprise, "Jour"); assert.equal(nuit[1].dureeReposH, 36);
  assert.match(nuit[1].regle, /36 h de repos/); assert.equal(nuit[1].reprise, "mardi 20/10/2026 à 08 h 00");
  const dim = construireTableauRotation([{ nom: "D", equipe: "jour", premierJour: "2026-10-18" }], "2026-10-18", "2026-10-25");
  assert.deepEqual(dim.map((x) => [x.equipe, x.jourTravail]), [["Jour", "dimanche 18/10/2026"], ["Nuit", "lundi 19/10/2026"], ["Nuit", "jeudi 22/10/2026"], ["Nuit", "dimanche 25/10/2026"]]);
  assert.match(dim[0].regle, /passage à l'équipe de nuit/); assert.equal(dim[1].dureeReposH, 60);
  assert.ok(tableauRotationCsv(l).startsWith("\uFEFFAgent;Équipe;"));
  assert.throws(() => construireTableauRotation([], "2026-02-31", "2026-03-01"), { code: "requete_invalide" });
});
test("agents démarrant un samedi ou un dimanche : même rotation, couverture par jour calculée", () => {
  const l = construireTableauRotation([
    { nom: "A", equipe: "jour", premierJour: "2026-10-17" }, // samedi
    { nom: "B", equipe: "jour", premierJour: "2026-10-18" }, // dimanche
  ], "2026-10-17", "2026-10-25");
  assert.deepEqual(l.filter((x) => x.agent === "A").map((x) => x.jourTravail), ["samedi 17/10/2026", "lundi 19/10/2026", "mercredi 21/10/2026", "vendredi 23/10/2026"]);
  assert.deepEqual(l.filter((x) => x.agent === "B").map((x) => [x.equipe, x.jourTravail]), [["Jour", "dimanche 18/10/2026"], ["Nuit", "lundi 19/10/2026"], ["Nuit", "jeudi 22/10/2026"], ["Nuit", "dimanche 25/10/2026"]]);
  const c = couvertureParJour(l, "2026-10-17", "2026-10-25");
  assert.equal(c.length, 9);
  assert.deepEqual(c.map((x) => x.jour), [1, 1, 1, 0, 1, 0, 1, 0, 0]);
  assert.deepEqual(c.map((x) => x.nuit), [0, 0, 1, 0, 0, 1, 0, 0, 1]);
});
