import { CRITERES_SCORE } from "./types.ts";
import type { CritereDepartage, CritereScore, DonneesAgentMensuelles, EntreeClassement, ReglesScore, ScoreMensuel } from "./types.ts";
import { validerReglesScore } from "./regles.ts";

const entierNaturel = (n: number, champ: string): number => {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${champ} doit être un entier positif ou nul.`);
  return n;
};
const pourcentage = (n: number): number => Math.round(Math.min(100, Math.max(0, n)) * 100) / 100;
const arrondirScore = (n: number): number => Math.round(n * 1000) / 1000;
const ratio = (n: number, total: number): number => total <= 0 ? 0 : pourcentage((n / total) * 100);
const ratioInverse = (n: number, total: number): number => total <= 0 ? 0 : pourcentage(100 - (n / total) * 100);

export function calculerScoreMensuel(agent: DonneesAgentMensuelles, reglesEntree: ReglesScore): ScoreMensuel {
  const regles = validerReglesScore(reglesEntree);
  if (!agent.agentId.trim()) throw new Error("L'identifiant de l'agent est obligatoire.");
  const postesPlanifies = entierNaturel(agent.postesPlanifies, "postesPlanifies");
  const postesHonores = entierNaturel(agent.postesHonores, "postesHonores");
  const retards = entierNaturel(agent.retards, "retards");
  const absencesInjustifiees = agent.absencesInjustifiees === null
    ? null
    : entierNaturel(agent.absencesInjustifiees, "absencesInjustifiees");
  const pointagesComplets = entierNaturel(agent.pointagesComplets, "pointagesComplets");
  const anomalies = entierNaturel(agent.anomaliesNonResolues, "anomaliesNonResolues");
  const pointagesHorsZone = entierNaturel(agent.pointagesHorsZone, "pointagesHorsZone");

  if (postesHonores > postesPlanifies || pointagesComplets > postesHonores) {
    throw new Error(`Mesures incohérentes pour l'agent ${agent.agentId}.`);
  }

  const detail: Record<CritereScore, number | null> = {
    taux_presence: ratio(postesHonores, postesPlanifies),
    ponctualite: ratio(Math.max(0, postesHonores - retards), postesPlanifies),
    // Une valeur inconnue n'est pas transformée en 0 absence (ce qui accorderait 100 % au critère).
    absences_injustifiees: absencesInjustifiees === null ? null : ratioInverse(absencesInjustifiees, postesPlanifies),
    pointages_complets: ratio(pointagesComplets, postesPlanifies),
    anomalies: ratioInverse(anomalies, postesPlanifies),
    hors_zone: ratioInverse(pointagesHorsZone, postesPlanifies),
  };
  // Les critères sans donnée fiable sont retirés du dénominateur ; le score reste normalisé sur 100.
  const poids = CRITERES_SCORE.reduce((sum, k) => sum + (detail[k] === null ? 0 : regles.criteres[k]), 0);
  const scoreTotal = postesPlanifies === 0 || poids <= 0 ? 0 : arrondirScore(
    CRITERES_SCORE.reduce((sum, k) => sum + (detail[k] === null ? 0 : detail[k] * regles.criteres[k]), 0) / poids,
  );

  return {
    agentId: agent.agentId,
    nom: agent.nom,
    service: agent.service,
    regime: agent.regime,
    scoreTotal,
    tauxPresence: detail.taux_presence ?? 0,
    retards,
    absencesInjustifiees,
    pointagesComplets,
    anomalies,
    pointagesHorsZone,
    postesPlanifies,
    postesHonores,
    detail,
  };
}

function valeurDepartage(e: EntreeClassement, c: CritereDepartage): number | null {
  switch (c) {
    case "taux_presence": return e.tauxPresence;
    case "absences_injustifiees": return e.absencesInjustifiees === null ? null : -e.absencesInjustifiees;
    case "retards": return -e.retards;
    case "pointages_complets": return e.pointagesComplets;
  }
}

function comparer(a: EntreeClassement, b: EntreeClassement, ordre: readonly CritereDepartage[]): number {
  if (a.score !== b.score) return b.score - a.score;
  for (const c of ordre) {
    const va = valeurDepartage(a, c), vb = valeurDepartage(b, c);
    // Un critère inconnu pour l'un des agents n'est pas utilisé pour les départager.
    if (va === null || vb === null) continue;
    const delta = vb - va;
    if (delta !== 0) return delta;
  }
  // Dernier départage stable : aucune égalité ne laisse le top 5 incomplet.
  return a.agentId.localeCompare(b.agentId, "fr");
}

/** Classe tous les agents par points, puis applique les critères de départage documentés. */
export function classerScores(scores: readonly ScoreMensuel[], reglesEntree: ReglesScore): EntreeClassement[] {
  const regles = validerReglesScore(reglesEntree);
  const entrees = scores.map((s) => ({
    agentId: s.agentId, nom: s.nom, service: s.service, regime: s.regime,
    rang: 0, score: s.scoreTotal, tauxPresence: s.tauxPresence, retards: s.retards,
    absencesInjustifiees: s.absencesInjustifiees, pointagesComplets: s.pointagesComplets,
    anomalies: s.anomalies, pointagesHorsZone: s.pointagesHorsZone,
    postesPlanifies: s.postesPlanifies, postesHonores: s.postesHonores,
  })).sort((a, b) => comparer(a, b, regles.departage));
  return entrees.map((e, i) => ({ ...e, rang: i + 1 }));
}

export function calculerScores(agents: readonly DonneesAgentMensuelles[], regles: ReglesScore): ScoreMensuel[] {
  const ids = new Set<string>();
  return agents.map((a) => {
    if (!a.agentId || ids.has(a.agentId)) throw new Error(`Identifiant d'agent vide ou en double : ${a.agentId}`);
    ids.add(a.agentId);
    return calculerScoreMensuel(a, regles);
  });
}
