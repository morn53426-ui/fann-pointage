import { ErreurRegime } from "../shared/types.ts";
import { classerScores, calculerScores } from "./moteur.ts";
import { REGLES_SCORE_DEFAUT, validerReglesScore } from "./regles.ts";
import type { ClassementMensuel, DonneesAgentMensuelles, ReglesScore } from "./types.ts";

export function validerMois(mois: string): string {
  if (!/^\d{4}-\d{2}-01$/.test(mois)) throw new ErreurRegime("requete_invalide", "Le mois doit être au format AAAA-MM-01.");
  const d = new Date(`${mois}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== mois) throw new ErreurRegime("requete_invalide", "Le mois indiqué est invalide.");
  return mois;
}

export function creerClassementMensuel(input: {
  id: string;
  mois: string;
  agents: readonly DonneesAgentMensuelles[];
  regles?: ReglesScore;
  generePar: string;
  maintenant: Date;
}): ClassementMensuel {
  const mois = validerMois(input.mois);
  const regles = validerReglesScore(input.regles ?? REGLES_SCORE_DEFAUT);
  if (!input.id.trim() || !input.generePar.trim()) throw new ErreurRegime("requete_invalide", "Identifiant du classement et auteur obligatoires.");
  const scores = calculerScores(input.agents, regles);
  const classement = classerScores(scores, regles);
  const audit = [{
    id: "audit-0001",
    at: input.maintenant.toISOString(),
    acteurId: input.generePar,
    action: "classement_mensuel_genere" as const,
    detail: { versionRegles: regles.version, agentsClasses: classement.length, top5: classement.slice(0, 5).map((a) => ({ agentId: a.agentId, rang: a.rang, score: a.score })) },
  }];
  return {
    id: input.id,
    mois,
    versionRegles: regles.version,
    genereLe: input.maintenant.toISOString(),
    generePar: input.generePar,
    scores,
    classement,
    top5: classement.slice(0, 5),
    audit,
  };
}

export function convertirRapportEnMesures(
  agents: readonly { id: string; nom: string; prenom: string; serviceId: string; regime: "general" | "garde" | "urgences" | "mobil"; actif: boolean; matricule?: string | null }[],
  services: readonly { id: string; nom: string }[],
  lignes: readonly { agentId: string; arrivee_reelle: string; statut_presence: string; retard_min: number; anomalies: string; validation_manuelle: string; statut_localisation: string }[],
  absences: readonly { agentId: string; debut: string; fin: string; statut: string }[] = [],
): DonneesAgentMensuelles[] {
  const nomService = new Map(services.map((s) => [s.id, s.nom] as const));
  return agents.filter((a) => a.actif).map((a) => {
    const l = lignes.filter((x) => x.agentId === a.id);
    const postesHonores = l.filter((x) => Boolean(x.arrivee_reelle) && x.statut_presence !== "incoherent").length;
    const horsZone = l.filter((x) => x.statut_localisation === "hors_zone" || x.anomalies.split(", ").includes("hors_zone")).length;
    const anomaliesNonResolues = l.filter((x) => {
      const codes = x.anomalies.split(", ").filter(Boolean);
      return codes.some((code) => ["absence_a_confirmer", "pointage_incomplet", "hors_zone", "precision_insuffisante", "position_suspecte"].includes(code));
    }).length;
    return {
      agentId: a.id,
      nom: `${a.prenom} ${a.nom}`,
      service: nomService.get(a.serviceId) ?? a.serviceId,
      regime: a.regime,
      postesPlanifies: l.length,
      postesHonores,
      retards: l.filter((x) => x.retard_min > 0).length,
      // Seules les décisions « injustifiée » validées apparaissent au score ; les absences à confirmer restent neutres.
      absencesInjustifiees: absences.filter((x) => x.agentId === a.id && x.statut === "injustifiee").length,
      pointagesComplets: l.filter((x) => x.statut_presence === "complet").length,
      anomaliesNonResolues,
      pointagesHorsZone: horsZone,
    };
  });
}
