// Détection d'anomalies (calcul pur). Aucune sanction : chaque anomalie est à examiner par un responsable.
import * as garde from "../regimes/garde/index.ts";
import * as urgences from "../regimes/urgences/index.ts";
import * as mobil from "../regimes/mobil/index.ts";
import { MS_HEURE } from "../shared/types.ts";
import type { Regime } from "../shared/types.ts";
import { restreindre } from "../dashboard/donnees.ts";
import type { ActeurApp, DonneesPeriode, Filtres } from "../dashboard/donnees.ts";
import { evaluerPoste } from "../dashboard/evaluation.ts";
import { instantAnalysePointage } from "../pointage/service.ts";

export type TypeAnomalie =
  | "absence_a_confirmer" | "pointage_incomplet" | "retard" | "depart_anticipe"
  | "hors_zone" | "precision_insuffisante" | "position_suspecte" | "verification_manuelle"
  | "aucun_poste_planifie" | "conflit_chevauchement" | "repos_insuffisant" | "sequence_inhabituelle";

export interface Anomalie {
  id: string; type: TypeAnomalie; gravite: "information" | "avertissement" | "erreur";
  agentId: string; serviceId: string; regime: Regime | null;
  posteId: string | null; pointageId: string | null; detecteLe: string; message: string;
}

export function detecterAnomalies(
  donnees: DonneesPeriode, acteur: ActeurApp, now: Date, filtres: Filtres = {}, fenetreHeures = 48,
): Anomalie[] {
  const d = restreindre(donnees, acteur, filtres);
  const depuis = new Date(now.getTime() - fenetreHeures * MS_HEURE);
  const serviceDe = new Map(d.agents.map((a) => [a.id, a.serviceId] as const));
  const out: Anomalie[] = [];
  const ajouter = (a: Omit<Anomalie, "detecteLe" | "serviceId"> & { serviceId?: string }) =>
    out.push({ ...a, serviceId: a.serviceId ?? serviceDe.get(a.agentId) ?? "", detecteLe: now.toISOString() });

  for (const poste of d.postes) {
    if (!(poste.fin > depuis && poste.debut <= now)) continue;
    const e = evaluerPoste(poste, d.pointages, now);
    const base = { agentId: poste.agentId, regime: poste.regime, posteId: poste.posteId, pointageId: null };
    if (e.termine && e.resultat.statut === "absent_a_confirmer") ajouter({ ...base, id: `absence:${poste.posteId}`, type: "absence_a_confirmer", gravite: "avertissement", message: "Aucun pointage : absence à confirmer par un responsable" });
    if (e.termine && (e.resultat.statut === "incomplet" || e.resultat.statut === "incoherent")) ajouter({ ...base, id: `incomplet:${poste.posteId}`, type: "pointage_incomplet", gravite: "avertissement", message: "Pointage incomplet ou incohérent" });
    if (e.resultat.retardMin > 0) ajouter({ ...base, id: `retard:${poste.posteId}`, type: "retard", gravite: "information", message: `Retard de ${e.resultat.retardMin} min` });
    if (e.resultat.departAnticipeMin > 0) ajouter({ ...base, id: `depart:${poste.posteId}`, type: "depart_anticipe", gravite: "information", message: `Départ anticipé de ${e.resultat.departAnticipeMin} min` });
  }

  for (const p of d.pointages.filter((x) => x.serverTs >= depuis && x.serverTs <= now)) {
    const regime = d.postes.find((x) => x.posteId === p.posteId)?.regime ?? null;
    const base = { agentId: p.agentId, serviceId: p.serviceId, regime, posteId: p.posteId, pointageId: p.id };
    if (p.statutLocalisation === "hors_zone") ajouter({ ...base, id: `horszone:${p.id}`, type: "hors_zone", gravite: "avertissement", message: "Pointage hors de la zone autorisée" });
    if (p.statutLocalisation === "precision_insuffisante") ajouter({ ...base, id: `precision:${p.id}`, type: "precision_insuffisante", gravite: "information", message: "Précision de la position insuffisante" });
    if (p.positionSuspecte) ajouter({ ...base, id: `suspecte:${p.id}`, type: "position_suspecte", gravite: "erreur", message: "Position signalée comme simulée ou suspecte" });
    if (p.validation === "a_verifier" || p.validation === "refuse") ajouter({ ...base, id: `verif:${p.id}`, type: "verification_manuelle", gravite: "avertissement", message: `Pointage ${p.validation === "refuse" ? "refusé" : "à vérifier"} (${p.motifRefus ?? "motif non renseigné"})` });
    if (p.motifRefus === "aucun_poste_planifie") ajouter({ ...base, id: `sansposte:${p.id}`, type: "aucun_poste_planifie", gravite: "avertissement", message: "Pointage sans poste planifié" });
  }

  // Conflits de planning, par agent et avec le moteur de son régime
  const fins = new Map<string, Date>();
  for (const p of d.pointages) if (p.type === "depart" && (p.validation === "accepte" || p.validation === "valide_manuellement") && p.posteId) fins.set(p.posteId, instantAnalysePointage(p));
  for (const agent of d.agents) {
    const postes = d.postes.filter((p) => p.agentId === agent.id);
    const g = postes.filter((p) => p.regime === "garde");
    const u = postes.filter((p) => p.regime === "urgences");
    const mo = postes.filter((p) => p.regime === "mobil");
    const conflits = [
      ...(g.length ? garde.verifierGardes(g, fins) : []).map((c) => ({ c, regime: "garde" as const })),
      ...(u.length ? urgences.verifierPostesUrgences(u, fins) : []).map((c) => ({ c, regime: "urgences" as const })),
      ...(mo.length ? mobil.verifierPlanningsMobil(postes, fins) : []).map((c) => ({ c, regime: "mobil" as const })),
    ];
    for (const { c, regime } of conflits) {
      const type: TypeAnomalie = c.code === "chevauchement" ? "conflit_chevauchement" : c.code === "repos_insuffisant" ? "repos_insuffisant" : "sequence_inhabituelle";
      ajouter({ id: `${type}:${c.posteIds.join("+")}`, type, gravite: c.gravite === "erreur" ? "erreur" : "avertissement", agentId: agent.id, regime, posteId: c.posteIds[0] ?? null, pointageId: null, message: c.message });
    }
  }
  const ordre = { erreur: 0, avertissement: 1, information: 2 } as const;
  return out.sort((a, b) => ordre[a.gravite] - ordre[b.gravite] || a.id.localeCompare(b.id));
}
