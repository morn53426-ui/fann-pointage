import { CRITERES_SCORE } from "./types.ts";
import type { CritereDepartage, CritereScore, ReglesScore } from "./types.ts";

/** Pondérations provisoires sur 100 points. Aucun seuil d'exclusion n'est appliqué. */
export const REGLES_SCORE_DEFAUT: ReglesScore = {
  version: 1,
  criteres: {
    taux_presence: 40,
    ponctualite: 20,
    absences_injustifiees: 15,
    pointages_complets: 10,
    anomalies: 10,
    hors_zone: 5,
  },
  departage: ["taux_presence", "absences_injustifiees", "retards", "pointages_complets"],
};

const DEPARTAGE_VALIDES = new Set<CritereDepartage>([
  "taux_presence", "absences_injustifiees", "retards", "pointages_complets",
]);

export function validerReglesScore(r: ReglesScore): ReglesScore {
  if (!Number.isInteger(r.version) || r.version < 1) throw new Error("Version des règles de score invalide.");
  let poidsTotal = 0;
  for (const critere of CRITERES_SCORE) {
    const poids = r.criteres[critere];
    if (!Number.isFinite(poids) || poids < 0 || poids > 100) throw new Error(`Pondération invalide pour ${critere}.`);
    poidsTotal += poids;
  }
  if (poidsTotal <= 0) throw new Error("Au moins un critère doit avoir une pondération positive.");
  if (r.departage.length === 0 || r.departage.some((x) => !DEPARTAGE_VALIDES.has(x)) || new Set(r.departage).size !== r.departage.length) {
    throw new Error("La liste des critères de départage est invalide.");
  }
  return { ...r, criteres: { ...r.criteres }, departage: [...r.departage] };
}

export function poidsTotal(r: ReglesScore): number {
  return CRITERES_SCORE.reduce((sum, k: CritereScore) => sum + r.criteres[k], 0);
}
