// Routes des plannings (/api/plannings) et des feuilles d'émargement (/api/emargement) du mode démo : consultation, génération conforme
// au régime de chaque agent (vérification des chevauchements et des repos), modification et suppression d'un poste.
// Extraites de routes.ts ; même logique et mêmes droits. Retourne `undefined` quand la requête ne concerne pas ces routes.
import { construireEmargement } from "../rapports/emargement.ts";
import { reponseEmargement } from "./emargement-reponse.ts";
import { json, objet } from "./reponses.ts";
import { randomUUID } from "node:crypto";
import { ErreurRegime } from "../shared/types.ts";
import { cle, civilDeInstant, jours, parseCle } from "../shared/civil.ts";
import { dakarDateTime, dakarParts } from "../shared/time.ts";
import { CONFIG_GENERAL_DEFAUT, HEURE_FIN, HEURE_FIN_MIN, posteDuJour } from "../regimes/general/index.ts";
import * as garde from "../regimes/garde/index.ts";
import * as urgences from "../regimes/urgences/index.ts";
import * as mobil from "../regimes/mobil/index.ts";
import { verifierGardes } from "../regimes/garde/index.ts";
import { verifierPostesUrgences } from "../regimes/urgences/index.ts";
import type { MagasinDemo, Utilisateur } from "./magasin.ts";
import type { Reponse, Requete } from "./routes.ts";

export async function routePlannings(req: Requete, user: Utilisateur, m: MagasinDemo, now: Date): Promise<Reponse | undefined> {
  const { methode, chemin } = req;
  // Génération du planning conforme au régime de chaque agent et vérification des chevauchements/repos.
  if (chemin === "/api/plannings" && methode === "GET") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Consultation du planning réservée aux responsables et à l'administrateur.");
    const debutQ = req.requete.debut, finQ = req.requete.fin;
    if (debutQ) { try { parseCle(debutQ); } catch { throw new ErreurRegime("requete_invalide", "Date de début invalide."); } }
    if (finQ) { try { parseCle(finQ); } catch { throw new ErreurRegime("requete_invalide", "Date de fin invalide."); } }
    if (debutQ && finQ && finQ < debutQ) throw new ErreurRegime("requete_invalide", "La date de fin précède la date de début.");
    const autorises = new Set(m.infosAgents.filter((a) => user.role === "administrateur" || user.servicesGeres.includes(a.serviceId)).map((a) => a.id));
    const plannings = m.entrees.filter((e) => autorises.has(e.agentId) && (!debutQ || e.poste.debut.toISOString().slice(0, 10) >= debutQ) && (!finQ || e.poste.debut.toISOString().slice(0, 10) <= finQ))
      .map((e) => ({ agentId: e.agentId, agent: m.infosAgents.find((a) => a.id === e.agentId)?.prenom + " " + m.infosAgents.find((a) => a.id === e.agentId)?.nom, serviceId: m.agents.get(e.agentId)?.serviceId, service: m.services.find((s) => s.id === m.agents.get(e.agentId)?.serviceId)?.nom ?? m.agents.get(e.agentId)?.serviceId, regime: e.poste.regime, type: e.poste.type, debut: e.poste.debut.toISOString(), fin: e.poste.fin.toISOString(), planningId: e.poste.planningId, modifiable: e.poste.planningId.startsWith("manual-") }));
    plannings.sort((a, b) => a.debut.localeCompare(b.debut));
    return json(200, { plannings, joursFeries: [...m.joursFeries.values()].sort((a, b) => a.date.localeCompare(b.date)) });
  }
  // Feuilles d'émargement hebdomadaires par service (aperçu JSON ou classeur Excel .xlsx en base64).
  if (chemin === "/api/emargement" && methode === "GET") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Feuilles d'émargement réservées aux responsables et à l'administrateur.");
    const dateQ = req.requete.date ?? "";
    let emargement;
    try {
      const visibles = (a: { serviceId: string }) => user.role === "administrateur" || user.servicesGeres.includes(a.serviceId);
      const aujourdhui = now.toISOString().slice(0, 10);
      emargement = construireEmargement({
        dateDansLaSemaine: dateQ || aujourdhui,
        agents: m.infosAgents.filter(visibles).map((a) => ({ id: a.id, prenom: a.prenom, nom: a.nom, serviceId: a.serviceId, regime: m.agents.get(a.id)?.regime ?? a.regime, actif: a.actif && !!m.agents.get(a.id)?.actif })),
        services: m.services.filter((s) => user.role === "administrateur" || user.servicesGeres.includes(s.id)).map((s) => ({ id: s.id, nom: s.nom })),
        postes: m.entrees.filter((e) => visibles({ serviceId: m.agents.get(e.agentId)?.serviceId ?? "" })).map((e) => ({ agentId: e.agentId, debut: e.poste.debut, fin: e.poste.fin, regime: e.poste.regime, type: e.poste.type })),
      });
    } catch (e) { throw new ErreurRegime("requete_invalide", e instanceof Error ? e.message : "Date invalide."); }
    return reponseEmargement(emargement, req.requete);
  }
  if (chemin === "/api/plannings" && methode === "POST") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Création de planning réservée aux responsables et à l'administrateur.");
    const c = objet(req.corps);
    const agentId = typeof c.agentId === "string" ? c.agentId : "";
    const dateDebut = typeof c.dateDebut === "string" ? c.dateDebut : "";
    const dateFin = typeof c.dateFin === "string" ? c.dateFin : "";
    let debutCivil, finCivil;
    try { debutCivil = parseCle(dateDebut); finCivil = parseCle(dateFin); }
    catch { throw new ErreurRegime("requete_invalide", "Dates invalides : utilisez AAAA-MM-JJ."); }
    if (dateFin < dateDebut) throw new ErreurRegime("requete_invalide", "La date de fin précède la date de début.");
    const nombreJours = Math.round((Date.UTC(finCivil.year, finCivil.month - 1, finCivil.day) - Date.UTC(debutCivil.year, debutCivil.month - 1, debutCivil.day)) / 86_400_000) + 1;
    if (nombreJours > 370) throw new ErreurRegime("requete_invalide", "La génération est limitée à 370 jours par opération.");
    const agent = m.infosAgents.find((a) => a.id === agentId && a.actif);
    if (!agent || !m.agents.get(agentId)?.actif) throw new ErreurRegime("introuvable", "Agent actif introuvable.");
    if (user.role === "responsable" && !user.servicesGeres.includes(agent.serviceId)) throw new ErreurRegime("non_autorise", "Agent hors de votre périmètre.");
    const debut08 = dakarDateTime(debutCivil.year, debutCivil.month, debutCivil.day, 8);
    const debut20 = dakarDateTime(debutCivil.year, debutCivil.month, debutCivil.day, 20);
    let candidats;
    if (agent.regime === "general") {
      // Service qui termine avant 16 h : l'administrateur ou le responsable fixe l'heure de fin (10 à 16, heure de Dakar).
      let heureFin: number | undefined;
      if (c.heureFin !== undefined && c.heureFin !== null && c.heureFin !== "") {
        heureFin = Number(c.heureFin);
        if (!Number.isInteger(heureFin) || heureFin < HEURE_FIN_MIN || heureFin > HEURE_FIN) throw new ErreurRegime("requete_invalide", `L'heure de fin doit être un entier entre ${HEURE_FIN_MIN} et ${HEURE_FIN}.`);
      }
      const configuration = { ...CONFIG_GENERAL_DEFAUT, joursFeries: new Set(m.joursFeries.keys()), ...(heureFin !== undefined ? { heureFin } : {}) };
      candidats = jours(debutCivil, finCivil).map((d) => posteDuJour(d, configuration)).filter((p) => p !== null);
    } else if (agent.regime === "garde") {
      const nombre = Math.floor((nombreJours - 1) / 3) + 1;
      candidats = garde.genererCycleGardes(debut08, nombre).filter((p) => p.debut.toISOString().slice(0, 10) <= dateFin);
    } else if (agent.regime === "mobil") {
      const equipe = c.equipeMobil === "nuit" ? "nuit" : c.equipeMobil === "jour" ? "jour" : "";
      if (!equipe) throw new ErreurRegime("requete_invalide", "Choisissez l'équipe de jour ou de nuit pour le service Mobil.");
      const inclureWeekEnds = c.inclureWeekEndsMobil === true;
      const inclureJoursFeries = c.inclureJoursFeriesMobil === true;
      if (equipe === "jour") {
        candidats = mobil.genererJoursMobil(debutCivil, finCivil, new Set(m.joursFeries.keys()), { inclureWeekEnds, inclureJoursFeries });
      } else {
        const groupe = c.groupeNuitMobil === "B" ? 1 : c.groupeNuitMobil === "C" ? 2 : c.groupeNuitMobil === "A" ? 0 : -1;
        if (groupe < 0) throw new ErreurRegime("requete_invalide", "Choisissez le groupe de rotation A, B ou C pour les nuits Mobil.");
        const premier = dakarDateTime(debutCivil.year, debutCivil.month, debutCivil.day + groupe, 8);
        candidats = mobil.genererCycleNuitsMobil(premier, nombreJours, new Set(m.joursFeries.keys())).filter((p) => p.debut.toISOString().slice(0, 10) <= dateFin);
      }
    } else {
      const equipe = c.equipeUrgences === "nuit" ? "nuit" : c.equipeUrgences === "jour" ? "jour" : "";
      if (!equipe) throw new ErreurRegime("requete_invalide", "Choisissez l'équipe jour ou nuit pour les urgences.");
      // Écart minimal entre deux débuts : 36 h (passage d'équipe) ; un poste par jour suffit donc largement.
      const nombre = nombreJours + 1;
      candidats = (equipe === "jour" ? urgences.genererCycleJourUrgences(debut08, nombre) : urgences.genererCycleNuitUrgences(debut20, nombre)).postes.filter((p) => p.debut.toISOString().slice(0, 10) <= dateFin);
    }
    if (!candidats.length) throw new ErreurRegime("requete_invalide", "Aucun poste à créer sur cette période. Vérifiez les jours fériés et les dates.");
    const existants = m.entrees.filter((e) => e.agentId === agentId).map((e) => e.poste);
    const tout = [...existants, ...candidats];
    const chevauche = candidats.some((p, i) => existants.some((e) => p.debut < e.fin && p.fin > e.debut) || candidats.slice(0, i).some((e) => p.debut < e.fin && p.fin > e.debut));
    if (chevauche) throw new ErreurRegime("conflit", "Le planning chevauche un poste existant. Supprimez ou ajustez d'abord les postes concernés.");
    const conflitsRepos = agent.regime === "garde" ? verifierGardes(tout.filter((p) => p.regime === "garde")) : agent.regime === "urgences" ? verifierPostesUrgences(tout.filter((p) => p.regime === "urgences")) : agent.regime === "mobil" ? mobil.verifierPlanningsMobil(tout) : [];
    const conflitBloquant = conflitsRepos.find((f) => f.gravite === "erreur");
    if (conflitBloquant) throw new ErreurRegime("conflit", conflitBloquant.message);
    const postesCrees = candidats.map((p) => ({ ...p, planningId: `manual-${randomUUID()}` }));
    try { await m.ajouterPlanningsManuels(agentId, postesCrees); }
    catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Impossible d'enregistrer le planning."); }
    await m.journaliser({ type: "planning_genere", agentId, at: now, detail: { auteurId: user.id, serviceId: agent.serviceId, regime: agent.regime, dateDebut, dateFin, nombrePostes: postesCrees.length, equipeUrgences: c.equipeUrgences ?? null, equipeMobil: c.equipeMobil ?? null, groupeNuitMobil: c.groupeNuitMobil ?? null, inclureWeekEndsMobil: c.inclureWeekEndsMobil === true, inclureJoursFeriesMobil: c.inclureJoursFeriesMobil === true } });
    return json(201, { succes: true, nombrePostes: postesCrees.length, postes: postesCrees.map((p) => ({ planningId: p.planningId, debut: p.debut.toISOString(), fin: p.fin.toISOString(), type: p.type })), message: `${postesCrees.length} poste(s) ajouté(s). Vérifiez la liste avant la mise en service.` });
  }
  const matchPlanning = /^\/api\/plannings\/([A-Za-z0-9_-]{1,100})$/.exec(chemin);
  if (matchPlanning && methode === "PATCH") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Modification de planning réservée aux responsables et à l’administrateur.");
    const plan = m.entrees.find((e) => e.poste.planningId === matchPlanning[1]);
    if (!plan) throw new ErreurRegime("introuvable", "Planning introuvable.");
    const agent = m.infosAgents.find((a) => a.id === plan.agentId);
    if (!agent || (user.role === "responsable" && !user.servicesGeres.includes(agent.serviceId))) throw new ErreurRegime("non_autorise", "Planning hors de votre périmètre.");
    const c = objet(req.corps);
    const isoInstant = (x: unknown) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x);
    if (!isoInstant(c.debut) || !isoInstant(c.fin)) throw new ErreurRegime("requete_invalide", "Les dates doivent être des instants ISO 8601 avec suffixe Z (UTC). Utilisez le formulaire de planning pour les modifier.");
    const debut = new Date(c.debut as string);
    const fin = new Date(c.fin as string);
    const motif = typeof c.motif === "string" ? c.motif.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500) : "";
    if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin <= debut) throw new ErreurRegime("requete_invalide", "Les heures de début et de fin doivent être valides, et la fin doit suivre le début.");
    if (motif.length < 4) throw new ErreurRegime("requete_invalide", "Une justification d’au moins 4 caractères est obligatoire pour modifier un poste.");
    if (plan.poste.debut <= now) throw new ErreurRegime("conflit", "Un poste déjà commencé ou passé ne peut pas être modifié.");
    const duree = fin.getTime() - debut.getTime();
    const dateFeriesMobil = new Set(m.joursFeries.keys());
    const dureeStandard = plan.poste.regime === "general" ? 8 : plan.poste.regime === "mobil" ? (plan.poste.type === "nuit" ? mobil.dureeNuitMobil(debut, dateFeriesMobil) : 8) : 12;
    const dureeAutorisee = plan.poste.regime === "garde" ? 24 * 60 * 60_000 : dureeStandard * 60 * 60_000;
    // Service général : la fin peut être avancée (service qui termine avant 16 h), de 10 h à 16 h.
    const dureeGeneralOk = plan.poste.regime === "general" && duree >= (HEURE_FIN_MIN - 8) * 3_600_000 && duree <= dureeAutorisee && duree % 3_600_000 === 0;
    if (duree !== dureeAutorisee && !dureeGeneralOk) throw new ErreurRegime("requete_invalide", `La durée du poste doit rester de ${plan.poste.regime === "garde" ? "24" : dureeStandard} heures. Pour une exception métier, validez d’abord la règle avec la direction.`);
    // Un déplacement de date ne doit jamais permettre de contourner les horaires fixés par le régime.
    const debutParts = dakarParts(debut);
    const heureDebutAttendue = (plan.poste.regime === "urgences" && plan.poste.type === "nuit") ? 20 : (plan.poste.regime === "mobil" && plan.poste.type === "nuit") ? mobil.heureDebutNuitMobil(debut, dateFeriesMobil) : 8;
    if (debutParts.hour !== heureDebutAttendue || debutParts.minute !== 0 || debutParts.second !== 0 || debut.getUTCMilliseconds() !== 0) {
      throw new ErreurRegime("requete_invalide", `Ce poste doit commencer à ${String(heureDebutAttendue).padStart(2, "0")} h 00 précises, sans secondes ni millisecondes, heure de Dakar.`);
    }
    if (plan.poste.regime === "general" && debutParts.isoWeekday > 5) {
      throw new ErreurRegime("conflit", "Le service général est planifié du lundi au vendredi ; le samedi et le dimanche sont des jours de repos.");
    }
    if (plan.poste.regime === "general" && m.joursFeries.has(cle(civilDeInstant(debut)))) {
      throw new ErreurRegime("conflit", "Un poste du service général ne peut pas être programmé sur un jour férié enregistré.");
    }
    if (plan.poste.regime === "mobil" && plan.poste.type === "jour") {
      if (debutParts.isoWeekday > 5 && c.inclureWeekEndsMobil !== true) throw new ErreurRegime("conflit", "Le planning Mobil de jour exclut normalement le samedi et le dimanche. Activez l'exception si elle a été autorisée.");
      if (m.joursFeries.has(cle(civilDeInstant(debut))) && c.inclureJoursFeriesMobil !== true) throw new ErreurRegime("conflit", "Le planning Mobil de jour exclut normalement les jours fériés. Activez l'exception si elle a été autorisée.");
    }
    const nouveau = { ...plan.poste, debut, fin, posteId: `${plan.poste.regime}:${plan.poste.type}:${debut.toISOString()}` };
    const autresPostes = m.entrees.filter((e) => e.agentId === plan.agentId && e.poste.planningId !== plan.poste.planningId).map((e) => e.poste);
    const tousPostes = [...autresPostes, nouveau];
    const cycle = plan.poste.regime === "garde"
      ? verifierGardes(tousPostes.filter((p) => p.regime === "garde"))
      : plan.poste.regime === "urgences"
        ? verifierPostesUrgences(tousPostes.filter((p) => p.regime === "urgences"))
        : plan.poste.regime === "mobil"
          ? mobil.verifierPlanningsMobil(tousPostes)
          : [];
    const conflitCycle = cycle.find((f) => f.gravite === "erreur");
    if (conflitCycle) throw new ErreurRegime("conflit", conflitCycle.message);
    let modifie;
    try { modifie = await m.modifierPlanningManuel(plan.poste.planningId, nouveau); }
    catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Modification impossible."); }
    await m.journaliser({ type: "planning_modifie", agentId: plan.agentId, at: now, detail: { auteurId: user.id, planningId: plan.poste.planningId, ancien: { debut: modifie.ancien.debut.toISOString(), fin: modifie.ancien.fin.toISOString() }, nouveau: { debut: nouveau.debut.toISOString(), fin: nouveau.fin.toISOString() }, motif } });
    return json(200, { succes: true, message: "Planning modifié et historisé." });
  }
  if (matchPlanning && methode === "DELETE") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Modification du planning réservée aux responsables et à l'administrateur.");
    const plan = m.entrees.find((e) => e.poste.planningId === matchPlanning[1]);
    if (!plan) throw new ErreurRegime("introuvable", "Planning introuvable.");
    const agent = m.infosAgents.find((a) => a.id === plan.agentId);
    if (!agent || (user.role === "responsable" && !user.servicesGeres.includes(agent.serviceId))) throw new ErreurRegime("non_autorise", "Planning hors de votre périmètre.");
    try { const supprime = await m.supprimerPlanningManuel(matchPlanning[1]); await m.journaliser({ type: "planning_supprime", agentId: supprime.agentId, at: now, detail: { auteurId: user.id, planningId: matchPlanning[1], motif: "suppression de planning futur" } }); }
    catch (e) { throw new ErreurRegime("conflit", e instanceof Error ? e.message : "Suppression impossible."); }
    return json(200, { succes: true, message: "Poste supprimé. L'historique des pointages éventuels est protégé." });
  }
  return undefined;
}
