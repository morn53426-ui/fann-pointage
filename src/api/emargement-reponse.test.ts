import { test } from "node:test";
import assert from "node:assert/strict";
import { construireEmargement } from "../rapports/emargement.ts";
import { CSSI_PAR_DEFAUT, nomCssiSur, reponseEmargement } from "./emargement-reponse.ts";
import { ErreurRegime } from "../shared/types.ts";

const emargement = construireEmargement({
  dateDansLaSemaine: "2026-10-14",
  agents: [{ id: "a1", prenom: "Awa", nom: "SECK", serviceId: "s1", regime: "general", actif: true }, { id: "a2", prenom: "Ibou", nom: "FALL", serviceId: "s2", regime: "general", actif: true }],
  services: [{ id: "s1", nom: "CTCV" }, { id: "s2", nom: "Pédiatrie" }],
  postes: [],
});

test("nom de la CSSI : nettoyé, limité à 80 caractères, valeur par défaut si vide", () => {
  assert.equal(nomCssiSur(undefined), CSSI_PAR_DEFAUT);
  assert.equal(nomCssiSur("  \u0001<>  "), CSSI_PAR_DEFAUT);
  assert.equal(nomCssiSur("  Mme <b>Sow\u0007  "), "Mme bSow");
  assert.equal(nomCssiSur("x".repeat(200)).length, 80);
});

test("réponse d'émargement : aperçu JSON par défaut, Excel à la demande, filtre par service, service inconnu refusé", () => {
  const apercu = reponseEmargement(emargement, {});
  assert.equal(apercu.statut, 200); assert.equal(apercu.corps, emargement);
  const tous = reponseEmargement(emargement, { format: "xlsx" }).corps as { nomFichier: string; contenuBase64: string };
  assert.equal(tous.nomFichier, "emargement-brancardiers-2026-10-12.xlsx");
  const un = reponseEmargement(emargement, { format: "xlsx", serviceId: "s1" }).corps as { contenuBase64: string };
  assert.equal(Buffer.from(un.contenuBase64, "base64").readUInt32LE(0), 0x04034b50);
  assert.ok(Buffer.from(un.contenuBase64, "base64").length < Buffer.from(tous.contenuBase64, "base64").length, "un seul onglet = classeur plus petit");
  assert.throws(() => reponseEmargement(emargement, { format: "xlsx", serviceId: "inconnu" }), (e) => e instanceof ErreurRegime && e.code === "introuvable");
});
