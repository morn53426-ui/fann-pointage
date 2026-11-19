import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { creerDemo } from "./demo.ts";

const NOW = new Date("2026-10-12T10:00:00.000Z");

test("persistance locale : les événements non synthétiques sont restaurés après redémarrage", async () => {
  const dossier = await mkdtemp(join(tmpdir(), "fann-pointage-test-"));
  const fichier = join(dossier, "pointages-demo.json");
  try {
    const premier = creerDemo(NOW, { motDePasse: "motdepasse-de-test" }).magasin;
    await premier.activerPersistanceLocale(fichier);
    const sauvegarde = await premier.enregistrer({
      agentId: "n1", serviceId: "s-gen", planningId: "pl-n1-0", posteId: "poste-test", zoneId: null,
      type: "arrivee", serverTs: NOW, capturedTs: new Date("2026-10-12T09:59:30.000Z"), validation: "a_verifier", motifRefus: "pointage_hors_ligne_a_verifier",
      idempotencyKey: "station-offline-test-01", statutLocalisation: "indisponible", latitude: null, longitude: null,
      precisionM: null, positionCollecteeLe: null, distanceM: null, methodeLoc: "poste_partage_sans_gps",
      positionSuspecte: false, appVersion: "test", tokenHash: null, source: "station_hors_ligne",
      valideManuellementPar: null, motifValidationManuelle: null,
    });
    await premier.journaliser({ type: "test-persistence", agentId: "n1", at: NOW, detail: { pointageId: sauvegarde.id } });

    const deuxieme = creerDemo(NOW, { motDePasse: "motdepasse-de-test" }).magasin;
    await deuxieme.activerPersistanceLocale(fichier);
    const restaure = deuxieme.pointages.find((p) => p.idempotencyKey === "station-offline-test-01");
    if (!restaure) throw new Error("Le pointage n'a pas été restauré");
    assert.equal(restaure.validation, "a_verifier");
    assert.ok(restaure.serverTs instanceof Date);
    assert.equal(restaure.serverTs.toISOString(), NOW.toISOString());
    assert.ok(restaure.capturedTs instanceof Date);
    assert.equal(restaure.capturedTs?.toISOString(), "2026-10-12T09:59:30.000Z");
    assert.ok(deuxieme.journal.some((e) => e.type === "test-persistence"));
    const fichierTexte = await readFile(fichier, "utf8");
    assert.match(fichierTexte, /station-offline-test-01/);
    assert.doesNotMatch(fichierTexte, /motdepasse-de-test/);
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});


test("persistance locale : les services et agents créés pour les badges survivent au redémarrage", async () => {
  const dossier = await mkdtemp(join(tmpdir(), "fann-badges-test-"));
  const fichier = join(dossier, "pointages-demo.json");
  try {
    const premier = creerDemo(NOW, { motDePasse: "motdepasse-de-test" }).magasin;
    await premier.activerPersistanceLocale(fichier);
    await premier.ajouterServiceManuellement({ id: "service-chirurgie-test", nom: "Chirurgie plastique" });
    await premier.ajouterAgentManuellement({ id: "agent-badge-test", nom: "Ndiaye", prenom: "Awa", matricule: "FANN-B-001", serviceId: "service-chirurgie-test", regime: "general", actif: true });
    await premier.enregistrerPhotoAgent("agent-badge-test", "data:image/jpeg;base64,/9j/4A==");

    const deuxieme = creerDemo(NOW, { motDePasse: "motdepasse-de-test" }).magasin;
    await deuxieme.activerPersistanceLocale(fichier);
    assert.ok(deuxieme.services.some((s) => s.id === "service-chirurgie-test" && s.nom === "Chirurgie plastique"));
    assert.ok(deuxieme.infosAgents.some((a) => a.id === "agent-badge-test" && a.prenom === "Awa" && a.serviceId === "service-chirurgie-test"));
    assert.equal((await deuxieme.agent("agent-badge-test"))?.actif, true);
    assert.equal(deuxieme.photosAgents.get("agent-badge-test"), "data:image/jpeg;base64,/9j/4A==");
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
});


test("persistance locale v4 : jeton de badge renouvelé, absence validée et classement restaurés", async () => {
  const dossier = await mkdtemp(join(tmpdir(), "fann-persist-v4-"));
  const fichier = join(dossier, "pointages-demo.json");
  try {
    const premier = creerDemo(NOW, { motDePasse: "motdepasse-de-test" }).magasin;
    await premier.activerPersistanceLocale(fichier);
    await premier.ajouterServiceManuellement({ id: "service-persist-v4", nom: "Service persistance" });
    await premier.ajouterAgentManuellement({ id: "agent-persist-v4", nom: "Diop", prenom: "Mariama", matricule: "PERS-V4", serviceId: "service-persist-v4", regime: "general", actif: true });
    const code = await premier.obtenirCodeBadge("agent-persist-v4");
    assert.match(code, /^FANN-BADGE:agent-persist-v4:[A-Za-z0-9_-]{40,100}$/);
    const absence = { id: "absence-persist-v4", agentId: "agent-persist-v4", debut: "2026-10-01", fin: "2026-10-01", categorie: "absence", note: null, statut: "injustifiee" as const, creePar: "admin", creeLe: NOW.toISOString(), validePar: "admin", valideLe: NOW.toISOString(), motifValidation: "Décision de test validée" };
    await premier.creerAbsence({ ...absence, statut: "a_confirmer", validePar: null, valideLe: null, motifValidation: null });
    await premier.deciderAbsence(absence.id, "injustifiee", "admin", "Décision de test validée", NOW);
    const classement = { id: "classement-persist-v4", mois: "2026-09-01", versionRegles: 1, genereLe: NOW.toISOString(), generePar: "admin", scores: [], classement: [], top5: [], audit: [] };
    await premier.enregistrerClassementMensuel("2026-09-01", classement as never);
    const ancien = premier.jetonsBadges.get("agent-persist-v4");
    const deuxieme = creerDemo(NOW, { motDePasse: "motdepasse-de-test" }).magasin;
    await deuxieme.activerPersistanceLocale(fichier);
    assert.equal(deuxieme.absences.get(absence.id)?.statut, "injustifiee");
    assert.equal(deuxieme.classementsMensuels.get("2026-09-01")?.id, classement.id);
    assert.equal(deuxieme.jetonsBadges.get("agent-persist-v4"), ancien);
    assert.equal(deuxieme.verifierJetonBadge("agent-persist-v4", (await deuxieme.obtenirCodeBadge("agent-persist-v4")).split(":")[2]), true);
  } finally { await rm(dossier, { recursive: true, force: true }); }
});
