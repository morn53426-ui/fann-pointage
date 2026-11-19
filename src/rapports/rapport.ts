// Rapports journaliers, hebdomadaires et mensuels (calcul pur). Aucune retenue ni sanction n'est calculée.
import * as garde from "../regimes/garde/index.ts";
import * as urgences from "../regimes/urgences/index.ts";
import * as mobil from "../regimes/mobil/index.ts";
import { ErreurRegime } from "../shared/types.ts";
import { restreindre, restreindrePropre } from "../dashboard/donnees.ts";
import type { ActeurApp, DonneesPeriode, Filtres } from "../dashboard/donnees.ts";
import { evaluerPoste } from "../dashboard/evaluation.ts";
import { instantAnalysePointage } from "../pointage/service.ts";
import { versCsv } from "./csv.ts";
import type { Colonne } from "./csv.ts";
import { dakarLocal, periodePour } from "./periode.ts";
import type { PeriodeRapport, TypeRapport } from "./periode.ts";

export interface LigneRapport {
  agentId: string; agent_nom: string; agent_prenom: string; matricule: string | null; service: string; regime: string; type_poste: string;
  prevu_debut: string; prevu_fin: string; arrivee_reelle: string; depart_reel: string;
  duree_reelle_min: number | null; retard_min: number; depart_anticipe_min: number; statut_presence: string;
  statut_localisation: string; distance_m: number | null; precision_m: number | null;
  latitude: number | null; longitude: number | null; anomalies: string;
  validation_manuelle: string; motif_validation_manuelle: string;
}
export interface SyntheseAgent {
  agentId: string; agent: string; service: string; regime: string;
  postes_service: number; postes_jour: number; postes_nuit: number; gardes: number;
  retards: number; retard_total_min: number; absences_a_confirmer: number; pointages_incomplets: number;
  departs_anticipes: number; pointages_hors_zone: number; validations_manuelles: number; duree_totale_min: number;
  repos_prevus: string;
}
export interface Rapport { periode: PeriodeRapport; genereLe: string; lignes: LigneRapport[]; synthese: SyntheseAgent[]; notes: string[] }

const NOTES = [
  "Un poste est rattaché à la période de son début (un poste de nuit appartient au jour où il commence).",
  "Modifications de planning et remplacements : non inclus (disponibles avec la base de données).",
  "Le score et le classement mensuel sont calculés séparément à partir des pointages.",
  "Absence « à confirmer » : aucune sanction ni retenue n'est calculée.",
];

export function genererRapport(
  donnees: DonneesPeriode, acteur: ActeurApp, type: TypeRapport, dateCle: string, now: Date, filtres: Filtres = {},
): Rapport {
  const d = acteur.role === "brancardier"
    ? (acteur.agentId ? restreindrePropre(donnees, acteur.agentId) : (() => { throw new ErreurRegime("non_autorise", "Compte sans agent"); })())
    : restreindre(donnees, acteur, filtres);
  const periode = periodePour(type, dateCle);
  const nomService = new Map(d.services.map((s) => [s.id, s.nom] as const));
  const agents = new Map(d.agents.map((a) => [a.id, a] as const));
  const lignes: LigneRapport[] = [];

  for (const poste of d.postes.filter((p) => p.debut >= periode.debut && p.debut < periode.fin)) {
    const a = agents.get(poste.agentId);
    if (!a) continue;
    const e = evaluerPoste(poste, d.pointages, now);
    const tri = [...e.pointages].sort((x, y) => instantAnalysePointage(x).getTime() - instantAnalysePointage(y).getTime());
    const ref = tri.find((p) => p.type === "arrivee" && (p.validation === "accepte" || p.validation === "valide_manuellement")) ?? tri[0];
    const manuel = tri.filter((p) => p.validation === "valide_manuellement");
    const codes: string[] = [];
    if (e.termine && e.resultat.statut === "absent_a_confirmer") codes.push("absence_a_confirmer");
    if (e.termine && (e.resultat.statut === "incomplet" || e.resultat.statut === "incoherent")) codes.push("pointage_incomplet");
    if (e.resultat.retardMin > 0) codes.push("retard");
    if (e.resultat.departAnticipeMin > 0) codes.push("depart_anticipe");
    if (tri.some((p) => p.statutLocalisation === "hors_zone")) codes.push("hors_zone");
    if (tri.some((p) => p.statutLocalisation === "precision_insuffisante")) codes.push("precision_insuffisante");
    if (tri.some((p) => p.positionSuspecte)) codes.push("position_suspecte");
    lignes.push({
      agentId: a.id, agent_nom: a.nom, agent_prenom: a.prenom, matricule: a.matricule, service: nomService.get(poste.serviceId) ?? poste.serviceId,
      regime: poste.regime, type_poste: poste.type, prevu_debut: dakarLocal(poste.debut), prevu_fin: dakarLocal(poste.fin),
      arrivee_reelle: dakarLocal(e.arrivee), depart_reel: dakarLocal(e.depart), duree_reelle_min: e.resultat.dureeReelleMin,
      retard_min: e.resultat.retardMin, depart_anticipe_min: e.resultat.departAnticipeMin, statut_presence: e.resultat.statut,
      statut_localisation: ref?.statutLocalisation ?? "", distance_m: ref?.distanceM ?? null, precision_m: ref?.precisionM ?? null,
      // Coordonnées exactes : administrateur seulement (même règle que la vue SQL v_pointages et les exports CSV).
      latitude: acteur.role === "administrateur" ? (ref?.latitude ?? null) : null, longitude: acteur.role === "administrateur" ? (ref?.longitude ?? null) : null, anomalies: codes.join(", "),
      validation_manuelle: manuel.length ? "oui" : "non", motif_validation_manuelle: manuel.map((p) => p.motifValidationManuelle ?? "").join(" | "),
    });
  }
  lignes.sort((x, y) => x.prevu_debut.localeCompare(y.prevu_debut) || x.agent_nom.localeCompare(y.agent_nom));

  const synthese: SyntheseAgent[] = [];
  for (const a of d.agents) {
    const l = lignes.filter((x) => x.agentId === a.id);
    const siens = d.postes.filter((p) => p.agentId === a.id);
    const repos = [
      ...siens.filter((p) => p.regime === "garde").map((p) => garde.periodeRepos(p)),
      ...siens.filter((p) => p.regime === "urgences").map((p) => urgences.periodeReposPrevue(p)),
      ...siens.filter((p) => p.regime === "mobil" && p.type === "nuit").map((p) => mobil.periodeReposNuitMobil(p)),
    ].filter((r) => r.fin > periode.debut && r.debut < periode.fin);
    const n = (f: (x: LigneRapport) => boolean) => l.filter(f).length;
    synthese.push({
      agentId: a.id, agent: `${a.prenom} ${a.nom}`, service: nomService.get(a.serviceId) ?? a.serviceId, regime: a.regime,
      postes_service: n((x) => x.type_poste === "service"), postes_jour: n((x) => x.type_poste === "jour"),
      postes_nuit: n((x) => x.type_poste === "nuit"), gardes: n((x) => x.type_poste === "garde"),
      retards: n((x) => x.retard_min > 0), retard_total_min: l.reduce((s, x) => s + x.retard_min, 0),
      absences_a_confirmer: n((x) => x.anomalies.includes("absence_a_confirmer")),
      pointages_incomplets: n((x) => x.anomalies.includes("pointage_incomplet")),
      departs_anticipes: n((x) => x.depart_anticipe_min > 0), pointages_hors_zone: n((x) => x.anomalies.includes("hors_zone")),
      validations_manuelles: n((x) => x.validation_manuelle === "oui"), duree_totale_min: l.reduce((s, x) => s + (x.duree_reelle_min ?? 0), 0),
      repos_prevus: repos.map((r) => `${dakarLocal(r.debut)} -> ${dakarLocal(r.fin)}`).join(" | "),
    });
  }
  return { periode, genereLe: now.toISOString(), lignes, synthese, notes: NOTES };
}

const COLONNES_BASE: Colonne[] = [
  ["agent_nom", "Nom"], ["agent_prenom", "Prénom"], ["matricule", "Matricule"], ["service", "Service"], ["regime", "Régime"], ["type_poste", "Poste"],
  ["prevu_debut", "Début prévu"], ["prevu_fin", "Fin prévue"], ["arrivee_reelle", "Arrivée réelle"], ["depart_reel", "Départ réel"],
  ["duree_reelle_min", "Durée réelle (min)"], ["retard_min", "Retard (min)"], ["depart_anticipe_min", "Départ anticipé (min)"],
  ["statut_presence", "Statut"], ["statut_localisation", "Statut de localisation"], ["anomalies", "Anomalies"], ["validation_manuelle", "Validation manuelle"],
].map(([cle, titre]) => ({ cle, titre }));

/** Colonnes exportables selon les droits : coordonnées exactes = administrateur ; distance/précision = tous les rôles autorisés. */
export function colonnesAutorisees(acteur: ActeurApp): Colonne[] {
  const cols = [...COLONNES_BASE, { cle: "distance_m", titre: "Distance à la zone (m)" }, { cle: "precision_m", titre: "Précision (m)" }];
  if (acteur.role !== "brancardier") cols.push({ cle: "motif_validation_manuelle", titre: "Motif de validation manuelle" });
  if (acteur.role === "administrateur") cols.push({ cle: "latitude", titre: "Latitude" }, { cle: "longitude", titre: "Longitude" });
  return cols;
}

export function exporterCsv(r: Rapport, acteur: ActeurApp, contenu: "lignes" | "synthese" = "lignes"): { nomFichier: string; csv: string } {
  if (contenu === "synthese") {
    const cles = Object.keys(r.synthese[0] ?? { agent: 0 }).filter((k) => k !== "agentId");
    return { nomFichier: `synthese-${r.periode.libelle}.csv`.replace(/\s+/g, "-"), csv: versCsv(cles.map((cle) => ({ cle, titre: cle })), r.synthese as unknown as Record<string, unknown>[]) };
  }
  return { nomFichier: `pointages-${r.periode.libelle}.csv`.replace(/\s+/g, "-"), csv: versCsv(colonnesAutorisees(acteur), r.lignes as unknown as Record<string, unknown>[]) };
}
