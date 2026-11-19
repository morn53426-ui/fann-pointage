// Jeu de démonstration FICTIF, calé sur la date courante : toujours des postes de jour, de nuit, de garde et des repos.
import { randomBytes } from "node:crypto";
import * as general from "../regimes/general/index.ts";
import * as garde from "../regimes/garde/index.ts";
import * as urgences from "../regimes/urgences/index.ts";
import { addDays, civilDeInstant, jours } from "../shared/civil.ts";
import { dakarDateTime } from "../shared/time.ts";
import type { Poste } from "../shared/types.ts";
import { MS_HEURE } from "../shared/types.ts";
import { hashMotDePasse } from "./auth.ts";
import { MagasinDemo } from "./magasin.ts";
import type { PointageEnregistre, PostePlanifie } from "../pointage/service.ts";

export interface OptionsDemo { zone?: { latitude: number; longitude: number; rayonM: number }; motDePasse?: string; donneesClassementDemo?: boolean }
export interface IdentifiantDemo { identifiant: string; motDePasse: string; role: string }

export function creerDemo(now: Date, o: OptionsDemo = {}): { magasin: MagasinDemo; identifiants: IdentifiantDemo[] } {
  const m = new MagasinDemo(now);
  m.secret = randomBytes(32).toString("base64url");
  m.secretSession = randomBytes(32).toString("base64url");
  const z = o.zone ?? { latitude: 14.0, longitude: -17.0, rayonM: 150 };   // coordonnées FICTIVES par défaut
  m.services = [{ id: "s-gen", nom: "Radiologie (démo)" }, { id: "s-gar", nom: "Neuro-hospitalisation (démo)" }, { id: "s-urg", nom: "Urgences (démo)" }];
  for (const s of m.services) {
    m.zones.set(`z-${s.id}`, { id: `z-${s.id}`, nom: `Zone ${s.nom}`, serviceId: s.id, actif: true, ...z, precisionMaxM: 50, horsZoneAction: "refuser" });
  }

  const d0 = civilDeInstant(now);
  const debut = dakarDateTime(addDays(d0, -6).year, addDays(d0, -6).month, addDays(d0, -6).day, 8);
  const ajouterAgent = (id: string, service: string, regime: "general" | "garde" | "urgences" | "mobil", n: number) => {
    m.agents.set(id, { id, actif: true, serviceId: service, regime });
    m.infosAgents.push({ id, nom: `Démo-${n}`, prenom: `Agent${n}`, matricule: `DEMO-${id}`, serviceId: service, regime, actif: true });
  };
  const ajouterPoste = (id: string, p: ReturnType<typeof garde.creerGarde>, n: number) => m.ajouterPoste(id, { ...p, planningId: `pl-${id}-${n}` } as PostePlanifie);

  // u1 : jour tous les 48 h ; u2 et u3 : nuits tous les 72 h (60 h de repos), décalées pour qu'une nuit soit toujours couverte (u2 : nuit qui commence aujourd'hui, u3 : nuit commencée hier).
  const equipesUrgences: [string, "jour" | "nuit", number, number][] = [["u1", "jour", 0, 48], ["u2", "nuit", 12, 72], ["u3", "nuit", 60, 72]];
  equipesUrgences.forEach(([id, equipe, decalH, cycleH], i) => {
    ajouterAgent(id, "s-urg", "urgences", i + 1);
    const premierDebut = new Date(debut.getTime() + decalH * MS_HEURE);
    // Jeu de démonstration : cycles réguliers alignés sur aujourd'hui quel que soit le jour de la semaine, pour qu'un poste de jour et un poste de nuit
    // soient toujours actifs. Les règles du vendredi et des passages d'équipe ne sont volontairement pas appliquées ici.
    const creer = equipe === "jour" ? urgences.creerPosteJour : urgences.creerPosteNuit;
    Array.from({ length: 14 }, (_, k) => creer(new Date(premierDebut.getTime() + k * cycleH * MS_HEURE))).forEach((p, k) => ajouterPoste(id, p, k));
  });
  [["g1", 0], ["g2", 24], ["g3", 48]].forEach(([id, decalH], i) => {
    ajouterAgent(id as string, "s-gar", "garde", i + 4);
    garde.genererCycleGardes(new Date(debut.getTime() + (decalH as number) * MS_HEURE), 6).forEach((p, k) => ajouterPoste(id as string, p, k));
  });
  ["n1", "n2"].forEach((id, i) => {
    ajouterAgent(id, "s-gen", "general", i + 7);
    const postes = jours(addDays(d0, -6), addDays(d0, 6)).map((j) => general.posteDuJour(j)).filter((p) => p !== null);
    postes.forEach((p, k) => ajouterPoste(id, p, k));
  });

  // Historique entièrement fictif, activé seulement par le serveur de démonstration.
  // Il permet de tester le calcul et le classement mensuels sans données de personnels réels.
  if (o.donneesClassementDemo) ajouterHistoriqueClassementFictif(m, now);

  const mdp = o.motDePasse ?? randomBytes(6).toString("base64url");
  const hash = hashMotDePasse(mdp);
  const identifiants: IdentifiantDemo[] = [];
  const u = (identifiant: string, role: "administrateur" | "responsable" | "brancardier", agentId: string | null, services: string[]) => {
    m.utilisateurs.set(`user-${identifiant}`, { id: `user-${identifiant}`, identifiant, hash, role, agentId, servicesGeres: services, actif: true });
    identifiants.push({ identifiant, motDePasse: mdp, role });
  };
  u("admin", "administrateur", null, []);
  u("responsable", "responsable", null, ["s-urg", "s-gen"]);
  u("agent-n1", "brancardier", "n1", []);
  u("agent-u1", "brancardier", "u1", []);
  u("agent-g1", "brancardier", "g1", []);
  return { magasin: m, identifiants };
}


function ajouterHistoriqueClassementFictif(m: MagasinDemo, now: Date): void {
  const courant = civilDeInstant(now);
  const dernierJour = addDays({ year: courant.year, month: courant.month, day: 1 }, -1);
  const premierJour = { year: dernierJour.year, month: dernierJour.month, day: 1 };
  const debutMois = dakarDateTime(premierJour.year, premierJour.month, premierJour.day, 8);
  const finMois = dakarDateTime(courant.year, courant.month, 1, 0);
  const joursMois = jours(premierJour, dernierJour);
  const cyclesGarde = Math.ceil(joursMois.length / 3) + 1;
  const cyclesJourUrgences = Math.ceil(joursMois.length / 2) + 1;
  const retardsAvant = new Map<string, number>([["u1", 2], ["u2", 0], ["u3", 1], ["g1", 3], ["g2", 0], ["g3", 1], ["n1", 0], ["n2", 2]]);

  for (const info of m.infosAgents) {
    let postes: Poste[];
    if (info.regime === "general") {
      postes = joursMois.map((j) => general.posteDuJour(j)).filter((p): p is Poste => p !== null);
    } else if (info.regime === "garde") {
      postes = garde.genererCycleGardes(debutMois, cyclesGarde);
    } else if (info.id === "u1") {
      postes = urgences.genererCycleJourUrgences(debutMois, cyclesJourUrgences).postes;
    } else {
      const premierDebutNuit = new Date(debutMois.getTime() + (info.id === "u2" ? 12 : 36) * MS_HEURE);
      postes = urgences.genererCycleNuitUrgences(premierDebutNuit, joursMois.length + 2).postes;
    }

    const agentsPostes = postes.filter((p) => p.debut >= debutMois && p.debut < finMois).sort((a, b) => a.debut.getTime() - b.debut.getTime());
    const serviceId = m.agents.get(info.id)!.serviceId;
    agentsPostes.forEach((poste, index) => {
      const planningId = `pl-classement-demo-${info.id}-${index}`;
      m.ajouterPoste(info.id, { ...poste, planningId } as PostePlanifie);
      // Quelques retards fixes servent uniquement à illustrer le calcul de points.
      const retardMs = index < (retardsAvant.get(info.id) ?? 0) ? 6 * 60_000 : 0;
      const arrivee = new Date(poste.debut.getTime() + retardMs);
      const valeurs: { type: "arrivee" | "depart"; at: Date }[] = [
        { type: "arrivee", at: arrivee },
        { type: "depart", at: poste.fin },
      ];
      for (const v of valeurs) {
        const enregistre: PointageEnregistre = {
          id: `demo-classement-${info.id}-${index}-${v.type}`,
          agentId: info.id,
          serviceId,
          planningId,
          posteId: poste.posteId,
          zoneId: `z-${serviceId}`,
          type: v.type,
          serverTs: v.at,
          validation: "accepte",
          motifRefus: null,
          idempotencyKey: `demo-classement-${info.id}-${index}-${v.type}`,
          statutLocalisation: "dans_zone",
          latitude: null,
          longitude: null,
          precisionM: null,
          positionCollecteeLe: v.at,
          distanceM: null,
          methodeLoc: "demo-historique-fictif",
          positionSuspecte: false,
          appVersion: "demo-historique-fictif",
          tokenHash: null,
          source: "demo_historique_fictif",
          valideManuellementPar: null,
          motifValidationManuelle: null,
        };
        m.pointages.push(enregistre);
      }
    });
  }
}
