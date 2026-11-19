import { test } from "node:test";
import assert from "node:assert/strict";
import { detecterAnomalies } from "./detection.ts";
import { agent, jeuDemo, poste, T } from "../dashboard/jeu.ts";
import * as garde from "../regimes/garde/index.ts";
import * as urgences from "../regimes/urgences/index.ts";
import type { ActeurApp } from "../dashboard/donnees.ts";

const admin: ActeurApp = { id: "adm", role: "administrateur", servicesGeres: [] };
const types = (l: { type: string }[]) => l.map((a) => a.type);

test("retard, hors zone et vérification manuelle détectés à 10 h", () => {
  const a = detecterAnomalies(jeuDemo(), admin, T(12, 10));
  assert.ok(types(a).includes("retard") && types(a).includes("hors_zone") && types(a).includes("verification_manuelle"));
  assert.equal(a.find((x) => x.type === "retard")!.message, "Retard de 32 min");
});
test("absence à confirmer et pointage incomplet à 17 h", () => {
  const d = jeuDemo();
  const a = detecterAnomalies(d, admin, T(12, 17));
  assert.ok(types(a).includes("pointage_incomplet"));
  d.pointages = d.pointages.filter((p) => p.agentId !== "n1");
  assert.ok(types(detecterAnomalies(d, admin, T(12, 17))).includes("absence_a_confirmer"));
});
test("repos de 48 h non respecté entre deux gardes : conflit détecté", () => {
  const d = jeuDemo();
  d.agents.push(agent("g3", "s-gar", "garde"));
  d.postes.push(poste("g3", "s-gar", garde.creerGarde(T(12, 8)), 1), poste("g3", "s-gar", garde.creerGarde(T(13, 8)), 2));
  const a = detecterAnomalies(d, admin, T(12, 10)).filter((x) => x.agentId === "g3");
  assert.deepEqual(types(a), ["repos_insuffisant"]);
  assert.equal(a[0].regime, "garde");
});
test("urgences : repos diurne minimal de 12 h non respecté", () => {
  const d = jeuDemo();
  d.agents.push(agent("u9", "s-urg", "urgences"));
  const nuit = urgences.creerPosteNuit(T(12, 20));
  const trop = { ...urgences.creerPosteJour(T(13, 8)), debut: T(13, 19), fin: T(14, 7), posteId: "urgences:jour:test" };
  d.postes.push(poste("u9", "s-urg", nuit, 1), poste("u9", "s-urg", trop, 2));
  assert.ok(types(detecterAnomalies(d, admin, T(13, 0))).includes("repos_insuffisant"));
});
test("portée : un responsable ne voit pas les anomalies des autres services", () => {
  const a = detecterAnomalies(jeuDemo(), { id: "r2", role: "responsable", servicesGeres: ["s-urg"] }, T(12, 10));
  assert.ok(a.every((x) => x.serviceId === "s-urg"));
  assert.equal(a.some((x) => x.type === "hors_zone"), false); // le hors zone concerne la garde
});
test("anomalies triées par gravité", () => {
  const d = jeuDemo();
  d.pointages.push({ ...d.pointages[0], id: "sus", idempotencyKey: "sus", positionSuspecte: true });
  assert.equal(detecterAnomalies(d, admin, T(12, 10))[0].gravite, "erreur");
});
