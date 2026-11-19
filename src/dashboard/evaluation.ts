// Évalue un poste avec le moteur de SON régime (jamais celui d'un autre).
import * as general from "../regimes/general/index.ts";
import * as garde from "../regimes/garde/index.ts";
import * as urgences from "../regimes/urgences/index.ts";
import * as mobil from "../regimes/mobil/index.ts";
import type { ResultatPresence } from "../shared/presence.ts";
import { instantAnalysePointage, type PointageEnregistre } from "../pointage/service.ts";
import type { PosteAgent } from "./donnees.ts";

export interface PosteEvalue {
  poste: PosteAgent;
  arrivee: Date | null;
  depart: Date | null;
  resultat: ResultatPresence;
  enCours: boolean;
  termine: boolean;
  pointages: PointageEnregistre[];
}

export function evaluerPoste(poste: PosteAgent, pointages: readonly PointageEnregistre[], now: Date): PosteEvalue {
  const siens = pointages.filter((p) => p.posteId === poste.posteId && p.agentId === poste.agentId);
  // Un pointage « à vérifier » (notamment synchronisé hors ligne) ne compte pas dans la présence
  // avant qu'un responsable l'ait validé. Une fois validé, les calculs peuvent utiliser sa date capturée.
  const retenus = siens.filter((p) => p.validation === "accepte" || p.validation === "valide_manuellement");
  const tri = (a: PointageEnregistre, b: PointageEnregistre) => instantAnalysePointage(a).getTime() - instantAnalysePointage(b).getTime();
  const arriveeP = retenus.filter((p) => p.type === "arrivee").sort(tri)[0];
  const departP = retenus.filter((p) => p.type === "depart").sort(tri).at(-1);
  const arrivee = arriveeP ? instantAnalysePointage(arriveeP) : null;
  const depart = departP ? instantAnalysePointage(departP) : null;
  const evaluer = poste.regime === "general" ? general.evaluerPresenceGeneral
    : poste.regime === "garde" ? garde.evaluerPresenceGarde : poste.regime === "mobil" ? mobil.evaluerPresenceMobil : urgences.evaluerPresenceUrgences;
  return {
    poste, arrivee, depart, pointages: siens,
    resultat: evaluer(poste, { arrivee, depart }, now),
    enCours: poste.debut <= now && now < poste.fin,
    termine: now >= poste.fin,
  };
}
