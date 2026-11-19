// Lecture et validation des paramètres de requête partagés par les routes de suivi (filtres, date, type de rapport).
import type { Filtres } from "../dashboard/donnees.ts";
import type { TypeRapport } from "../rapports/periode.ts";
import { parseCle } from "../shared/civil.ts";
import { ErreurRegime } from "../shared/types.ts";
import type { Regime } from "../shared/types.ts";

const REGIMES: Regime[] = ["general", "garde", "urgences", "mobil"];

const STATUTS_LOCALISATION = new Set([
  "dans_zone", "hors_zone", "precision_insuffisante", "indisponible", "refusee",
  "ancienne", "suspecte", "zone_inactive", "zone_inconnue",
]);
const VALIDATIONS_POINTAGE = new Set(["accepte", "refuse", "a_verifier", "valide_manuellement"]);

export function filtres(q: Record<string, string>): Filtres {
  const f: Filtres = {};
  if (q.service) f.serviceId = q.service;
  if (q.agent) f.agentId = q.agent;
  if (q.statutLocalisation) {
    if (!STATUTS_LOCALISATION.has(q.statutLocalisation)) throw new ErreurRegime("requete_invalide", "Statut de localisation inconnu.");
    f.statutLocalisation = q.statutLocalisation;
  }
  if (q.validation) {
    if (!VALIDATIONS_POINTAGE.has(q.validation)) throw new ErreurRegime("requete_invalide", "Statut de validation inconnu.");
    f.validation = q.validation;
  }
  if (q.regime) {
    if (!REGIMES.includes(q.regime as Regime)) throw new ErreurRegime("requete_invalide", "Régime inconnu");
    f.regime = q.regime as Regime;
  }
  return f;
}
export function dateCle(q: Record<string, string>, now: Date): string {
  if (q.date === undefined) return now.toISOString().slice(0, 10);
  try { parseCle(q.date); }
  catch { throw new ErreurRegime("requete_invalide", "Date invalide. Format attendu : AAAA-MM-JJ avec un jour réel du calendrier."); }
  return q.date;
}

export function typeRapport(q: Record<string, string>): TypeRapport {
  const t = q.type ?? "jour";
  if (t !== "jour" && t !== "semaine" && t !== "mois") throw new ErreurRegime("requete_invalide", "Type : jour, semaine ou mois");
  return t;
}
