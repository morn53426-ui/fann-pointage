// Traitement serveur d'un pointage QR. Aucune confirmation n'est renvoyée tant que le pointage
// n'est pas VALIDÉ et ENREGISTRÉ. L'heure officielle est celle du serveur (deps.maintenant).
import { rattacherPointage } from "../shared/presence.ts";
import { MS_MINUTE } from "../shared/types.ts";
import type { Poste, Regime } from "../shared/types.ts";
import { verifierQr } from "./qr.ts";
import { message, PROCEDURE_GPS } from "./messages.ts";
import { lirePositionBrute, PARAMS_LOC_DEFAUT, verifierLocalisation } from "./localisation.ts";
import type { ParamsLoc, PermissionLoc, StatutLoc, Validation, ZoneLoc } from "./localisation.ts";

export interface AgentCtx { id: string; actif: boolean; serviceId: string; regime: Regime }
export interface PostePlanifie extends Poste { planningId: string }

export interface PointageEnregistre {
  id: string; agentId: string; serviceId: string; planningId: string | null; posteId: string | null;
  zoneId: string | null; type: "arrivee" | "depart"; serverTs: Date;
  /** Heure saisie par un poste hors ligne; non fiable avant validation manuelle. */
  capturedTs?: Date | null;
  validation: Validation | "valide_manuellement"; motifRefus: string | null; idempotencyKey: string;
  statutLocalisation: StatutLoc; latitude: number | null; longitude: number | null;
  precisionM: number | null; positionCollecteeLe: Date | null; distanceM: number | null;
  methodeLoc: string | null; positionSuspecte: boolean; appVersion: string | null;
  tokenHash: string | null; source: string;
  valideManuellementPar: string | null; motifValidationManuelle: string | null;
}
export type NouveauPointage = Omit<PointageEnregistre, "id">;

/** Heure employée dans les calculs de présence : l'heure capturée hors ligne ne devient officielle qu'après validation manuelle. */
export function instantAnalysePointage(p: PointageEnregistre): Date {
  if (p.validation === "valide_manuellement" && p.capturedTs instanceof Date && !Number.isNaN(p.capturedTs.getTime())) return p.capturedTs;
  return p.serverTs;
}

export interface EvenementSecurite { type: string; agentId: string | null; at: Date; detail?: Record<string, unknown> }

export class ErreurDoublon extends Error {
  constructor() { super("Clé d'idempotence déjà utilisée"); this.name = "ErreurDoublon"; }
}

export interface Depots {
  maintenant(): Date;
  secretQr(): string;
  agent(id: string): Promise<AgentCtx | null>;
  zone(id: string): Promise<ZoneLoc | null>;
  /** Zones actives du service de l'agent : sert au pointage personnel par badge ou matricule (sans QR de zone). */
  zonesDuService?(serviceId: string): Promise<ZoneLoc[]>;
  /** Toutes les zones actives de l'hôpital : un agent peut pointer dans le périmètre d'un autre service. */
  zonesActives?(): Promise<ZoneLoc[]>;
  postesAgent(agentId: string, autour: Date): Promise<PostePlanifie[]>;
  pointagesDuPoste(agentId: string, posteId: string): Promise<PointageEnregistre[]>;
  pointageParCle(agentId: string, cle: string): Promise<PointageEnregistre | null>;
  qrDejaUtilise(tokenHash: string, agentId: string): Promise<boolean>;
  compterRefusHorsZone(agentId: string, depuis: Date): Promise<number>;
  /** Doit être atomique : enregistre le pointage ET l'usage du QR ; lève ErreurDoublon si la clé existe. */
  enregistrer(p: NouveauPointage): Promise<PointageEnregistre>;
  journaliser(e: EvenementSecurite): Promise<void>;
}

export interface ParamsPointage {
  loc: ParamsLoc;
  intervalleMinS: number;        // anti double-scan
  seuilTentativesHorsZone: number;
  fenetreTentativesMin: number;
}
export const PARAMS_POINTAGE_DEFAUT: ParamsPointage = {
  loc: PARAMS_LOC_DEFAUT, intervalleMinS: 120, seuilTentativesHorsZone: 3, fenetreTentativesMin: 30,
};

/** Requête client. L'identité vient de la SESSION (agentId), jamais du corps ; aucune heure client n'est utilisée comme heure de pointage. */
export interface RequetePointage {
  agentId: string; qrToken: unknown; idempotencyKey: unknown;
  permission: PermissionLoc; position: unknown; appVersion?: unknown; source?: string;
  /**
   * Pointage personnel : l'agent, connecté à SON compte, prouve sa présence avec son propre badge ou son matricule
   * (identité déjà contrôlée par la route) au lieu du QR de zone. La localisation reste obligatoire.
   */
  identification?: { mode: "badge" | "matricule" };
}

export interface ReponsePointage {
  confirme: boolean; enregistre: boolean; rejoue: boolean;
  validation: Validation | "valide_manuellement" | "non_enregistre";
  type: "arrivee" | "depart" | null; code: string | null; message: string;
  zone: { nom: string | null; distanceM: number | null; ecartZoneM: number | null; precisionM: number | null } | null;
  statutLocalisation: StatutLoc | null; procedureGps: string | null;
  pointageId: string | null; serverTs: string | null;
}

const PROBLEMES_GPS = new Set(["permission_refusee", "gps_indisponible", "position_ancienne", "precision_insuffisante", "hors_zone"]);

function reponseNonEnregistree(code: string): ReponsePointage {
  return { confirme: false, enregistre: false, rejoue: false, validation: "non_enregistre", type: null, code, message: message(code),
    zone: null, statutLocalisation: null, procedureGps: null, pointageId: null, serverTs: null };
}

function reponseDe(p: PointageEnregistre, zoneNom: string | null, ecart: number | null, rejoue: boolean): ReponsePointage {
  const code = p.motifRefus;
  return {
    confirme: p.validation === "accepte" || p.validation === "valide_manuellement", enregistre: true, rejoue,
    validation: p.validation, type: p.type, code, message: message(code),
    zone: { nom: zoneNom, distanceM: p.distanceM, ecartZoneM: ecart, precisionM: p.precisionM },
    statutLocalisation: p.statutLocalisation, procedureGps: code && PROBLEMES_GPS.has(code) ? PROCEDURE_GPS : null,
    pointageId: p.id, serverTs: p.serverTs.toISOString(),
  };
}

export async function traiterPointage(d: Depots, req: RequetePointage, params: ParamsPointage = PARAMS_POINTAGE_DEFAUT): Promise<ReponsePointage> {
  const now = d.maintenant();
  const evt = (type: string, detail?: Record<string, unknown>) => d.journaliser({ type, agentId: req.agentId, at: now, detail });

  // 1. Requête et idempotence
  const cle = req.idempotencyKey;
  if (typeof cle !== "string" || cle.length === 0 || cle.length > 100) return reponseNonEnregistree("requete_invalide");
  const existant = await d.pointageParCle(req.agentId, cle);
  if (existant) return reponseDe(existant, null, null, true);

  // 2. Compte (session authentifiée)
  const agent = await d.agent(req.agentId);
  if (!agent) { await evt("compte_inconnu"); return reponseNonEnregistree("compte_inconnu"); }
  if (!agent.actif) { await evt("compte_inactif"); return reponseNonEnregistree("compte_inactif"); }

  // 3. QR : signature, expiration, réutilisation (sauf pointage personnel par badge ou matricule)
  const identite = req.identification?.mode ?? null;
  let qrTokenHash: string | null = null;
  let zoneQr: ZoneLoc | null = null;
  if (!identite) {
    const qr = verifierQr(req.qrToken, d.secretQr(), now);
    if (!qr.ok) {
      await evt("qr_invalide", { raison: qr.raison });
      return reponseNonEnregistree(qr.raison === "expire" ? "qr_expire" : "qr_invalide");
    }
    // Règle métier : le QR affiché dans un service ne sert qu'aux agents de CE service. Un agent d'un autre service
    // pointe avec le QR de son badge ou son matricule (valables partout dans l'hôpital). Contrôle fait avant toute consommation du jeton.
    zoneQr = await d.zone(qr.zoneId);
    if (zoneQr && zoneQr.serviceId !== agent.serviceId) {
      await evt("qr_autre_service_refuse", { zoneId: zoneQr.id, zoneServiceId: zoneQr.serviceId, agentServiceId: agent.serviceId });
      return reponseNonEnregistree("qr_autre_service");
    }
    // QR permanent (affiche du service) : réutilisable par nature, pas de contrôle d'usage unique ni d'enregistrement du jeton.
    if (!qr.permanent) {
      if (await d.qrDejaUtilise(qr.tokenHash, agent.id)) { await evt("qr_reutilise"); return reponseNonEnregistree("qr_reutilise"); }
      qrTokenHash = qr.tokenHash;
    }
  }

  // 4. Poste planifié (régime de l'affectation) et nature du pointage (arrivée ou départ)
  const postes = await d.postesAgent(agent.id, now);
  const poste = rattacherPointage(now, postes) as PostePlanifie | null;
  let type: "arrivee" | "depart" = "arrivee";
  if (poste) {
    const deja = (await d.pointagesDuPoste(agent.id, poste.posteId)).filter((p) => p.validation !== "refuse");
    const arrivees = deja.filter((p) => p.type === "arrivee");
    const departs = deja.filter((p) => p.type === "depart");
    if (arrivees.length > 0 && departs.length > 0) { await evt("poste_deja_complet", { posteId: poste.posteId }); return reponseNonEnregistree("poste_deja_complet"); }
    const dernier = deja.reduce<Date | null>((m, p) => (m === null || p.serverTs > m ? p.serverTs : m), null);
    if (dernier && now.getTime() - dernier.getTime() < params.intervalleMinS * 1000) return reponseNonEnregistree("trop_rapproche");
    type = arrivees.length > 0 ? "depart" : "arrivee";
  }

  // 5. Localisation (la zone vient du QR ou, pour le pointage personnel, du service de l'agent : jamais du client)
  const position = lirePositionBrute(req.position);
  let zone: ZoneLoc | null;
  let verdict: ReturnType<typeof verifierLocalisation>;
  // Badge ou matricule : la position est acceptée dès qu'elle est couverte par une zone active de l'hôpital, quel que soit le service.
  const zonesHopital = async (): Promise<ZoneLoc[]> => {
    const toutes = d.zonesActives ? await d.zonesActives() : ((await d.zonesDuService?.(agent.serviceId)) ?? []);
    // Zones du service de l'agent en premier (ordre stable ensuite) : le rattachement reste celui du service quand les deux couvrent le point.
    return [...toutes].filter((z) => z.actif).sort((a, b) => Number(b.serviceId === agent.serviceId) - Number(a.serviceId === agent.serviceId));
  };
  const evaluer = (z: ZoneLoc) => ({ z, v: verifierLocalisation({ permission: req.permission, position, zone: z, maintenant: now, params: params.loc }) });
  if (!identite) {
    // QR du service : la position doit être couverte par la zone du QR (zone inactive ou inconnue = refus, ce qui permet de révoquer une affiche).
    zone = zoneQr;
    verdict = verifierLocalisation({ permission: req.permission, position, zone, maintenant: now, params: params.loc });
  } else {
    const verdicts = (await zonesHopital()).map(evaluer);
    const meilleur = verdicts.find((x) => x.v.validation === "accepte")
      ?? [...verdicts].sort((a, b) => (a.v.distanceM ?? Infinity) - (b.v.distanceM ?? Infinity))[0];
    if (meilleur) { zone = meilleur.z; verdict = meilleur.v; }
    else {
      // Aucune zone configurée dans l'hôpital : pas de preuve de présence sur site, un responsable vérifie.
      zone = null;
      verdict = { ...verifierLocalisation({ permission: req.permission, position, zone: null, maintenant: now, params: params.loc }), validation: "a_verifier", code: "zone_service_non_configuree" };
    }
  }

  let validation: Validation = verdict.validation;
  let code = verdict.code;
  // Badge ou matricule dans la zone d'un autre service : autorisé (l'agent est dans l'hôpital), mais tracé pour l'audit.
  if (zone && zone.serviceId !== agent.serviceId && validation === "accepte") await evt("pointage_zone_autre_service", { zoneId: zone.id, zoneServiceId: zone.serviceId, agentServiceId: agent.serviceId });
  if (!poste && validation === "accepte") { validation = "a_verifier"; code = "aucun_poste_planifie"; }

  // 6. Enregistrement (la confirmation dépend de l'enregistrement réel)
  const nouveau: NouveauPointage = {
    agentId: agent.id, serviceId: agent.serviceId, planningId: poste?.planningId ?? null, posteId: poste?.posteId ?? null,
    zoneId: zone?.id ?? null, type, serverTs: now, validation, motifRefus: validation === "accepte" ? null : code,
    idempotencyKey: cle, statutLocalisation: verdict.statut,
    latitude: position?.latitude ?? null, longitude: position?.longitude ?? null,
    precisionM: verdict.precisionM, positionCollecteeLe: position?.collecteeLe ?? null, distanceM: verdict.distanceM,
    methodeLoc: position?.methode ?? null, positionSuspecte: verdict.positionSuspecte,
    appVersion: typeof req.appVersion === "string" ? req.appVersion.slice(0, 40) : null,
    tokenHash: qrTokenHash, source: req.source ?? (identite === "badge" ? "badge_perso" : identite === "matricule" ? "matricule_perso" : "qr_pwa"),
    valideManuellementPar: null, motifValidationManuelle: null,
  };
  let enregistre: PointageEnregistre;
  try {
    enregistre = await d.enregistrer(nouveau);
  } catch (e) {
    if (e instanceof ErreurDoublon) {
      const p = await d.pointageParCle(agent.id, cle);
      if (p) return reponseDe(p, verdict.nomZone, verdict.ecartZoneM, true);
    }
    await evt("enregistrement_echoue");
    return reponseNonEnregistree("non_enregistre");
  }

  if (verdict.statut === "hors_zone") {
    const depuis = new Date(now.getTime() - params.fenetreTentativesMin * MS_MINUTE);
    if ((await d.compterRefusHorsZone(agent.id, depuis)) >= params.seuilTentativesHorsZone) await evt("tentatives_hors_zone_repetees");
  }
  if (verdict.positionSuspecte) await evt("position_suspecte", { pointageId: enregistre.id });
  return reponseDe(enregistre, verdict.nomZone, verdict.ecartZoneM, false);
}
