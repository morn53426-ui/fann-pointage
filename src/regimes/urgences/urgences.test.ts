import { test } from "node:test";
import assert from "node:assert/strict";
import {
  creerPosteJour, creerPosteNuit, estEnRepos, genererCycleJourUrgences, genererCycleNuitUrgences,
  periodeRepos, prochainPosteDebut, verifierPostesUrgences,
} from "./index.ts";
import { dakarDateTime, dakarParts } from "../../shared/time.ts";

const jour1 = dakarDateTime(2026, 10, 12, 8);
const iso = (d: Date) => d.toISOString().slice(0, 16);

test("poste de jour : 08 h à 20 h", () => {
  const p = creerPosteJour(jour1);
  assert.deepEqual([iso(p.debut), iso(p.fin)], ["2026-10-12T08:00", "2026-10-12T20:00"]);
});
test("poste de nuit : 20 h à 08 h le lendemain", () => {
  const p = creerPosteNuit(dakarDateTime(2026, 10, 12, 20));
  assert.deepEqual([iso(p.debut), iso(p.fin)], ["2026-10-12T20:00", "2026-10-13T08:00"]);
  assert.equal(dakarParts(p.fin).day, 13);
});
test("horaires invalides refusés", () => {
  assert.throws(() => creerPosteJour(dakarDateTime(2026, 10, 12, 9)), { code: "horaire_invalide" });
  assert.throws(() => creerPosteNuit(dakarDateTime(2026, 10, 12, 8)), { code: "horaire_invalide" });
});
test("cycle de l'équipe de jour : un poste, repos le lendemain, reprise le surlendemain", () => {
  const { postes, repos } = genererCycleJourUrgences(jour1, 3);
  assert.deepEqual(postes.map((p) => [p.type, iso(p.debut)]), [
    ["jour", "2026-10-12T08:00"], ["jour", "2026-10-14T08:00"], ["jour", "2026-10-16T08:00"],
  ]);
  assert.deepEqual([iso(repos[0].debut), iso(repos[0].fin)], ["2026-10-12T20:00", "2026-10-14T08:00"]);
  assert.equal(postes.some((p) => dakarParts(p.debut).day === 13), false);
  assert.deepEqual(verifierPostesUrgences(postes), []);
});
test("cycle de l'équipe de nuit : 20 h-08 h, 60 h de repos puis reprise à 20 h trois jours plus tard", () => {
  const { postes, repos } = genererCycleNuitUrgences(dakarDateTime(2026, 10, 12, 20), 3);
  assert.deepEqual(postes.map((p) => [p.type, iso(p.debut), iso(p.fin)]), [
    ["nuit", "2026-10-12T20:00", "2026-10-13T08:00"],
    ["nuit", "2026-10-15T20:00", "2026-10-16T08:00"],
    ["nuit", "2026-10-18T20:00", "2026-10-19T08:00"],
  ]);
  assert.deepEqual([iso(repos[0].debut), iso(repos[0].fin)], ["2026-10-13T08:00", "2026-10-15T20:00"]);
  assert.equal(estEnRepos(dakarDateTime(2026, 10, 14, 15), postes), true);
  assert.equal(estEnRepos(dakarDateTime(2026, 10, 15, 19), postes), true);
  assert.equal(estEnRepos(dakarDateTime(2026, 10, 15, 20), postes), false);
  assert.equal(iso(periodeRepos(postes[0]).fin), "2026-10-15T20:00");
  assert.equal(iso(prochainPosteDebut(postes[0])), "2026-10-15T20:00");
  assert.deepEqual(verifierPostesUrgences(postes), []);
});
test("équipe de jour, règle du vendredi : après 08 h-20 h le vendredi, reprise le mardi à 08 h (84 h de repos)", () => {
  const { postes, repos } = genererCycleJourUrgences(dakarDateTime(2026, 10, 16, 8), 2);
  assert.equal(dakarParts(postes[0].debut).isoWeekday, 5);
  assert.deepEqual(postes.map((p) => iso(p.debut)), ["2026-10-16T08:00", "2026-10-20T08:00"]);
  assert.equal(dakarParts(postes[1].debut).isoWeekday, 2);
  assert.deepEqual([iso(repos[0].debut), iso(repos[0].fin)], ["2026-10-16T20:00", "2026-10-20T08:00"]);
  assert.equal(iso(periodeRepos(postes[0]).fin), "2026-10-18T08:00"); // minimum de 36 h
  assert.equal(estEnRepos(dakarDateTime(2026, 10, 18, 9), postes), true); // dimanche 09 h : encore en repos prévu
  assert.equal(estEnRepos(dakarDateTime(2026, 10, 20, 8), postes), false);
  assert.deepEqual(verifierPostesUrgences(postes), []);
  const dimanche = creerPosteJour(dakarDateTime(2026, 10, 18, 8)); // 36 h respectées mais reprise du vendredi non respectée
  const c = verifierPostesUrgences([postes[0], dimanche]);
  assert.deepEqual(c.map((x) => [x.code, x.gravite]), [["reprise_vendredi", "avertissement"]]);
});
test("nuit du vendredi 20 h au samedi 08 h : jour du dimanche 08 h-20 h, 36 h de repos, reprise le mardi à 08 h et rotation de jour", () => {
  const { postes, repos } = genererCycleNuitUrgences(dakarDateTime(2026, 10, 16, 20), 4);
  assert.deepEqual(postes.map((p) => [p.type, iso(p.debut)]), [["nuit", "2026-10-16T20:00"], ["jour", "2026-10-18T08:00"], ["jour", "2026-10-20T08:00"], ["jour", "2026-10-22T08:00"]]);
  assert.deepEqual([iso(repos[0].debut), iso(repos[0].fin)], ["2026-10-17T08:00", "2026-10-18T08:00"]); // 24 h : exception de passage
  assert.deepEqual([iso(repos[1].debut), iso(repos[1].fin)], ["2026-10-18T20:00", "2026-10-20T08:00"]); // 36 h consécutives
  assert.deepEqual(verifierPostesUrgences(postes), []);
  assert.equal(dakarParts(postes[1].debut).isoWeekday, 7);
});
test("dimanche de jour 08 h-20 h : passage à la nuit le lundi à 20 h, fin mardi 08 h, 60 h de repos", () => {
  const { postes, repos } = genererCycleJourUrgences(dakarDateTime(2026, 10, 18, 8), 3);
  assert.deepEqual(postes.map((p) => [p.type, iso(p.debut), iso(p.fin)]), [["jour", "2026-10-18T08:00", "2026-10-18T20:00"], ["nuit", "2026-10-19T20:00", "2026-10-20T08:00"], ["nuit", "2026-10-22T20:00", "2026-10-23T08:00"]]);
  assert.deepEqual([iso(repos[0].debut), iso(repos[0].fin)], ["2026-10-18T20:00", "2026-10-19T20:00"]);
  assert.deepEqual([iso(repos[1].debut), iso(repos[1].fin)], ["2026-10-20T08:00", "2026-10-22T20:00"]); // 60 h
  assert.deepEqual(verifierPostesUrgences(postes), []);
});
test("variante « nuit » : le dimanche issu du passage nuit -> jour est aussi suivi de la nuit du lundi à 20 h (boucle fermée)", () => {
  const { postes } = genererCycleNuitUrgences(dakarDateTime(2026, 10, 16, 20), 4, "nuit");
  assert.deepEqual(postes.map((p) => [p.type, iso(p.debut)]), [["nuit", "2026-10-16T20:00"], ["jour", "2026-10-18T08:00"], ["nuit", "2026-10-19T20:00"], ["nuit", "2026-10-22T20:00"]]);
  assert.deepEqual(verifierPostesUrgences(postes), []);
});
test("écarts à la rotation signalés : vendredi de nuit, dimanche de jour, vendredi de jour", () => {
  const nuitVen = creerPosteNuit(dakarDateTime(2026, 10, 16, 20));
  assert.deepEqual(verifierPostesUrgences([nuitVen, creerPosteNuit(dakarDateTime(2026, 10, 19, 20))]).map((x) => x.code), ["reprise_vendredi"]);
  const jourDim = creerPosteJour(dakarDateTime(2026, 10, 18, 8));
  assert.deepEqual(verifierPostesUrgences([jourDim, creerPosteJour(dakarDateTime(2026, 10, 20, 8))]).map((x) => x.code), ["passage_equipe"]);
  const jourVen = creerPosteJour(dakarDateTime(2026, 10, 16, 8));
  assert.deepEqual(verifierPostesUrgences([jourVen, creerPosteJour(dakarDateTime(2026, 10, 18, 8))]).map((x) => x.code), ["reprise_vendredi"]);
  assert.deepEqual(verifierPostesUrgences([jourVen, creerPosteJour(dakarDateTime(2026, 10, 21, 8))]), []); // reprise plus tardive : acceptée
  const err = verifierPostesUrgences([creerPosteNuit(dakarDateTime(2026, 10, 12, 20)), creerPosteNuit(dakarDateTime(2026, 10, 14, 20))]);
  assert.deepEqual(err.map((x) => [x.code, x.gravite]), [["repos_insuffisant", "erreur"]]); // 60 h non respectées
});
test("samedis et dimanches suivent la rotation normale ; les jours fériés ne suppriment aucun poste", () => {
  const sam = genererCycleJourUrgences(dakarDateTime(2026, 10, 17, 8), 3).postes; // samedi, lundi, mercredi
  assert.deepEqual(sam.map((p) => dakarParts(p.debut).isoWeekday), [6, 1, 3]);
  const nuit = genererCycleNuitUrgences(dakarDateTime(2026, 10, 18, 20), 3).postes; // dimanche, mercredi, samedi
  assert.deepEqual(nuit.map((p) => dakarParts(p.debut).isoWeekday), [7, 3, 6]);
  assert.equal(genererCycleJourUrgences.length, 2); // pas de paramètre de jours fériés : le cycle ne dépend pas du calendrier
});
test("variante « nuit » (boucle fermée) : trois agents décalés d'une semaine couvrent toutes les nuits et tous les dimanches de jour", () => {
  const debutZone = dakarDateTime(2026, 11, 16, 0).getTime();
  const finZone = debutZone + 63 * 86_400_000;
  const nuits = new Set<number>(), dimanchesJour = new Set<number>();
  for (const d of [12, 13, 14]) for (const p of genererCycleNuitUrgences(dakarDateTime(2026, 10, d, 20), 120, "nuit").postes) {
    if (p.type === "nuit") for (let t = p.debut.getTime(); t < p.fin.getTime(); t += 3_600_000) nuits.add(t);
    else if (dakarParts(p.debut).isoWeekday === 7) dimanchesJour.add(Math.floor(p.debut.getTime() / 86_400_000));
  }
  for (let t = debutZone; t < finZone; t += 3_600_000) {
    const h = dakarParts(new Date(t)).hour;
    if (h >= 20 || h < 8) assert.ok(nuits.has(t), `nuit non couverte : ${new Date(t).toISOString()}`);
  }
  for (let j = Math.floor(debutZone / 86_400_000); j < Math.floor(finZone / 86_400_000); j++) {
    if (dakarParts(new Date(j * 86_400_000)).isoWeekday === 7) assert.ok(dimanchesJour.has(j), `dimanche de jour non couvert : jour ${j}`);
  }
});
test("conséquence des règles validées : l'équipe de jour ne travaille jamais le dimanche et un agent de nuit passe en jour au plus tard au 8e poste, sans retour", () => {
  const jour = genererCycleJourUrgences(dakarDateTime(2026, 10, 12, 8), 80).postes.slice(3).map((p) => dakarParts(p.debut).isoWeekday);
  assert.deepEqual([...new Set(jour)].sort(), [1, 2, 3, 4, 5, 6]);
  const postes = genererCycleNuitUrgences(dakarDateTime(2026, 10, 12, 20), 80).postes;
  const k = postes.findIndex((p) => p.type === "jour");
  assert.ok(k > 0 && k <= 7, `premier poste de jour au rang ${k}`);
  assert.ok(postes.slice(k).every((p) => p.type === "jour"));
  assert.ok(!postes.slice(k + 1).some((p) => dakarParts(p.debut).isoWeekday === 7));
  const boucle = genererCycleNuitUrgences(dakarDateTime(2026, 10, 12, 20), 80, "nuit").postes;
  assert.ok(boucle.slice(-10).some((p) => p.type === "nuit")); // la variante « nuit » ne vide pas l'équipe de nuit
});
test("un retard de sortie allonge le repos et peut rendre le poste suivant incompatible", () => {
  const { postes } = genererCycleNuitUrgences(dakarDateTime(2026, 10, 12, 20), 2);
  const nuit = postes[0];
  const finReelle = dakarDateTime(2026, 10, 13, 9, 30);
  assert.deepEqual(verifierPostesUrgences(postes, new Map([[nuit.posteId, finReelle]])).map((x) => x.code), ["repos_insuffisant"]);
  assert.equal(iso(periodeRepos(nuit, finReelle).fin), "2026-10-15T21:30");
});
test("chevauchement et changement d'équipe détectés", () => {
  const jour = creerPosteJour(jour1);
  const chevauche = { ...creerPosteNuit(dakarDateTime(2026, 10, 12, 20)), debut: dakarDateTime(2026, 10, 12, 19) };
  assert.equal(verifierPostesUrgences([jour, chevauche])[0].code, "chevauchement");
  const nuit = creerPosteNuit(dakarDateTime(2026, 10, 14, 20)); // repos de 36 h respecté, mais changement d'équipe hors passage prévu
  assert.ok(verifierPostesUrgences([jour, nuit]).some((x) => x.code === "sequence_invalide"));
});
