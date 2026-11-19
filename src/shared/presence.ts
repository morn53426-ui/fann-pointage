// Évaluation d'un pointage par rapport à un poste. Calcul pur : les règles propres à chaque
// régime (horaires, repos) restent dans src/regimes/<régime>/. Aucune sanction ni retenue ici.
import { MS_MINUTE } from "./types.ts";

export type StatutPresence =
  | "a_venir" | "en_attente_arrivee" | "en_cours" | "complet"
  | "incomplet" | "incoherent" | "absent_a_confirmer";

export interface ParamsPresence {
  /** Au-delà de cette tolérance (minutes), le retard est compté en minutes entières depuis le début. */
  toleranceRetardMin: number;
  toleranceDepartMin: number;
}
/** Règles validées le 21/10/2026 : un retard jusqu'à 20 min est toléré ; un pointage est accepté jusqu'à 1 h avant le début du poste. */
export const TOLERANCE_RETARD_MIN = 20;
export const AVANT_POSTE_MIN = 60;
export const PARAMS_PRESENCE_DEFAUT: ParamsPresence = { toleranceRetardMin: TOLERANCE_RETARD_MIN, toleranceDepartMin: 0 };

export interface ResultatPresence {
  statut: StatutPresence;
  retardMin: number;
  departAnticipeMin: number;
  dureeReelleMin: number | null;
}

const minutes = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / MS_MINUTE);

export function evaluerPresence(
  poste: { debut: Date; fin: Date },
  pointages: { arrivee?: Date | null; depart?: Date | null },
  maintenant: Date,
  params: ParamsPresence = PARAMS_PRESENCE_DEFAUT,
): ResultatPresence {
  const { arrivee, depart } = pointages;
  const vide = { retardMin: 0, departAnticipeMin: 0, dureeReelleMin: null };

  if (!arrivee && !depart) {
    if (maintenant < poste.debut) return { statut: "a_venir", ...vide };
    if (maintenant < poste.fin) return { statut: "en_attente_arrivee", ...vide };
    return { statut: "absent_a_confirmer", ...vide }; // jamais une absence injustifiée automatique
  }

  const retard = arrivee ? Math.max(0, minutes(poste.debut, arrivee)) : 0;
  const retardMin = retard > params.toleranceRetardMin ? retard : 0;
  const anticipe = depart ? Math.max(0, minutes(depart, poste.fin)) : 0;
  const departAnticipeMin = anticipe > params.toleranceDepartMin ? anticipe : 0;

  if (!arrivee) return { statut: "incomplet", retardMin: 0, departAnticipeMin, dureeReelleMin: null };
  if (!depart) {
    return { statut: maintenant < poste.fin ? "en_cours" : "incomplet", retardMin, departAnticipeMin: 0, dureeReelleMin: null };
  }
  if (depart <= arrivee) return { statut: "incoherent", retardMin, departAnticipeMin, dureeReelleMin: null };
  return { statut: "complet", retardMin, departAnticipeMin, dureeReelleMin: minutes(arrivee, depart) };
}

/**
 * Rattache un instant de pointage au poste le plus proche dont la fenêtre
 * [début - avant, fin + après] le contient. Le rattachement se fait par poste, pas par jour civil
 * (un départ de poste de nuit à 08 h appartient au poste de la veille).
 */
export function rattacherPointage<T extends { debut: Date; fin: Date }>(
  instant: Date, postes: readonly T[], o: { avantMin?: number; apresMin?: number } = {},
): T | null {
  const avant = (o.avantMin ?? AVANT_POSTE_MIN) * MS_MINUTE;
  const apres = (o.apresMin ?? 240) * MS_MINUTE;
  const t = instant.getTime();
  let best: T | null = null;
  let bestDist = Infinity;
  for (const p of postes) {
    const d0 = p.debut.getTime(), d1 = p.fin.getTime();
    if (t < d0 - avant || t > d1 + apres) continue;
    const dist = t < d0 ? d0 - t : t > d1 ? t - d1 : 0;
    if (dist < bestDist) { best = p; bestDist = dist; }
  }
  return best;
}
