// Routes de pointage du mode démo : pointage personnel (/api/pointage : QR de zone, badge ou matricule de l'agent connecté)
// et pointage sur poste partagé (/api/pointage-station : réservé aux responsables et à l'administrateur).
// Extraites de routes.ts ; même logique et mêmes droits. Retourne `undefined` quand la requête ne concerne pas ces routes.
import { traiterPointage } from "../pointage/service.ts";
import { rattacherPointage } from "../shared/presence.ts";
import { ErreurRegime } from "../shared/types.ts";
import type { MagasinDemo, Utilisateur } from "./magasin.ts";
import type { Reponse, Requete } from "./routes.ts";
import { json, objet } from "./reponses.ts";

export async function routePointage(req: Requete, user: Utilisateur, m: MagasinDemo, now: Date): Promise<Reponse | undefined> {
  const { methode, chemin } = req;
  if (chemin === "/api/pointage" && methode === "POST") {
    if (!user.agentId) throw new ErreurRegime("non_autorise", "Ce compte n'est associé à aucun agent");
    const c = objet(req.corps);
    // Pointage personnel : badge imprimé ou matricule de l'agent connecté (identité contrôlée ici, GPS contrôlé ensuite).
    const badgeCode = typeof c.badgeCode === "string" ? c.badgeCode.trim() : "";
    const matricule = typeof c.matricule === "string" ? c.matricule.trim() : "";
    let identification: "badge" | "matricule" | null = null;
    if (badgeCode || matricule) {
      if (c.qrToken) throw new ErreurRegime("requete_invalide", "Choisissez un seul moyen : QR de zone, badge ou matricule.");
      const info = m.infosAgents.find((a) => a.id === user.agentId && a.actif);
      if (!info) throw new ErreurRegime("introuvable", "Agent introuvable ou inactif.");
      if (badgeCode) {
        const mb = /^FANN-BADGE:([A-Za-z0-9_-]{1,64})(?::([A-Za-z0-9_-]{40,100}))?$/.exec(badgeCode);
        const valide = !!mb && mb[1] === user.agentId && (m.estAgentManuel(user.agentId) ? !!mb[2] && m.verifierJetonBadge(user.agentId, mb[2]) : !mb[2]);
        if (!valide) throw new ErreurRegime("non_autorise", "Ce badge n'est pas le vôtre, ou il est révoqué. Demandez un renouvellement à l'administrateur.");
        identification = "badge";
      } else {
        if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(matricule) || (info.matricule ?? "").toLocaleLowerCase("fr") !== matricule.toLocaleLowerCase("fr")) throw new ErreurRegime("non_autorise", "Ce matricule ne correspond pas à votre compte.");
        identification = "matricule";
      }
    }
    const r = await traiterPointage(m, {
      agentId: user.agentId, qrToken: c.qrToken, idempotencyKey: c.idempotencyKey,
      permission: c.permission === "accordee" || c.permission === "refusee" ? c.permission : "indisponible",
      position: c.position, appVersion: c.appVersion,
      ...(identification ? { identification: { mode: identification } } : {}),
    });
    return json(200, r);
  }

  // Pointage par badge imprimé depuis un poste partagé. Le responsable est authentifié;
  // aucun téléphone personnel ni GPS de l'agent n'est requis. Un pointage enregistré hors ligne
  // reste à vérifier car l'heure de l'appareil n'est pas une source fiable.
  if (chemin === "/api/pointage-station" && methode === "POST") {
    if (user.role === "brancardier") throw new ErreurRegime("non_autorise", "Le pointage par badge partagé est réservé aux responsables et à l'administrateur.");
    const c = objet(req.corps);
    const badgeCode = typeof c.badgeCode === "string" ? c.badgeCode.trim() : "";
    // Second moyen de pointage : matricule saisi par le responsable authentifié, sans badge.
    const matriculeSaisi = typeof c.matricule === "string" ? c.matricule.trim() : "";
    const parMatricule = !badgeCode && matriculeSaisi !== "";
    const matchBadge = parMatricule ? null : /^FANN-BADGE:([A-Za-z0-9_-]{1,64})(?::([A-Za-z0-9_-]{40,100}))?$/.exec(badgeCode);
    const type = c.type === "arrivee" || c.type === "depart" ? c.type : null;
    const cle = typeof c.idempotencyKey === "string" ? c.idempotencyKey : "";
    const horsLigne = c.horsLigne === true;
    if (parMatricule) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/.test(matriculeSaisi) || !type || !cle || cle.length > 100) throw new ErreurRegime("requete_invalide", "Matricule, type de pointage ou clé d'idempotence invalide.");
    } else if (!matchBadge || !type || !cle || cle.length > 100) throw new ErreurRegime("requete_invalide", "Badge, type de pointage ou clé d'idempotence invalide.");

    let agentId = matchBadge ? matchBadge[1] : "";
    if (parMatricule) {
      const trouves = m.infosAgents.filter((a) => a.actif && a.matricule?.toLocaleLowerCase("fr") === matriculeSaisi.toLocaleLowerCase("fr"));
      if (!trouves.length) throw new ErreurRegime("introuvable", "Matricule inconnu ou agent inactif.");
      if (trouves.length > 1) throw new ErreurRegime("conflit", "Matricule ambigu : contactez l’administrateur.");
      agentId = trouves[0].id;
    } else if (matchBadge) {
      const tokenBadge = matchBadge[2];
      // Les anciens codes sans secret ne restent autorisés que pour les identités fictives de la démo.
      if (m.estAgentManuel(agentId)) {
        if (!tokenBadge || !m.verifierJetonBadge(agentId, tokenBadge)) throw new ErreurRegime("non_autorise", "Badge invalide ou révoqué. Demandez un renouvellement à l’administrateur.");
      } else if (tokenBadge) {
        throw new ErreurRegime("non_autorise", "Le badge de démonstration ne possède pas de jeton versionné.");
      }
    }
    const info = m.infosAgents.find((a) => a.id === agentId && a.actif);
    const agent = m.agents.get(agentId);
    if (!info || !agent || !agent.actif) throw new ErreurRegime("introuvable", "Badge inconnu ou agent inactif.");
    // Poste de pointage : l'agent montre son badge (ou donne son matricule) à un superviseur, qui peut pointer n'importe quel agent
    // de l'hôpital, y compris d'un autre service. Le cas est tracé dans le journal (auteur + services).
    const autreService = user.role === "responsable" && !user.servicesGeres.includes(info.serviceId);
    // Le matricule n'est pas un secret (imprimé, souvent séquentiel) : hors de ses services, un responsable doit scanner le badge physique.
    if (autreService && parMatricule) throw new ErreurRegime("non_autorise", "Pour un agent d'un autre service, scannez son badge imprimé : le matricule seul n'est accepté que pour les agents de vos services.");

    const existant = await m.pointageParCle(agentId, cle);
    if (existant) return json(200, {
      reussi: true, rejoue: true, pointageId: existant.id, agent: `${info.prenom} ${info.nom}`,
      type: existant.type, validation: existant.validation, serverTs: existant.serverTs.toISOString(),
      capturedAt: existant.capturedTs?.toISOString() ?? null,
      message: "Événement déjà reçu; aucun doublon créé.",
    });

    let instant = now;
    if (horsLigne) {
      const brut = typeof c.capturedAt === "string" ? c.capturedAt : "";
      const parse = new Date(brut);
      if (!brut || Number.isNaN(parse.getTime())) throw new ErreurRegime("requete_invalide", "Date capturée hors ligne invalide.");
      if (parse.getTime() > now.getTime() + 5 * 60_000 || parse.getTime() < now.getTime() - 7 * 24 * 60 * 60_000) {
        throw new ErreurRegime("requete_invalide", "Date hors ligne trop éloignée; une vérification manuelle est nécessaire.");
      }
      instant = parse;
    }

    const postes = (await m.postesAgent(agentId)).sort((a, b) => a.debut.getTime() - b.debut.getTime());
    const poste = rattacherPointage(instant, postes);
    const pointagesPoste = poste ? m.pointages.filter((p) => p.agentId === agentId && p.posteId === poste.posteId && p.validation !== "refuse") : [];
    const arrivees = pointagesPoste.filter((p) => p.type === "arrivee");
    const departs = pointagesPoste.filter((p) => p.type === "depart");
    if (poste && type === "arrivee" && arrivees.length) throw new ErreurRegime("conflit", "Une arrivée existe déjà pour ce poste.");
    if (poste && type === "depart" && !arrivees.length) throw new ErreurRegime("conflit", "L'arrivée doit être enregistrée avant le départ.");
    if (poste && type === "depart" && departs.length) throw new ErreurRegime("conflit", "Un départ existe déjà pour ce poste.");

    const aVerifier = horsLigne || !poste;
    const pointage = await m.enregistrer({
      agentId, serviceId: info.serviceId, planningId: poste?.planningId ?? null, posteId: poste?.posteId ?? null,
      zoneId: null, type, serverTs: now, capturedTs: horsLigne ? instant : null,
      validation: aVerifier ? "a_verifier" : "accepte",
      motifRefus: aVerifier ? (horsLigne ? "pointage_hors_ligne_a_verifier" : "aucun_poste_planifie") : null,
      idempotencyKey: cle, statutLocalisation: "indisponible", latitude: null, longitude: null,
      precisionM: null, positionCollecteeLe: null, distanceM: null, methodeLoc: "poste_partage_sans_gps",
      // L'absence de GPS ne signifie pas une position simulée : le statut « à vérifier » suffit à signaler l'incertitude.
      positionSuspecte: false, appVersion: typeof c.appVersion === "string" ? c.appVersion.slice(0, 40) : "station-pwa-1",
      tokenHash: null, source: horsLigne ? "station_hors_ligne" : (parMatricule ? "station_matricule" : "station_badge"),
      valideManuellementPar: null, motifValidationManuelle: null,
    });
    await m.journaliser({
      type: horsLigne ? "pointage_station_hors_ligne_synchronise" : (parMatricule ? "pointage_station_matricule" : "pointage_station_badge"),
      agentId, at: now, detail: {
        pointageId: pointage.id, auteurId: user.id, type, source: pointage.source,
        captureLe: instant.toISOString(), validation: pointage.validation,
        operateurDeclareNonVerifie: typeof c.operateurDeclare === "string" ? c.operateurDeclare.slice(0, 80) : null,
        ...(autreService ? { agentAutreService: true, serviceAgent: info.serviceId, servicesDuSuperviseur: [...user.servicesGeres] } : {}),
      },
    });
    return json(201, {
      reussi: true, rejoue: false, pointageId: pointage.id, agent: `${info.prenom} ${info.nom}`,
      matricule: info.matricule, service: m.services.find((s) => s.id === info.serviceId)?.nom ?? info.serviceId,
      type, validation: pointage.validation, serverTs: pointage.serverTs.toISOString(),
      capturedAt: pointage.capturedTs?.toISOString() ?? null,
      message: horsLigne ? "Pointage synchronisé, en attente de validation par un responsable." : aVerifier ? "Pointage enregistré, poste à vérifier." : "Pointage enregistré.",
    });
  }

  return undefined;
}
