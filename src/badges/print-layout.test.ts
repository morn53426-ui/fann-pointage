import { test } from "node:test";
import assert from "node:assert/strict";
import { ordonnerVersoBadges, repartirLotsBadges } from "../../web/badge-print-layout.js";

const ids = (valeurs: (string | null)[]) => valeurs;

test("verso : un badge seul réserve la colonne gauche et place le badge à droite", () => {
  assert.deepEqual(ordonnerVersoBadges(["A"]), ids([null, "A"]));
});

test("verso : les paires échangent leurs colonnes sans changer de rangée", () => {
  assert.deepEqual(ordonnerVersoBadges(["A", "B", "C", "D"]), ["B", "A", "D", "C"]);
});

test("verso : 3 badges préservent le créneau vide avant le dernier badge", () => {
  assert.deepEqual(ordonnerVersoBadges(["A", "B", "C"]), ["B", "A", null, "C"]);
});

test("verso : 7 badges remplissent 8 créneaux et alignent le septième à droite", () => {
  const ordre = ordonnerVersoBadges(["A", "B", "C", "D", "E", "F", "G"]);
  assert.deepEqual(ordre, ["B", "A", "D", "C", "F", "E", null, "G"]);
  assert.equal(ordre.length, 8);
});

test("verso : une feuille complète de 8 badges reste composée de 8 créneaux", () => {
  const ordre = ordonnerVersoBadges(["A", "B", "C", "D", "E", "F", "G", "H"]);
  assert.deepEqual(ordre, ["B", "A", "D", "C", "F", "E", "H", "G"]);
  assert.equal(ordre.length, 8);
  assert.equal(ordre.some((item) => item === null), false);
});

test("répartition : 1, 3, 7 et 8 badges tiennent sur une feuille ; 9 nécessitent deux feuilles", () => {
  for (const n of [1, 3, 7, 8]) {
    const lots = repartirLotsBadges(Array.from({ length: n }, (_, i) => i));
    assert.equal(lots.length, 1, `${n} badge(s)`);
    assert.equal(lots[0].length, n);
  }
  const lots = repartirLotsBadges(Array.from({ length: 9 }, (_, i) => i));
  assert.deepEqual(lots.map((lot) => lot.length), [8, 1]);
  assert.deepEqual(lots.flat(), Array.from({ length: 9 }, (_, i) => i));
});

test("répartition : taille invalide rejetée explicitement", () => {
  assert.throws(() => repartirLotsBadges([1, 2], 0), RangeError);
  assert.throws(() => repartirLotsBadges([1, 2], 1.5), RangeError);
});
