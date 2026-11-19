// Données d'entrée communes au tableau de bord, aux anomalies et aux rapports, avec restriction par droits.
import { ErreurRegime } from "../shared/types.ts";
import type { Regime } from "../shared/types.ts";
import type { Acteur } from "../pointage/manuel.ts";
import type { PointageEnregistre, PostePlanifie } from "../pointage/service.ts";

export type ActeurApp = Acteur & { agentId?: string };

export interface InfoAgent {
  id: string; nom: string; prenom: string; matricule: string | null; serviceId: string; regime: Regime; actif: boolean;
  /** Informations imprimées sur le badge (facultatives) : profession au recto, adresse et téléphone au verso. */
  profession?: string | null; adresse?: string | null; telephone?: string | null;
}
export interface PosteAgent extends PostePlanifie { agentId: string; serviceId: string }
export interface InfoService { id: string; nom: string }

export interface DonneesPeriode {
  services: InfoService[];
  agents: InfoAgent[];
  postes: PosteAgent[];
  pointages: PointageEnregistre[];
}

export interface Filtres {
  serviceId?: string; regime?: Regime; agentId?: string;
  statutLocalisation?: string; validation?: string;
}

/** Ne garde que ce que l'acteur a le droit de voir, puis applique les filtres. Un brancardier n'a pas accès aux vues d'ensemble. */
export function restreindre(d: DonneesPeriode, acteur: ActeurApp, f: Filtres = {}): DonneesPeriode {
  if (acteur.role === "brancardier") throw new ErreurRegime("non_autorise", "Accès réservé aux responsables et administrateurs");
  const autorise = (serviceId: string) => acteur.role === "administrateur" || acteur.servicesGeres.includes(serviceId);
  const agents = d.agents.filter((a) => autorise(a.serviceId) && (!f.serviceId || a.serviceId === f.serviceId) && (!f.agentId || a.id === f.agentId));
  const ids = new Set(agents.map((a) => a.id));
  const postes = d.postes.filter((p) => ids.has(p.agentId) && (!f.regime || p.regime === f.regime));
  const posteIds = new Set(postes.map((p) => p.posteId));
  const pointages = d.pointages.filter((p) =>
    ids.has(p.agentId) && (!f.regime || (p.posteId !== null && posteIds.has(p.posteId))) &&
    (!f.statutLocalisation || p.statutLocalisation === f.statutLocalisation) && (!f.validation || p.validation === f.validation));
  return { services: d.services.filter((s) => autorise(s.id)), agents, postes, pointages };
}

/** Brancardier : uniquement ses propres postes et pointages (historique personnel). */
export function restreindrePropre(d: DonneesPeriode, agentId: string): DonneesPeriode {
  return {
    services: d.services,
    agents: d.agents.filter((a) => a.id === agentId),
    postes: d.postes.filter((p) => p.agentId === agentId),
    pointages: d.pointages.filter((p) => p.agentId === agentId),
  };
}
