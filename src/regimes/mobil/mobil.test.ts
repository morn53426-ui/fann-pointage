import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCle } from "../../shared/civil.ts";
import { dakarDateTime } from "../../shared/time.ts";
import { creerPosteJourMobil, creerPosteNuitMobil, genererCycleNuitsMobil, genererJoursMobil, periodeReposNuitMobil, verifierPlanningsMobil } from "./index.ts";

const lundi = dakarDateTime(2026, 10, 12, 16);

test("Mobil garde normale : lundi 16 h → mardi 08 h, puis 56 h de repos", () => {
  const garde = creerPosteNuitMobil(lundi);
  const repos = periodeReposNuitMobil(garde);
  assert.equal(garde.fin.toISOString(), "2026-10-13T08:00:00.000Z");
  assert.equal(repos.fin.toISOString(), "2026-10-15T16:00:00.000Z");
  assert.equal(repos.fin.getTime() - garde.fin.getTime(), 56 * 3_600_000);
});

test("Mobil garde de week-end : samedi 08 h → dimanche 08 h, puis 56 h de repos", () => {
  const garde = creerPosteNuitMobil(dakarDateTime(2026, 10, 17, 8));
  const repos = periodeReposNuitMobil(garde);
  assert.equal(garde.fin.toISOString(), "2026-10-18T08:00:00.000Z");
  assert.equal(repos.fin.toISOString(), "2026-10-20T16:00:00.000Z");
  assert.equal(repos.fin.getTime() - garde.fin.getTime(), 56 * 3_600_000);
});

test("Mobil garde un jour férié en semaine : 08 h → 08 h le lendemain", () => {
  const feries = new Set(["2026-10-14"]);
  const garde = creerPosteNuitMobil(dakarDateTime(2026, 10, 14, 8), feries);
  assert.equal(garde.fin.toISOString(), "2026-10-15T08:00:00.000Z");
  assert.equal(garde.fin.getTime() - garde.debut.getTime(), 24 * 3_600_000);
  assert.throws(() => creerPosteNuitMobil(dakarDateTime(2026, 10, 14, 16), feries), /08 h 00/);
});

test("cycle Mobil : chaque nouvelle garde respecte au moins 56 h après la fin précédente", () => {
  const postes = genererCycleNuitsMobil(lundi, 4);
  assert.deepEqual(postes.map((p) => p.debut.toISOString()), [
    "2026-10-12T16:00:00.000Z",
    "2026-10-15T16:00:00.000Z",
    "2026-10-19T16:00:00.000Z",
    "2026-10-22T16:00:00.000Z",
  ]);
  assert.deepEqual(verifierPlanningsMobil(postes), []);
  for (let i = 1; i < postes.length; i++) {
    assert.ok(postes[i]!.debut.getTime() - postes[i - 1]!.fin.getTime() >= 56 * 3_600_000);
  }
});

test("cycle Mobil : après une garde de 24 h le samedi, reprise mardi à 16 h après 56 h", () => {
  const postes = genererCycleNuitsMobil(dakarDateTime(2026, 10, 17, 8), 2);
  assert.deepEqual(postes.map((p) => p.debut.toISOString()), ["2026-10-17T08:00:00.000Z", "2026-10-20T16:00:00.000Z"]);
  assert.equal(postes[0]!.fin.toISOString(), "2026-10-18T08:00:00.000Z");
  assert.equal(postes[1]!.debut.getTime() - postes[0]!.fin.getTime(), 56 * 3_600_000);
});

test("cycle Mobil : jour férié en semaine converti en garde de 24 h", () => {
  const feries = new Set(["2026-10-14"]);
  const postes = genererCycleNuitsMobil(dakarDateTime(2026, 10, 14, 16), 2, feries);
  assert.equal(postes[0]!.debut.toISOString(), "2026-10-14T08:00:00.000Z");
  assert.equal(postes[0]!.fin.toISOString(), "2026-10-15T08:00:00.000Z");
  assert.equal(postes[1]!.debut.toISOString(), "2026-10-18T08:00:00.000Z");
  assert.ok(postes[1]!.debut.getTime() - postes[0]!.fin.getTime() >= 56 * 3_600_000);
});

test("Mobil jour : lundi–vendredi, les week-ends et jours fériés sont exclus par défaut", () => {
  const postes = genererJoursMobil(parseCle("2026-10-12"), parseCle("2026-10-18"), new Set(["2026-10-14"]));
  assert.deepEqual(postes.map((p) => p.debut.toISOString().slice(0, 10)), ["2026-10-12", "2026-10-13", "2026-10-15", "2026-10-16"]);
  assert.ok(postes.every((p) => p.type === "jour" && p.fin.getTime() - p.debut.getTime() === 8 * 3_600_000));
});

test("Mobil jour : un responsable peut demander explicitement week-ends et jours fériés", () => {
  const postes = genererJoursMobil(parseCle("2026-10-12"), parseCle("2026-10-18"), new Set(["2026-10-14"]), { inclureWeekEnds: true, inclureJoursFeries: true });
  assert.equal(postes.length, 7);
});

test("Mobil bloque un autre poste commencé avant la fin des 56 heures de repos", () => {
  const garde = creerPosteNuitMobil(lundi);
  const autre = creerPosteJourMobil(dakarDateTime(2026, 10, 15, 8));
  assert.equal(verifierPlanningsMobil([garde, autre]).find((x) => x.code === "repos_insuffisant")?.gravite, "erreur");
});

test("Mobil refuse une reprise avant les 56 h après la garde de 24 h", () => {
  const garde = creerPosteNuitMobil(dakarDateTime(2026, 10, 17, 8));
  const tropTot = creerPosteJourMobil(dakarDateTime(2026, 10, 20, 8));
  assert.equal(verifierPlanningsMobil([garde, tropTot]).find((x) => x.code === "repos_insuffisant")?.gravite, "erreur");
});

test("Mobil accepte une prochaine prise exactement à la fin du repos", () => {
  const garde = creerPosteNuitMobil(lundi);
  const suivante = creerPosteNuitMobil(dakarDateTime(2026, 10, 15, 16));
  assert.deepEqual(verifierPlanningsMobil([garde, suivante]), []);
});

test("Mobil refuse des horaires de début incorrects", () => {
  assert.throws(() => creerPosteNuitMobil(dakarDateTime(2026, 10, 12, 20)), /16 h 00/);
  assert.throws(() => creerPosteNuitMobil(dakarDateTime(2026, 10, 17, 16)), /08 h 00/);
  assert.throws(() => creerPosteJourMobil(dakarDateTime(2026, 10, 12, 9)), /08 h 00/);
});
