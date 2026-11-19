// Tableau de bord : indicateurs calculés SÉPARÉMENT par régime (urgences et gardes classiques ne sont jamais mélangées).
// Position : uniquement le dernier pointage, jamais de suivi continu.
import * as garde from "../regimes/garde/index.ts";
import * as urgences from "../regimes/urgences/index.ts";
import * as mobil from "../regimes/mobil/index.ts";
import { MS_HEURE } from "../shared/types.ts";
import type { Regime } from "../shared/types.ts";
import { vuePointage } from "../pointage/masquage.ts";
import type { VuePointage } from "../pointage/masquage.ts";
import { restreindre } from "./donnees.ts";
import type { ActeurApp, DonneesPeriode, Filtres } from "./donnees.ts";
import { evaluerPoste } from "./evaluation.ts";
import { instantAnalysePointage } from "../pointage/service.ts";

export interface IndicateursRegime {
  attendus: number;
  presents: number;
  enAttenteArrivee: number;
  absentsAConfirmer: number;
  retards: number;
  pointagesIncomplets: number;
  enRepos: number | null;          // null : notion de repos non applicable (service général)
  postesEnCours: Record<string, number>;
  horsZone: number;
  precisionInsuffisante: number;
  aVerifier: number;
  positionsSuspectes: number;
  agentsTentativesRepetees: number;
}

export interface TableauDeBord {
  genereLe: string;
  fenetreHeures: number;
  parRegime: Record<Regime, IndicateursRegime>;
  pointagesSansPoste: { horsZone: number; precisionInsuffisante: number; aVerifier: number };
  derniersPointages: VuePointage[];   // un seul (le dernier) par agent actuellement présent
  indisponible: string[];             // indicateurs non encore alimentés
}

const vide = (): IndicateursRegime => ({
  attendus: 0, presents: 0, enAttenteArrivee: 0, absentsAConfirmer: 0, retards: 0, pointagesIncomplets: 0, enRepos: null,
  postesEnCours: {}, horsZone: 0, precisionInsuffisante: 0, aVerifier: 0, positionsSuspectes: 0, agentsTentativesRepetees: 0,
});

export function calculerTableauDeBord(
  donnees: DonneesPeriode, acteur: ActeurApp, now: Date, filtres: Filtres = {}, fenetreHeures = 24,
): TableauDeBord {
  const d = restreindre(donnees, acteur, filtres);
  const depuis = new Date(now.getTime() - fenetreHeures * MS_HEURE);
  const par: Record<Regime, IndicateursRegime> = { general: vide(), garde: vide(), urgences: vide(), mobil: vide() };
  const regimeDePoste = new Map(d.postes.map((p) => [p.posteId, p.regime] as const));

  for (const poste of d.postes) {
    const i = par[poste.regime];
    const e = evaluerPoste(poste, d.pointages, now);
    if (e.enCours) {
      i.attendus++;
      i.postesEnCours[poste.type] = (i.postesEnCours[poste.type] ?? 0) + 1;
      if (e.arrivee && !e.depart) i.presents++;
      if (e.resultat.statut === "en_attente_arrivee") i.enAttenteArrivee++;
    }
    if (poste.fin > depuis && poste.debut <= now) {
      if (e.resultat.retardMin > 0) i.retards++;
      if (e.termine && e.resultat.statut === "absent_a_confirmer") i.absentsAConfirmer++;
      if (e.termine && (e.resultat.statut === "incomplet" || e.resultat.statut === "incoherent")) i.pointagesIncomplets++;
    }
  }

  // Repos : propre à chaque régime
  const parAgent = <T extends { agentId: string }>(l: T[]) => {
    const m = new Map<string, T[]>(); for (const x of l) m.set(x.agentId, [...(m.get(x.agentId) ?? []), x]); return m;
  };
  const gardesParAgent = parAgent(d.postes.filter((p) => p.regime === "garde"));
  const urgParAgent = parAgent(d.postes.filter((p) => p.regime === "urgences"));
  par.garde.enRepos = [...gardesParAgent.values()].filter((g) => garde.estEnRepos(now, g)).length;
  const fins = new Map<string, Date>();
  for (const p of d.pointages) if (p.type === "depart" && (p.validation === "accepte" || p.validation === "valide_manuellement") && p.posteId) fins.set(p.posteId, instantAnalysePointage(p));
  par.urgences.enRepos = [...urgParAgent.values()].filter((u) => urgences.estEnRepos(now, u, fins)).length;
  const mobilParAgent = parAgent(d.postes.filter((p) => p.regime === "mobil"));
  par.mobil.enRepos = [...mobilParAgent.values()].filter((m) => mobil.estEnReposMobil(now, m, fins)).length;

  // Localisation : par régime du poste rattaché ; le reste est compté à part
  const sans = { horsZone: 0, precisionInsuffisante: 0, aVerifier: 0 };
  const horsZoneParAgent = new Map<string, number>();
  for (const p of d.pointages.filter((x) => x.serverTs >= depuis && x.serverTs <= now)) {
    const r = p.posteId ? regimeDePoste.get(p.posteId) : undefined;
    const cible = r ? par[r] : null;
    if (p.statutLocalisation === "hors_zone") { if (cible) cible.horsZone++; else sans.horsZone++; horsZoneParAgent.set(p.agentId, (horsZoneParAgent.get(p.agentId) ?? 0) + 1); }
    if (p.statutLocalisation === "precision_insuffisante") { if (cible) cible.precisionInsuffisante++; else sans.precisionInsuffisante++; }
    if (p.validation === "a_verifier") { if (cible) cible.aVerifier++; else sans.aVerifier++; }
    if (p.positionSuspecte && cible) cible.positionsSuspectes++;
  }
  for (const [agentId, n] of horsZoneParAgent) {
    if (n < 3) continue;
    const r = d.postes.find((p) => p.agentId === agentId)?.regime;
    if (r) par[r].agentsTentativesRepetees++;
  }

  // Dernier pointage seulement, pour les agents présents
  const derniers: VuePointage[] = [];
  for (const poste of d.postes) {
    const e = evaluerPoste(poste, d.pointages, now);
    if (!(e.enCours && e.arrivee && !e.depart)) continue;
    const dernier = [...e.pointages].sort((a, b) => instantAnalysePointage(b).getTime() - instantAnalysePointage(a).getTime())[0];
    const v = dernier ? vuePointage(dernier, acteur) : null;
    if (v) derniers.push(v);
  }

  return {
    genereLe: now.toISOString(), fenetreHeures, parRegime: par, pointagesSansPoste: sans, derniersPointages: derniers,
    indisponible: ["remplacements", "persistance PostgreSQL du classement mensuel"],
  };
}
