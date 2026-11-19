export const CRITERES_SCORE = [
  "taux_presence",
  "ponctualite",
  "absences_injustifiees",
  "pointages_complets",
  "anomalies",
  "hors_zone",
] as const;

export type CritereScore = (typeof CRITERES_SCORE)[number];
export type CritereDepartage = "taux_presence" | "absences_injustifiees" | "retards" | "pointages_complets";

/** Pondérations du calcul de points, sans seuil d'éligibilité ni donnée financière. */
export interface ReglesScore {
  version: number;
  criteres: Record<CritereScore, number>;
  departage: CritereDepartage[];
}

/** Mesures mensuelles agrégées depuis les plannings et les pointages. */
export interface DonneesAgentMensuelles {
  agentId: string;
  nom: string;
  service: string;
  regime: "general" | "garde" | "urgences" | "mobil";
  postesPlanifies: number;
  postesHonores: number;
  retards: number;
  /** null = donnée non raccordée/non disponible ; ne doit pas être interprété comme zéro absence. */
  absencesInjustifiees: number | null;
  pointagesComplets: number;
  anomaliesNonResolues: number;
  pointagesHorsZone: number;
}

export interface ScoreMensuel {
  agentId: string;
  nom: string;
  service: string;
  regime: DonneesAgentMensuelles["regime"];
  scoreTotal: number;
  tauxPresence: number;
  retards: number;
  absencesInjustifiees: number | null;
  pointagesComplets: number;
  anomalies: number;
  pointagesHorsZone: number;
  postesPlanifies: number;
  postesHonores: number;
  /** null indique qu'un critère ne peut pas être évalué faute de données fiables. */
  detail: Record<CritereScore, number | null>;
}

export interface EntreeClassement {
  agentId: string;
  nom: string;
  service: string;
  regime: DonneesAgentMensuelles["regime"];
  rang: number;
  score: number;
  tauxPresence: number;
  retards: number;
  absencesInjustifiees: number | null;
  pointagesComplets: number;
  anomalies: number;
  pointagesHorsZone: number;
  postesPlanifies: number;
  postesHonores: number;
}

export interface EvenementAuditClassement {
  id: string;
  at: string;
  acteurId: string;
  action: "classement_mensuel_genere";
  detail: Record<string, unknown>;
}

/** Photographie mensuelle calculée : toutes les positions sont déterminées automatiquement. */
export interface ClassementMensuel {
  id: string;
  mois: string;
  versionRegles: number;
  genereLe: string;
  generePar: string;
  scores: ScoreMensuel[];
  classement: EntreeClassement[];
  top5: EntreeClassement[];
  audit: EvenementAuditClassement[];
}
