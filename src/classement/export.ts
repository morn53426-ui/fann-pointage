import { versCsv } from "../rapports/csv.ts";
import type { Colonne } from "../rapports/csv.ts";
import type { ClassementMensuel } from "./types.ts";

const COLONNES: Colonne[] = [
  { cle: "rang", titre: "Rang" },
  { cle: "nom", titre: "Agent" },
  { cle: "service", titre: "Service" },
  { cle: "regime", titre: "Régime" },
  { cle: "score", titre: "Points sur 100" },
  { cle: "taux_presence", titre: "Présence (%)" },
  { cle: "retards", titre: "Retards" },
  { cle: "absences_injustifiees", titre: "Absences injustifiées validées" },
  { cle: "pointages_complets", titre: "Pointages complets" },
  { cle: "anomalies", titre: "Anomalies non résolues" },
  { cle: "hors_zone", titre: "Pointages hors zone" },
  { cle: "postes_planifies", titre: "Postes planifiés" },
  { cle: "postes_honores", titre: "Postes honorés" },
];

export function exporterClassementMensuelCsv(c: ClassementMensuel): { nomFichier: string; csv: string } {
  const lignes = c.classement.map((e) => ({
    rang: e.rang,
    nom: e.nom,
    service: e.service,
    regime: e.regime,
    score: e.score.toFixed(3),
    taux_presence: e.tauxPresence.toFixed(2),
    retards: e.retards,
    absences_injustifiees: e.absencesInjustifiees === null ? "Non disponible" : e.absencesInjustifiees,
    pointages_complets: e.pointagesComplets,
    anomalies: e.anomalies,
    hors_zone: e.pointagesHorsZone,
    postes_planifies: e.postesPlanifies,
    postes_honores: e.postesHonores,
  }));
  return { nomFichier: `classement-mensuel-${c.mois}.csv`, csv: versCsv(COLONNES, lignes) };
}
