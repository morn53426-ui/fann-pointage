import { test } from "node:test";
import assert from "node:assert/strict";
import { creerGarde, estEnRepos, genererCycleGardes, periodeRepos, verifierGardes } from "./index.ts";
import { dakarDateTime } from "../../shared/time.ts";

const lundi = dakarDateTime(2026, 10, 12, 8); // lundi 12/10/2026 08 h

test("garde de 08 h à 08 h le lendemain (24 h)", () => {
  const g = creerGarde(lundi);
  assert.equal(g.fin.toISOString(), "2026-10-13T08:00:00.000Z");
  assert.equal(g.fin.getTime() - g.debut.getTime(), 24 * 3_600_000);
});
test("refuse une garde standard qui ne commence pas à 08 h", () => {
  assert.throws(() => creerGarde(dakarDateTime(2026, 10, 12, 9)), { code: "horaire_invalide" });
});
test("repos de 48 h : deux jours de repos, prochaine garde jeudi 08 h", () => {
  const g = creerGarde(lundi);
  const r = periodeRepos(g);
  assert.equal(r.debut.toISOString(), "2026-10-13T08:00:00.000Z");
  assert.equal(r.fin.toISOString(), "2026-10-15T08:00:00.000Z");
  assert.equal(estEnRepos(dakarDateTime(2026, 10, 13, 12), [g]), true);
  assert.equal(estEnRepos(dakarDateTime(2026, 10, 14, 12), [g]), true);
  assert.equal(estEnRepos(dakarDateTime(2026, 10, 15, 8), [g]), false);
});
test("cycle : gardes les 12, 15, 18/10 sans conflit", () => {
  const c = genererCycleGardes(lundi, 3);
  assert.deepEqual(c.map((g) => g.debut.getUTCDate()), [12, 15, 18]);
  assert.deepEqual(verifierGardes(c), []);
});
test("jour férié : la garde n'est pas supprimée (aucun paramètre férié dans le moteur)", () => {
  assert.equal(genererCycleGardes(dakarDateTime(2026, 12, 24, 8), 2).length, 2);
});
test("conflit : chevauchement", () => {
  const a = creerGarde(lundi), b = creerGarde(dakarDateTime(2026, 10, 12, 8));
  const b2 = { ...b, posteId: "autre" };
  assert.equal(verifierGardes([a, b2])[0].code, "chevauchement");
});
test("conflit : repos de 48 h non respecté (garde mercredi 08 h)", () => {
  const c = verifierGardes([creerGarde(lundi), creerGarde(dakarDateTime(2026, 10, 14, 8))]);
  assert.deepEqual(c.map((x) => x.code), ["repos_insuffisant"]);
});
test("repos calculé depuis la fin réelle", () => {
  const g = creerGarde(lundi);
  const reelle = dakarDateTime(2026, 10, 13, 10);
  const suivante = creerGarde(dakarDateTime(2026, 10, 15, 8));
  assert.equal(verifierGardes([g, suivante], new Map([[g.posteId, reelle]]))[0].code, "repos_insuffisant");
});

test("la règle de repos autorise exactement 48 h après la fin d'une garde", () => {
  const premiere = creerGarde(dakarDateTime(2026, 10, 12, 8));
  const suivante = creerGarde(dakarDateTime(2026, 10, 15, 8));
  assert.equal(suivante.debut.getTime() - premiere.fin.getTime(), 48 * 3_600_000);
  assert.deepEqual(verifierGardes([premiere, suivante]), []);
});
