// Garantit l'indépendance des trois régimes : aucun import croisé, aucun poste d'un autre régime accepté.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as garde from "./garde/index.ts";
import * as urgences from "./urgences/index.ts";
import * as general from "./general/index.ts";
import * as mobil from "./mobil/index.ts";
import { dakarDateTime } from "../shared/time.ts";
import { parseCle } from "../shared/civil.ts";

const noms = ["general", "garde", "urgences", "mobil"];

test("aucun module de régime n'importe un autre régime", () => {
  for (const r of noms) {
    const src = readFileSync(new URL(`./${r}/index.ts`, import.meta.url), "utf8");
    for (const autre of noms.filter((n) => n !== r)) {
      assert.doesNotMatch(src, new RegExp(`from\\s+["']\\.\\./${autre}/`), `${r} importe ${autre}`);
    }
    assert.doesNotMatch(src, /from\s+["']\.\.\/index/, `${r} importe l'index`);
  }
});
test("la garde refuse des postes des urgences, de Mobil et du service général", () => {
  const jour = urgences.creerPosteJour(dakarDateTime(2026, 10, 12, 8));
  const svc = general.posteDuJour(parseCle("2026-10-12"))!;
  const mobilNuit = mobil.creerPosteNuitMobil(dakarDateTime(2026, 10, 12, 16));
  assert.throws(() => garde.verifierGardes([jour]), { code: "regime_invalide" });
  assert.throws(() => garde.verifierGardes([svc]), { code: "regime_invalide" });
  assert.throws(() => garde.verifierGardes([mobilNuit]), { code: "regime_invalide" });
});
test("les urgences refusent une garde classique, Mobil et un poste de service", () => {
  const g = garde.creerGarde(dakarDateTime(2026, 10, 12, 8));
  const svc = general.posteDuJour(parseCle("2026-10-12"))!;
  const mobilNuit = mobil.creerPosteNuitMobil(dakarDateTime(2026, 10, 12, 16));
  assert.throws(() => urgences.verifierPostesUrgences([g]), { code: "regime_invalide" });
  assert.throws(() => urgences.verifierPostesUrgences([svc]), { code: "regime_invalide" });
  assert.throws(() => urgences.verifierPostesUrgences([mobilNuit]), { code: "regime_invalide" });
});
test("le service général refuse un poste de garde, d'urgences ou de Mobil", () => {
  const g = garde.creerGarde(dakarDateTime(2026, 10, 12, 8));
  const j = urgences.creerPosteJour(dakarDateTime(2026, 10, 12, 8));
  const m = mobil.creerPosteNuitMobil(dakarDateTime(2026, 10, 12, 16));
  assert.throws(() => general.evaluerPresenceGeneral(g, {}, new Date()), { code: "regime_invalide" });
  assert.throws(() => general.evaluerPresenceGeneral(j, {}, new Date()), { code: "regime_invalide" });
  assert.throws(() => general.evaluerPresenceGeneral(m, {}, new Date()), { code: "regime_invalide" });
});
test("cycles Urgences : jour tous les deux jours (36 h de repos), nuit tous les trois jours (60 h de repos)", () => {
  const g = garde.genererCycleGardes(dakarDateTime(2026, 10, 12, 8), 2);
  const jour = urgences.genererCycleJourUrgences(dakarDateTime(2026, 10, 12, 8), 2).postes;
  const nuit = urgences.genererCycleNuitUrgences(dakarDateTime(2026, 10, 12, 20), 2).postes;
  assert.equal(g[0].fin.getTime() - g[0].debut.getTime(), 24 * 3_600_000);
  assert.equal(jour[0].fin.getTime() - jour[0].debut.getTime(), 12 * 3_600_000);
  assert.equal(jour[1].debut.getTime() - jour[0].debut.getTime(), 48 * 3_600_000);
  assert.equal(nuit[1].debut.getTime() - nuit[0].debut.getTime(), 72 * 3_600_000);
});
