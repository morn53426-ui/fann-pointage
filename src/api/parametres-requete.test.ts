import { test } from "node:test";
import assert from "node:assert/strict";
import { dateCle, filtres, typeRapport } from "./parametres-requete.ts";
import { ErreurRegime } from "../shared/types.ts";

const refus = (e: unknown) => e instanceof ErreurRegime && e.code === "requete_invalide";

test("filtres : valeurs connues acceptées, valeurs inconnues refusées", () => {
  assert.deepEqual(filtres({}), {});
  assert.deepEqual(filtres({ service: "s1", agent: "a1", regime: "garde", validation: "a_verifier", statutLocalisation: "dans_zone" }),
    { serviceId: "s1", agentId: "a1", regime: "garde", validation: "a_verifier", statutLocalisation: "dans_zone" });
  assert.throws(() => filtres({ regime: "inconnu" }), refus);
  assert.throws(() => filtres({ validation: "x" }), refus);
  assert.throws(() => filtres({ statutLocalisation: "x" }), refus);
});

test("date et type de rapport : valeurs par défaut, dates réelles seulement", () => {
  const now = new Date("2026-10-14T09:00:00.000Z");
  assert.equal(dateCle({}, now), "2026-10-14");
  assert.equal(dateCle({ date: "2026-02-28" }, now), "2026-02-28");
  assert.throws(() => dateCle({ date: "2026-02-31" }, now), refus);
  assert.equal(typeRapport({}), "jour");
  assert.equal(typeRapport({ type: "mois" }), "mois");
  assert.throws(() => typeRapport({ type: "annee" }), refus);
});
