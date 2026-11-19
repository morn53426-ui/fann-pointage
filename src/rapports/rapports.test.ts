import { test } from "node:test";
import assert from "node:assert/strict";
import { genererRapport, exporterCsv, colonnesAutorisees } from "./rapport.ts";
import { periodePour } from "./periode.ts";
import { versCsv } from "./csv.ts";
import { jeuDemo, pointage, T } from "../dashboard/jeu.ts";
import type { ActeurApp, DonneesPeriode } from "../dashboard/donnees.ts";

const admin: ActeurApp = { id: "adm", role: "administrateur", servicesGeres: [] };
const resp: ActeurApp = { id: "r1", role: "responsable", servicesGeres: ["s-urg", "s-gen"] };
const maintenant = T(14, 9);

function donnees(): DonneesPeriode {
  const d = jeuDemo();
  const p = (agentId: string, type: "service" | "garde" | "nuit" | "jour") => d.postes.find((x) => x.agentId === agentId && x.type === type)!;
  const svc = (id: string) => d.agents.find((a) => a.id === id)!.serviceId;
  d.pointages = [
    pointage({ agentId: "n1", serviceId: svc("n1"), posteId: p("n1", "service").posteId, type: "arrivee", serverTs: T(12, 8, 0, 30) }),
    pointage({ agentId: "n1", serviceId: svc("n1"), posteId: p("n1", "service").posteId, type: "depart", serverTs: T(12, 16, 0, 10) }),
    // nuit u3 : arrivée 19 h 58 le 12, départ 08 h 03 le 13 (passage de minuit)
    pointage({ agentId: "u3", serviceId: "s-urg", posteId: p("u3", "nuit").posteId, type: "arrivee", serverTs: T(12, 19, 58) }),
    pointage({ agentId: "u3", serviceId: "s-urg", posteId: p("u3", "nuit").posteId, type: "depart", serverTs: T(13, 8, 3) }),
    // garde g1 : 24 h
    pointage({ agentId: "g1", serviceId: "s-gar", posteId: p("g1", "garde").posteId, type: "arrivee", serverTs: T(12, 8, 0) }),
    pointage({ agentId: "g1", serviceId: "s-gar", posteId: p("g1", "garde").posteId, type: "depart", serverTs: T(13, 8, 0) }),
    // u1 : arrivée en retard, hors zone d'abord (refusé), validation manuelle ensuite
    pointage({ agentId: "u1", serviceId: "s-urg", posteId: p("u1", "jour").posteId, type: "arrivee", serverTs: T(12, 8, 32), validation: "valide_manuellement",
      statutLocalisation: "hors_zone", distanceM: 222, valideManuellementPar: "r1", motifValidationManuelle: "GPS en panne" }),
  ];
  return d;
}

test("périodes : jour, semaine (lundi à dimanche), mois", () => {
  assert.deepEqual([periodePour("jour", "2026-10-12").debut.toISOString(), periodePour("jour", "2026-10-12").fin.toISOString()], ["2026-10-12T00:00:00.000Z", "2026-10-13T00:00:00.000Z"]);
  const s = periodePour("semaine", "2026-10-15");
  assert.deepEqual([s.debut.toISOString(), s.fin.toISOString()], ["2026-10-12T00:00:00.000Z", "2026-10-19T00:00:00.000Z"]);
  assert.equal(periodePour("mois", "2026-12-20").fin.toISOString(), "2027-01-01T00:00:00.000Z");
});
test("poste de nuit : calculé sur 12 h réelles, rattaché au jour de début", () => {
  const r = genererRapport(donnees(), admin, "jour", "2026-10-12", maintenant);
  const nuit = r.lignes.find((l) => l.type_poste === "nuit")!;
  assert.deepEqual([nuit.prevu_debut, nuit.prevu_fin, nuit.duree_reelle_min, nuit.statut_presence], ["2026-10-12 20:00", "2026-10-13 08:00", 725, "complet"]);
  assert.equal(genererRapport(donnees(), admin, "jour", "2026-10-13", maintenant).lignes.filter((l) => l.agentId === "u3").length, 0); // la nuit de u3 appartient au 12/10
});
test("garde : 24 h calculées", () => {
  const g = genererRapport(donnees(), admin, "jour", "2026-10-12", maintenant).lignes.find((l) => l.type_poste === "garde")!;
  assert.equal(g.duree_reelle_min, 1440);
});
test("pas de doublon : une ligne par poste", () => {
  const r = genererRapport(donnees(), admin, "mois", "2026-10-01", maintenant);
  const cles = r.lignes.map((l) => `${l.agentId}|${l.prevu_debut}|${l.type_poste}`);
  assert.equal(new Set(cles).size, cles.length);
});
test("synthèse : retard, validation manuelle, hors zone, repos prévus", () => {
  const s = genererRapport(donnees(), admin, "jour", "2026-10-12", maintenant).synthese;
  const u1 = s.find((x) => x.agentId === "u1")!;
  assert.deepEqual([u1.retards, u1.retard_total_min, u1.validations_manuelles, u1.pointages_hors_zone, u1.postes_jour], [1, 32, 1, 1, 1]);
  const hebdo = genererRapport(donnees(), admin, "semaine", "2026-10-12", maintenant).synthese;
  assert.match(hebdo.find((x) => x.agentId === "g1")!.repos_prevus, /2026-10-13 08:00 -> 2026-10-15 08:00/);
  assert.equal(s.find((x) => x.agentId === "g1")!.repos_prevus, ""); // le repos commence le 13/10, hors du rapport du 12/10
});
test("responsable : uniquement ses services ; brancardier : uniquement lui-même", () => {
  const r = genererRapport(donnees(), resp, "jour", "2026-10-12", maintenant);
  assert.equal(r.lignes.some((l) => l.agentId === "g1"), false);
  const b = genererRapport(donnees(), { id: "x", role: "brancardier", servicesGeres: [], agentId: "n1" }, "mois", "2026-10-01", maintenant);
  assert.ok(b.lignes.length > 0 && b.lignes.every((l) => l.agentId === "n1"));
  assert.throws(() => genererRapport(donnees(), { id: "x", role: "brancardier", servicesGeres: [] }, "jour", "2026-10-12", maintenant), { code: "non_autorise" });
});
test("export CSV : coordonnées réservées à l'administrateur", () => {
  const r = genererRapport(donnees(), admin, "jour", "2026-10-12", maintenant);
  const csvAdmin = exporterCsv(r, admin).csv;
  const csvResp = exporterCsv(r, resp).csv;
  assert.match(csvAdmin.split("\r\n")[0], /Latitude/);
  assert.doesNotMatch(csvResp.split("\r\n")[0], /Latitude|Longitude/);
  assert.doesNotMatch(csvResp, /14\.0005/);
  const b = colonnesAutorisees({ id: "x", role: "brancardier", servicesGeres: [], agentId: "n1" }).map((c) => c.cle);
  assert.equal(b.includes("latitude") || b.includes("motif_validation_manuelle"), false);
});
test("export CSV : BOM, séparateur ';', guillemets et protection contre l'injection de formules", () => {
  const csv = versCsv([{ cle: "a", titre: "A" }, { cle: "b", titre: "B" }], [{ a: "=SOMME(A1)", b: 'dit "oui"; non' }, { a: "+33", b: -5 }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.equal(csv.split("\r\n")[1], `'=SOMME(A1);"dit ""oui""; non"`);
  assert.equal(csv.split("\r\n")[2], "'+33;-5");
});
test("export des pointages et de la synthèse", () => {
  const r = genererRapport(donnees(), admin, "jour", "2026-10-12", maintenant);
  assert.equal(exporterCsv(r, admin).csv.trim().split("\r\n").length, r.lignes.length + 1);
  assert.ok(exporterCsv(r, admin, "synthese").nomFichier.startsWith("synthese-"));
});
