// Jeu de données FICTIF pour les tests et la démonstration.
import * as general from "../regimes/general/index.ts";
import * as garde from "../regimes/garde/index.ts";
import * as urgences from "../regimes/urgences/index.ts";
import { parseCle } from "../shared/civil.ts";
import type { PointageEnregistre } from "../pointage/service.ts";
import type { DonneesPeriode, InfoAgent, PosteAgent } from "./donnees.ts";

export const T = (jour: number, h: number, m = 0, s = 0, mois = 10) => new Date(Date.UTC(2026, mois - 1, jour, h, m, s));

export const agent = (id: string, serviceId: string, regime: InfoAgent["regime"], nom = id): InfoAgent =>
  ({ id, nom: `Nom-${nom}`, prenom: `Prenom-${nom}`, matricule: `M-${id}`, serviceId, regime, actif: true });

export const poste = (agentId: string, serviceId: string, p: { posteId: string; regime: PosteAgent["regime"]; type: PosteAgent["type"]; debut: Date; fin: Date }, n = 1): PosteAgent =>
  ({ ...p, agentId, serviceId, planningId: `pl-${agentId}-${n}` });

let seq = 0;
export const pointage = (o: Partial<PointageEnregistre> & Pick<PointageEnregistre, "agentId" | "serviceId" | "posteId" | "type" | "serverTs">): PointageEnregistre => ({
  id: `pt${++seq}`, planningId: null, zoneId: "z1", validation: "accepte", motifRefus: null, idempotencyKey: `k${seq}`,
  statutLocalisation: "dans_zone", latitude: 14.0005, longitude: -17.0, precisionM: 10, positionCollecteeLe: null, distanceM: 55.6,
  methodeLoc: "gps", positionSuspecte: false, appVersion: null, tokenHash: null, source: "qr_pwa",
  valideManuellementPar: null, motifValidationManuelle: null, ...o,
});

/** Services : s-urg (urgences), s-gar (garde), s-gen (général). */
export function jeuDemo(): DonneesPeriode {
  const services = [{ id: "s-urg", nom: "Urgences" }, { id: "s-gar", nom: "Neuro-hospitalisation" }, { id: "s-gen", nom: "Radiologie" }];
  const agents = [
    agent("u1", "s-urg", "urgences"), agent("u2", "s-urg", "urgences"), agent("u3", "s-urg", "urgences"),
    agent("g1", "s-gar", "garde"), agent("g2", "s-gar", "garde"), agent("n1", "s-gen", "general"),
  ];
  const postes: PosteAgent[] = [];
  const cycleJour = (id: string, debut: Date, nombre = 1) => urgences.genererCycleJourUrgences(debut, nombre).postes.forEach((p, i) => postes.push(poste(id, "s-urg", p, i + 1)));
  const cycleNuit = (id: string, debut: Date, nombre = 1) => urgences.genererCycleNuitUrgences(debut, nombre).postes.forEach((p, i) => postes.push(poste(id, "s-urg", p, i + 1)));
  cycleJour("u1", T(12, 8));   // équipe de jour : 12/10 08-20
  cycleNuit("u2", T(11, 20));  // poste terminé le 12/10 à 08 h, repos jusqu’à 20 h
  cycleNuit("u3", T(12, 20)); // équipe de nuit : 12/10 20 h -> 13/10 08 h
  postes.push(poste("g1", "s-gar", garde.creerGarde(T(12, 8)), 1));
  postes.push(poste("g2", "s-gar", garde.creerGarde(T(10, 8)), 1));  // repos 11/10 08 h -> 13/10 08 h
  const lundi = general.posteDuJour(parseCle("2026-10-12"))!;
  postes.push(poste("n1", "s-gen", lundi, 1));

  const [uj] = postes.filter((p) => p.agentId === "u1");
  const g1 = postes.find((p) => p.agentId === "g1")!;
  const n1 = postes.find((p) => p.agentId === "n1")!;
  const pointages = [
    pointage({ agentId: "u1", serviceId: "s-urg", posteId: uj.posteId, type: "arrivee", serverTs: T(12, 8, 32) }),   // retard 32 min (au-delà de la tolérance de 20 min)
    pointage({ agentId: "n1", serviceId: "s-gen", posteId: n1.posteId, type: "arrivee", serverTs: T(12, 8, 0, 30) }),
    pointage({ agentId: "g1", serviceId: "s-gar", posteId: g1.posteId, type: "arrivee", serverTs: T(12, 9, 0), validation: "refuse",
      motifRefus: "hors_zone", statutLocalisation: "hors_zone", distanceM: 222 }),
  ];
  return { services, agents, postes, pointages };
}
