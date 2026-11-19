// Routes métier persistantes PostgreSQL : pointages, plannings, badges, QR, tableau de bord et classements.
// Les autorisations sont appliquées sur le serveur ; les écritures sont transactionnelles et auditées.
import { createHmac, randomUUID } from "node:crypto";
import type { Utilisateur } from "./magasin.ts";
import { exigeRole, exigeUuid, mapSqlErreur, num, obj, pgCode, txt, uuid, valideDate } from "./operations-communs.ts";
import { creerFerie, creerZone, emettreBadge, genererQr, listerBadges, listerFeries, listerZones, modifierEtatZone, renouvelerBadge, revoquerBadge, supprimerFerie } from "./operations-referentiel.ts";
import type { ContexteOps, Ligne } from "./operations-communs.ts";
import { archiverMessage, diffuserMessage, listerDestinatairesMessages, listerMessages, marquerMessageLu, sqlMessageVisiblePour } from "./operations-messages.ts";
export { sqlMessageVisiblePour } from "./operations-messages.ts";
import type { Reponse, Requete } from "./routes.ts";
import type { PoolPg } from "../pointage/postgres.ts";
import { DepotPointagePostgres } from "../pointage/postgres.ts";
import { traiterPointage } from "../pointage/service.ts";
import { message } from "../pointage/messages.ts";
import { hashToken } from "../pointage/qr.ts";
import { ErreurRegime, MS_HEURE } from "../shared/types.ts";
import type { Poste, Regime, TypePoste } from "../shared/types.ts";
import { parseCle, jours } from "../shared/civil.ts";
import { dakarDateTime, dakarParts } from "../shared/time.ts";
import { CONFIG_GENERAL_DEFAUT, HEURE_FIN, HEURE_FIN_MIN, posteDuJour } from "../regimes/general/index.ts";
import * as garde from "../regimes/garde/index.ts";
import * as urgences from "../regimes/urgences/index.ts";
import * as mobil from "../regimes/mobil/index.ts";
import { verifierGardes } from "../regimes/garde/index.ts";
import { verifierPostesUrgences } from "../regimes/urgences/index.ts";
import { creerClassementMensuel, validerMois } from "../classement/classement.ts";
import { REGLES_SCORE_DEFAUT } from "../classement/regles.ts";
import type { DonneesAgentMensuelles, ReglesScore, ClassementMensuel } from "../classement/types.ts";
import { exporterClassementMensuelCsv } from "../classement/export.ts";
import { exporterCsv } from "../rapports/rapport.ts";
import { versCsv as versCsvLocal } from "../rapports/csv.ts";
import type { Rapport, LigneRapport, SyntheseAgent } from "../rapports/rapport.ts";
import { periodePour, dakarLocal } from "../rapports/periode.ts";
import { TOLERANCE_RETARD_MIN } from "../shared/presence.ts";
import { construireEmargement, lundiDeLaSemaine } from "../rapports/emargement.ts";
import { reponseEmargement } from "./emargement-reponse.ts";
import type { TypeRapport } from "../rapports/periode.ts";

/** Instant retenu pour l'analyse d'un pointage : l'heure capturée hors ligne ne devient officielle qu'après validation manuelle (comme instantAnalysePointage). */
const tsEff = (a: string) => `CASE WHEN ${a}.validation='valide_manuellement' AND ${a}.captured_ts IS NOT NULL THEN ${a}.captured_ts ELSE ${a}.server_ts END`;
const json = (statut: number, corps: unknown): Reponse => ({ statut, corps });
const regimeValide = (v: unknown): v is Regime => v === "general" || v === "garde" || v === "urgences" || v === "mobil";
const dateDakar = (d: Date) => `${dakarParts(d).year}-${String(dakarParts(d).month).padStart(2,"0")}-${String(dakarParts(d).day).padStart(2,"0")}`;
const jourFin = (k: string) => { const d = parseCle(k); const suivant = new Date(Date.UTC(d.year, d.month - 1, d.day + 1)); return dakarDateTime(suivant.getUTCFullYear(), suivant.getUTCMonth() + 1, suivant.getUTCDate(), 0); };

export class OperationsPostgres {
  private readonly pool: PoolPg;
  private readonly secretQr: string;
  private readonly depotPointage: DepotPointagePostgres;

  constructor(pool: PoolPg, secretQr: string) {
    if (secretQr.length < 32) throw new Error("Le secret QR/badges doit comporter au moins 32 caractères.");
    this.pool = pool;
    this.secretQr = secretQr;
    this.depotPointage = new DepotPointagePostgres(pool, secretQr);
  }

  /** Contexte injecté dans les modules extraits (messagerie, …). */
  private get ctx(): ContexteOps {
    return { pool: this.pool, secretQr: this.secretQr, tokenBadge: (id, v) => this.tokenBadge(id, v), audit: (...a) => this.audit(...a) };
  }

  private tokenBadge(agentId: string, version: number): string {
    return createHmac("sha256", this.secretQr).update(`FANN-POINTAGE:BADGE:v1:${agentId}:${version}`).digest("base64url");
  }

  async gerer(req: Requete, user: Utilisateur, now: Date): Promise<Reponse | null> {
    const { chemin, methode } = req;
    try {
      // Messagerie persistante : diffusion générale, destinataires individuels et ciblage par service.
      if (chemin === "/api/messages/destinataires" && methode === "GET") return json(200, await listerDestinatairesMessages(this.ctx, user));
      if (chemin === "/api/messages" && methode === "GET") return json(200, await listerMessages(this.ctx, user, req.requete.archives === "1"));
      if (chemin === "/api/messages" && methode === "POST") return json(201, await diffuserMessage(this.ctx, req, user));
      const matchLectureMessage = /^\/api\/messages\/([A-Za-z0-9_-]{1,64})\/lu$/i.exec(chemin);
      if (matchLectureMessage && methode === "POST") return json(200, await marquerMessageLu(this.ctx, matchLectureMessage[1]!, user));
      const matchMessage = /^\/api\/messages\/([A-Za-z0-9_-]{1,64})$/.exec(chemin);
      if (matchMessage && methode === "DELETE") return json(200, await archiverMessage(this.ctx, matchMessage[1]!, user, req.ip));
      if (chemin === "/api/sauvegarde/export" && methode === "GET") {
        exigeRole(user, "administrateur");
        const sauvegarde = await this.exporterDonneesMetier(now);
        const jour = dateDakar(now).replaceAll("-", "");
        return { statut: 200, texte: JSON.stringify(sauvegarde, null, 2), typeContenu: "application/json; charset=utf-8", entetes: { "Content-Disposition": `attachment; filename="fann-pointage-sauvegarde-${jour}.json"`, "Cache-Control": "no-store" } };
      }
      // L'encadrement doit pouvoir planifier son périmètre, sans obtenir le catalogue intégral ni le droit de le modifier.
      if (chemin === "/api/agents" && methode === "GET" && user.role === "responsable") {
        const r = await this.pool.query(`SELECT a.id::text AS id, a.prenom, a.nom, a.matricule, a.actif,
            af.service_id::text AS "serviceId", s.nom AS service, af.regime::text AS regime,
            a.photo_data_url AS "photoDataUrl"
          FROM agents a JOIN LATERAL (
            SELECT service_id, regime FROM agent_affectations
            WHERE agent_id=a.id AND date_debut <= (now() AT TIME ZONE 'Africa/Dakar')::date
              AND (date_fin IS NULL OR date_fin > (now() AT TIME ZONE 'Africa/Dakar')::date)
            ORDER BY date_debut DESC LIMIT 1
          ) af ON true JOIN services s ON s.id=af.service_id
          WHERE a.actif AND s.id=ANY($1::uuid[]) ORDER BY s.nom,a.nom,a.prenom`, [user.servicesGeres]);
        return json(200, { agents: r.rows, source: "postgresql", fictif: false });
      }
      if (chemin === "/api/pointage" && methode === "POST") {
        if (!user.agentId) throw new ErreurRegime("non_autorise", "Ce compte n’est pas associé à une fiche agent.");
        const c = obj(req.corps);
        // Pointage personnel : l'agent connecté scanne SON badge imprimé ou saisit SON matricule (sur place, GPS obligatoire).
        const identification = await this.identitePersonnelle(user.agentId, c);
        return json(200, await traiterPointage(this.depotPointage, {
          agentId: user.agentId, qrToken: c.qrToken, idempotencyKey: c.idempotencyKey,
          permission: c.permission === "accordee" || c.permission === "refusee" ? c.permission : "indisponible",
          position: c.position, appVersion: c.appVersion, source: identification ? (identification === "badge" ? "badge_perso" : "matricule_perso") : "qr_pwa",
          ...(identification ? { identification: { mode: identification } } : {}),
        }));
      }
      if (chemin === "/api/tableau-de-bord" && methode === "GET") return json(200, await this.tableauDeBord(now, req, user));
      if (chemin === "/api/plannings" && methode === "GET") return json(200, await this.listerPlannings(req, user));
      if (chemin === "/api/plannings" && methode === "POST") return json(201, await this.creerPlannings(req, user));
      const matchPlanning = /^\/api\/plannings\/([A-Za-z0-9_-]{1,100})$/.exec(chemin);
      if (matchPlanning && methode === "PATCH") return json(200, await this.modifierPlanning(matchPlanning[1], req, user, now));
      if (matchPlanning && methode === "DELETE") return json(200, await this.annulerPlanning(matchPlanning[1], user, now));
      if (chemin === "/api/jours-feries" && methode === "GET") return json(200, await listerFeries(this.ctx, user));
      if (chemin === "/api/jours-feries" && methode === "POST") return json(201, await creerFerie(this.ctx, req, user));
      const matchFerie = /^\/api\/jours-feries\/(\d{4}-\d{2}-\d{2})$/.exec(chemin);
      if (matchFerie && methode === "DELETE") return json(200, await supprimerFerie(this.ctx, matchFerie[1], user));
      if (chemin === "/api/badges" && methode === "GET") return json(200, await listerBadges(this.ctx, user));
      const matchBadgeAction = /^\/api\/badges\/([A-Za-z0-9_-]{1,64})\/(emettre|renouveler|revoquer)$/.exec(chemin);
      if (matchBadgeAction && methode === "POST") {
        if (matchBadgeAction[2] === "emettre") return json(201, await emettreBadge(this.ctx, matchBadgeAction[1], user, req.ip));
        if (matchBadgeAction[2] === "revoquer") return json(200, await revoquerBadge(this.ctx, matchBadgeAction[1], user, req.ip, now));
        return json(200, await renouvelerBadge(this.ctx, matchBadgeAction[1], user, req.ip, now));
      }
      if (chemin === "/api/pointage-station" && methode === "POST") return json(201, await this.pointageStation(req, user, now));
      if (chemin === "/api/zones" && methode === "GET") return json(200, await listerZones(this.ctx, req, user));
      const matchZone = /^\/api\/zones\/([A-Za-z0-9_-]{1,64})$/.exec(chemin);
      if (matchZone && methode === "PATCH") return json(200, await modifierEtatZone(this.ctx, matchZone[1], req, user));
      if (chemin === "/api/zones" && methode === "POST") return json(201, await creerZone(this.ctx, req, user));
      if (chemin === "/api/qr" && methode === "GET") return json(200, await genererQr(this.ctx, req, user, now));
      const matchValidation = /^\/api\/pointages\/([A-Za-z0-9_-]{1,64})\/validation$/.exec(chemin);
      if (matchValidation && methode === "POST") {
        exigeRole(user, "administrateur", "responsable");
        const c = obj(req.corps);
        const pointageId = exigeUuid(matchValidation[1], "Identifiant de pointage");
        const agentService = await this.pool.query(`SELECT service_id::text AS "serviceId" FROM pointages WHERE id=$1::uuid`, [pointageId]);
        const serviceId = txt(agentService.rows[0]?.serviceId);
        if (!serviceId) throw new ErreurRegime("introuvable", "Pointage introuvable.");
        if (user.role === "responsable" && !user.servicesGeres.includes(serviceId)) throw new ErreurRegime("non_autorise", "Pointage hors de votre périmètre de service.");
        const pointage = await this.depotPointage.marquerValideManuellement(pointageId, user.id, typeof c.motif === "string" ? c.motif : "");
        return json(200, { id: pointage.id, validation: pointage.validation });
      }
      if (chemin === "/api/classement-mensuel" && methode === "GET") return this.classement(req, user);
      if (chemin === "/api/classement-mensuel/generer" && methode === "POST") return json(201, await this.genererClassement(req, user, now));
      if (chemin === "/api/historique" && methode === "GET") return json(200, await this.historique(req, user));
      if (chemin === "/api/anomalies" && methode === "GET") return json(200, await this.anomalies(user, now, req.requete.statut));
      const matchStatutAnomalie = /^\/api\/anomalies\/([A-Za-z0-9_-]{1,64})\/statut$/.exec(chemin);
      if (matchStatutAnomalie && methode === "POST") return json(200, await this.marquerAnomalie(matchStatutAnomalie[1]!, req, user));
      if (chemin === "/api/compteurs" && methode === "GET") return json(200, await this.compteurs(user, now));
      if (chemin === "/api/absences" && methode === "GET") return await this.listerAbsences(req, user, now);
      if (chemin === "/api/absences" && methode === "POST") return json(201, await this.creerAbsence(req, user));
      const matchAbsence = /^\/api\/absences\/([A-Za-z0-9_-]{1,64})$/.exec(chemin);
      if (matchAbsence && methode === "PATCH") return json(200, await this.deciderAbsence(matchAbsence[1], req, user, now));
      if (chemin === "/api/rapports" && methode === "GET") return await this.rapports(req, user, now);
      if (chemin === "/api/emargement" && methode === "GET") return await this.emargement(req, user, now);
      return null;
    } catch (e) {
      if (e instanceof ErreurRegime) throw e;
      const code = pgCode(e);
      if (code) mapSqlErreur(e);
      throw e;
    }
  }

  /** Export de secours métier JSON : n'exporte ni les mots de passe, ni les sessions, ni les secrets QR/badges. */
  private async exporterDonneesMetier(now: Date) {
    const lignes = async (sql: string) => {
      const r = await this.pool.query(sql);
      return r.rows[0]?.donnees ?? [];
    };
    const objetTable = (table: string, colonnes: string, ordre = "id") =>
      `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.${ordre}), '[]'::jsonb) AS donnees FROM (SELECT ${colonnes} FROM ${table}) t`;
    const tables = {
      agents: objetTable("agents", "id, nom, prenom, matricule, actif, localisation_consentement, localisation_consentement_at, created_at, source_ref, profession"),
      services: objetTable("services", "id, nom, regime_defaut, actif, created_at"),
      affectations: objetTable("agent_affectations", "id, agent_id, service_id, regime, date_debut, date_fin, valide_par, motif, created_at"),
      profils: objetTable("profiles", "user_id, role, agent_id, actif, created_at", "user_id"),
      plannings: objetTable("plannings", "id, poste_id, agent_id, service_id, regime, type_poste, starts_at, ends_at, statut, modifie_par, motif, remplace_planning_id, created_at"),
      pointages: objetTable("pointages", "id, agent_id, service_id, planning_id, zone_id, type, server_ts, captured_ts, validation, motif_refus, source, idempotency_key, statut_localisation, position_collectee_le, methode_loc, position_suspecte, app_version, poste_code, qr_token_id, valide_manuellement_par, motif_validation_manuelle"),
      zonesPointage: objetTable("zones_pointage", "id, nom, service_id, rayon_m, precision_max_m, hors_zone_action, actif, cree_par, created_at"),
      joursFeries: objetTable("jours_feries", "id, date_ferie, libelle, actif"),
      absences: objetTable("absences_anomalies", "id, agent_id, service_id, debut, fin, categorie, justificatif_ref, statut, valide_par, impact_score, created_at, cree_par, note_admin, valide_le, motif_validation"),
      badges: objetTable("badges_agents", "id, agent_id, version, actif, emis_par, emis_le, revoque_par, revoque_le, motif_revocation"),
      parametresScores: objetTable("parametres_scores", "version, criteres, departage, cree_par, created_at", "version"),
      scoresMensuels: objetTable("scores_mensuels", "id, agent_id, mois, version_regles, score_total, taux_presence, retards, absences_injustifiees, pointages_complets, anomalies, pointages_hors_zone, detail, calcule_le"),
      classementsMensuels: objetTable("classements_mensuels", "id, mois, version_regles, genere_le, genere_par, regles_departage, classement, top5"),
      messages: objetTable("messages_diffusion", "id, titre, contenu, auteur_user_id, cree_le, archive_le, portee, priorite"),
      destinatairesMessages: objetTable("messages_destinataires", "message_id, user_id", "message_id"),
      destinatairesServicesMessages: objetTable("messages_services_destinataires", "message_id, service_id", "message_id"),
      lecturesMessages: objetTable("messages_lectures", "message_id, user_id, lu_le", "message_id"),
    };
    const donnees = Object.fromEntries(await Promise.all(Object.entries(tables).map(async ([nom, sql]) => [nom, await lignes(sql)])));
    return { format: "fann-pointage-export-metier-v2", genereLe: now.toISOString(), note: "Export métier partiellement expurgé : les mots de passe, sessions, secrets de badges/QR, coordonnées GPS exactes, adresses, téléphones et photos sont exclus. Ce fichier n'est pas une sauvegarde restaurable. Pour une reprise complète, utilisez les dumps PostgreSQL chiffrés et testés du serveur.", donnees };
  }

  /**
   * Contrôle l'identité d'un pointage personnel : le badge ou le matricule doit être celui du compte connecté.
   * Retourne null si la requête utilise le QR de zone habituel.
   */
  private async identitePersonnelle(agentId: string, c: Record<string, unknown>): Promise<"badge" | "matricule" | null> {
    const badge = typeof c.badgeCode === "string" ? c.badgeCode.trim() : "";
    const matricule = typeof c.matricule === "string" ? c.matricule.trim() : "";
    if (!badge && !matricule) return null;
    if (c.qrToken !== undefined && c.qrToken !== null && c.qrToken !== "") throw new ErreurRegime("requete_invalide", "Choisissez un seul moyen : QR de zone, badge ou matricule.");
    if (badge) {
      const m = /^FANN-BADGE:([0-9a-f-]{36}):([A-Za-z0-9_-]{40,100})$/.exec(badge);
      if (!m || !uuid.test(m[1]!)) throw new ErreurRegime("requete_invalide", message("badge_invalide"));
      if (m[1]!.toLowerCase() !== agentId.toLowerCase()) throw new ErreurRegime("non_autorise", message("badge_invalide"));
      const ok = await this.pool.query(`SELECT 1 FROM badges_agents WHERE agent_id=$1::uuid AND actif AND token_hash=$2 LIMIT 1`, [agentId, hashToken(m[2]!)]);
      if (!ok.rows[0]) throw new ErreurRegime("non_autorise", message("badge_invalide"));
      return "badge";
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,39}$/.test(matricule)) throw new ErreurRegime("requete_invalide", message("matricule_invalide"));
    const r = await this.pool.query(`SELECT 1 FROM agents WHERE id=$1::uuid AND actif AND lower(matricule)=lower($2) LIMIT 1`, [agentId, matricule]);
    if (!r.rows[0]) throw new ErreurRegime("non_autorise", message("matricule_invalide"));
    return "matricule";
  }

  private async audit(userId: string, action: string, table: string, id: string | null, nouvelle: unknown, motif: string | null, ip: string | null = null) {
    await this.pool.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,nouvelle_valeur,motif,ip) VALUES($1::uuid,$2,$3,$4,$5::jsonb,$6,$7)`,
      [userId, action, table, id, JSON.stringify(nouvelle ?? {}), motif, ip]);
  }

  private async listerPlannings(req: Requete, user: Utilisateur) {
    exigeRole(user, "administrateur", "responsable");
    const debut = req.requete.debut ? valideDate(req.requete.debut, "Date de début") : null;
    const fin = req.requete.fin ? valideDate(req.requete.fin, "Date de fin") : null;
    if (debut && fin && fin < debut) throw new ErreurRegime("requete_invalide", "La date de fin précède la date de début.");
    const whereScope = user.role === "administrateur" ? "true" : "s.id = ANY($3::uuid[])";
    const values: unknown[] = [debut, fin];
    if (user.role === "responsable") values.push(user.servicesGeres);
    const r = await this.pool.query(`
      SELECT p.id::text AS "planningId", p.poste_id::text AS "posteId", p.agent_id::text AS "agentId",
        a.prenom || ' ' || a.nom AS agent, p.service_id::text AS "serviceId", s.nom AS service,
        p.regime::text AS regime, p.type_poste::text AS type, p.starts_at AS debut, p.ends_at AS fin,
        p.statut::text AS statut, p.motif,
        (p.statut IN ('prevu','modifie') AND p.starts_at > now()) AS modifiable
      FROM plannings p JOIN agents a ON a.id=p.agent_id JOIN services s ON s.id=p.service_id
      WHERE ($1::date IS NULL OR p.starts_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Dakar'))
        AND ($2::date IS NULL OR p.starts_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Dakar'))
        AND p.statut <> 'annule' AND ${whereScope}
      ORDER BY p.starts_at, s.nom, a.nom`, values);
    const feries = await this.pool.query(`SELECT date_ferie::text AS date, libelle AS nom, NULL::text AS note FROM jours_feries WHERE actif ORDER BY date_ferie`);
    return { plannings: r.rows.map((x) => ({ ...x, debut: new Date(String(x.debut)).toISOString(), fin: new Date(String(x.fin)).toISOString(), modifiable: x.modifiable === true })), joursFeries: feries.rows };
  }

  private async creerPlannings(req: Requete, user: Utilisateur) {
    exigeRole(user, "administrateur", "responsable");
    const c = obj(req.corps); const agentId = exigeUuid(c.agentId, "Agent");
    const dateDebut = valideDate(c.dateDebut, "Début de période"); const dateFin = valideDate(c.dateFin, "Fin de période");
    if (dateFin < dateDebut) throw new ErreurRegime("requete_invalide", "La fin de période précède le début.");
    const a = parseCle(dateDebut), b = parseCle(dateFin);
    const nbJours = Math.round((Date.UTC(b.year,b.month-1,b.day)-Date.UTC(a.year,a.month-1,a.day))/86400000)+1;
    if (nbJours > 370) throw new ErreurRegime("requete_invalide", "La génération est limitée à 370 jours par opération.");
    const ar = await this.pool.query(`SELECT a.id::text AS id, a.prenom, a.nom, a.actif, af.service_id::text AS "serviceId", af.regime::text AS regime, s.nom AS service
      FROM agents a JOIN LATERAL (SELECT service_id, regime FROM agent_affectations WHERE agent_id=a.id AND date_debut <= $2::date AND (date_fin IS NULL OR date_fin > $2::date) ORDER BY date_debut DESC LIMIT 1) af ON true
      JOIN services s ON s.id=af.service_id AND s.actif WHERE a.id=$1::uuid`, [agentId, dateDebut]);
    const agent = ar.rows[0];
    if (!agent || agent.actif !== true) throw new ErreurRegime("introuvable", "Agent actif introuvable sur cette période.");
    const serviceId = txt(agent.serviceId); const regime = txt(agent.regime) as Regime;
    if (user.role === "responsable" && !user.servicesGeres.includes(serviceId)) throw new ErreurRegime("non_autorise", "Agent hors de votre périmètre de service.");
    const joursFeriesR = await this.pool.query(`SELECT date_ferie::text AS date FROM jours_feries WHERE actif AND date_ferie BETWEEN $1::date AND $2::date`, [dateDebut, dateFin]);
    const joursFeries = new Set(joursFeriesR.rows.map((x) => txt(x.date)));
    const debut08 = dakarDateTime(a.year,a.month,a.day,8); const debut20 = dakarDateTime(a.year,a.month,a.day,20);
    let candidats: Poste[];
    if (regime === "general") {
      let heureFin: number | undefined;
      if (c.heureFin !== undefined && c.heureFin !== null && c.heureFin !== "") {
        heureFin = Number(c.heureFin);
        if (!Number.isInteger(heureFin) || heureFin < HEURE_FIN_MIN || heureFin > HEURE_FIN) throw new ErreurRegime("requete_invalide", `L'heure de fin doit être un entier entre ${HEURE_FIN_MIN} et ${HEURE_FIN}.`);
      }
      // Utiliser le calendrier centralisé : lundi–vendredi et exclusion des jours fériés.
      // Ne pas réintroduire ici les sept jours, sinon le backend PostgreSQL contourne le défaut métier.
      candidats = jours(a,b).map((d) => posteDuJour(d, { ...CONFIG_GENERAL_DEFAUT, joursFeries, ...(heureFin !== undefined ? { heureFin } : {}) })).filter((p): p is Poste => !!p);
    } else if (regime === "garde") {
      const nb = Math.floor((nbJours-1)/3)+1;
      candidats = garde.genererCycleGardes(debut08, nb).filter((p) => dateDakar(p.debut) <= dateFin);
    } else if (regime === "mobil") {
      const equipe = c.equipeMobil === "nuit" ? "nuit" : c.equipeMobil === "jour" ? "jour" : "";
      if (!equipe) throw new ErreurRegime("requete_invalide", "Choisissez l'équipe de jour ou de nuit pour le service Mobil.");
      const inclureWeekEnds = c.inclureWeekEndsMobil === true;
      const inclureJoursFeries = c.inclureJoursFeriesMobil === true;
      if (equipe === "jour") {
        candidats = mobil.genererJoursMobil(a, b, joursFeries, { inclureWeekEnds, inclureJoursFeries });
      } else {
        const groupe = c.groupeNuitMobil === "B" ? 1 : c.groupeNuitMobil === "C" ? 2 : c.groupeNuitMobil === "A" ? 0 : -1;
        if (groupe < 0) throw new ErreurRegime("requete_invalide", "Choisissez le groupe de rotation A, B ou C pour les nuits Mobil.");
        const premier = dakarDateTime(a.year, a.month, a.day + groupe, 16);
        candidats = mobil.genererCycleNuitsMobil(premier, Math.ceil(nbJours / 3) + 2).filter((p) => dateDakar(p.debut) <= dateFin);
      }
    } else {
      const equipe = c.equipeUrgences === "nuit" ? "nuit" : c.equipeUrgences === "jour" ? "jour" : "";
      if (!equipe) throw new ErreurRegime("requete_invalide", "Choisissez l’équipe jour ou nuit pour les urgences.");
      const nb = nbJours + 1; // écart minimal entre deux débuts : 36 h (passage d'équipe)
      candidats = (equipe === "jour" ? urgences.genererCycleJourUrgences(debut08,nb) : urgences.genererCycleNuitUrgences(debut20,nb)).postes.filter((p) => dateDakar(p.debut) <= dateFin);
    }
    if (!candidats.length) throw new ErreurRegime("requete_invalide", "Aucun poste à créer sur cette période.");
    // Vérifier les cycles/repos sur une fenêtre de trois jours avant/après la période.
    const ex = await this.pool.query(`SELECT id::text AS id, regime::text AS regime, type_poste::text AS type, starts_at AS debut, ends_at AS fin FROM plannings
      WHERE agent_id=$1::uuid AND statut <> 'annule' AND starts_at >= $2::timestamptz - interval '4 days' AND starts_at <= $3::timestamptz + interval '4 days'`, [agentId, debut08, jourFin(dateFin)]);
    const existants: Poste[] = ex.rows.map((x) => ({ posteId:txt(x.id), regime:txt(x.regime) as Regime, type:txt(x.type) as TypePoste, debut:new Date(String(x.debut)), fin:new Date(String(x.fin)) }));
    const tous = [...existants, ...candidats];
    if (regime === "garde") { const issues = verifierGardes(tous.filter((p) => p.regime === "garde")); const erreur=issues.find((x)=>x.gravite==="erreur"); if (erreur) throw new ErreurRegime("conflit",erreur.message); }
    if (regime === "urgences") { const issues=verifierPostesUrgences(tous.filter((p)=>p.regime==="urgences")); const erreur=issues.find((x)=>x.gravite==="erreur"); if (erreur) throw new ErreurRegime("conflit",erreur.message); }
    if (regime === "mobil") { const issues=mobil.verifierPlanningsMobil(tous); const erreur=issues.find((x)=>x.gravite==="erreur"); if (erreur) throw new ErreurRegime("conflit",erreur.message); }
    const cl = await this.pool.connect(); let transaction = false;
    try {
      await cl.query("BEGIN"); transaction=true;
      // Sérialise toutes les créations de planning pour un même agent. Une nouvelle lecture
      // sous verrou empêche deux requêtes concurrentes de contourner les 56 h de repos Mobil.
      await cl.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [agentId]);
      const frais = await cl.query(`SELECT id::text AS id, regime::text AS regime, type_poste::text AS type, starts_at AS debut, ends_at AS fin
        FROM plannings WHERE agent_id=$1::uuid AND statut <> 'annule'
          AND starts_at >= $2::timestamptz - interval '4 days' AND starts_at <= $3::timestamptz + interval '4 days'`, [agentId, debut08, jourFin(dateFin)]);
      const postesFrais: Poste[] = frais.rows.map((x) => ({ posteId:txt(x.id), regime:txt(x.regime) as Regime, type:txt(x.type) as TypePoste, debut:new Date(String(x.debut)), fin:new Date(String(x.fin)) }));
      const validationFrais = [...postesFrais, ...candidats];
      if (regime === "garde") { const issues=verifierGardes(validationFrais.filter((p)=>p.regime==="garde")); const erreur=issues.find((x)=>x.gravite==="erreur"); if(erreur) throw new ErreurRegime("conflit",erreur.message); }
      if (regime === "urgences") { const issues=verifierPostesUrgences(validationFrais.filter((p)=>p.regime==="urgences")); const erreur=issues.find((x)=>x.gravite==="erreur"); if(erreur) throw new ErreurRegime("conflit",erreur.message); }
      if (regime === "mobil" || postesFrais.some((p)=>p.regime==="mobil")) { const issues=mobil.verifierPlanningsMobil(validationFrais); const erreur=issues.find((x)=>x.gravite==="erreur"); if(erreur) throw new ErreurRegime("conflit",erreur.message); }
      const cree: Ligne[]=[];
      for (const p of candidats) {
        const ins = await cl.query(`INSERT INTO plannings(poste_id,agent_id,service_id,regime,type_poste,starts_at,ends_at,statut,modifie_par)
          VALUES($1::uuid,$2::uuid,$3::uuid,$4::regime_code,$5::type_poste,$6::timestamptz,$7::timestamptz,'prevu',$8::uuid)
          RETURNING id::text AS "planningId", poste_id::text AS "posteId", starts_at AS debut, ends_at AS fin, type_poste::text AS type`,
          [randomUUID(),agentId,serviceId,regime,p.type,p.debut,p.fin,user.id]);
        if(ins.rows[0]) cree.push(ins.rows[0]);
      }
      await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,nouvelle_valeur,motif) VALUES($1,'planning_genere','plannings',$2,$3::jsonb,$4)`, [user.id,agentId,JSON.stringify({dateDebut,dateFin,nombrePostes:cree.length,regime,equipeUrgences:c.equipeUrgences??null,equipeMobil:c.equipeMobil??null,groupeNuitMobil:c.groupeNuitMobil??null,inclureWeekEndsMobil:c.inclureWeekEndsMobil===true,inclureJoursFeriesMobil:c.inclureJoursFeriesMobil===true}),"Génération de planning par l’application"]);
      await cl.query("COMMIT"); transaction=false;
      return { succes:true, nombrePostes:cree.length, postes:cree.map((x)=>({planningId:x.planningId,debut:new Date(String(x.debut)).toISOString(),fin:new Date(String(x.fin)).toISOString(),type:x.type})), message:`${cree.length} poste(s) enregistré(s) dans PostgreSQL.` };
    } catch(e) { if(transaction) await cl.query("ROLLBACK").catch(()=>{}); if(pgCode(e)) mapSqlErreur(e); throw e; }
    finally { cl.release(); }
  }

  private async modifierPlanning(id: string, req: Requete, user: Utilisateur, now: Date) {
    exigeRole(user, "administrateur", "responsable");
    const c = obj(req.corps);
    const debut = typeof c.debut === "string" ? new Date(c.debut) : new Date(NaN);
    const fin = typeof c.fin === "string" ? new Date(c.fin) : new Date(NaN);
    const motif = typeof c.motif === "string" ? c.motif.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500) : "";
    if (!uuid.test(id)) throw new ErreurRegime("requete_invalide", "Identifiant de planning invalide.");
    const formatUtc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
    if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin <= debut || !formatUtc.test(String(c.debut)) || !formatUtc.test(String(c.fin))) {
      throw new ErreurRegime("requete_invalide", "Les dates doivent être des instants ISO UTC valides.");
    }
    if (motif.length < 4) throw new ErreurRegime("requete_invalide", "Un motif d’au moins 4 caractères est obligatoire.");

    const cl = await this.pool.connect();
    let tx = false;
    try {
      await cl.query("BEGIN"); tx = true;
      const rr = await cl.query(`SELECT p.*, p.id::text AS id_txt, p.service_id::text AS service_txt,
          p.regime::text AS regime_txt, p.type_poste::text AS type_txt
        FROM plannings p WHERE p.id=$1::uuid AND p.statut <> 'annule' FOR UPDATE OF p`, [id]);
      const p = rr.rows[0];
      if (!p) throw new ErreurRegime("introuvable", "Planning modifiable introuvable.");
      if (user.role === "responsable" && !user.servicesGeres.includes(txt(p.service_txt))) throw new ErreurRegime("non_autorise", "Planning hors de votre périmètre.");
      if (new Date(String(p.starts_at)) <= now) throw new ErreurRegime("conflit", "Un poste déjà commencé ou passé ne peut pas être modifié.");
      const regime = txt(p.regime_txt) as Regime;
      const type = txt(p.type_txt) as TypePoste;
      // Le même verrou que pour la génération évite un conflit entre une modification et une génération concurrente.
      await cl.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [txt(p.agent_id)]);
      // Un poste futur ne peut pas être déplacé dans le passé (réécriture de l'historique).
      if (debut.getTime() <= now.getTime()) throw new ErreurRegime("requete_invalide", "Le nouveau début doit être postérieur à l’heure actuelle.");
      const duree = (fin.getTime() - debut.getTime()) / MS_HEURE;
      const jourFerieMobil = regime === "mobil" && type === "nuit"
        ? await cl.query(`SELECT 1 FROM jours_feries WHERE actif AND date_ferie=$1::date`, [dateDakar(debut)])
        : { rows: [] as unknown[] };
      const joursFeriesModification = new Set(jourFerieMobil.rows.length ? [dateDakar(debut)] : []);
      const attendue = regime === "garde" ? 24 : regime === "general" ? 8 : regime === "mobil" ? (type === "nuit" ? mobil.dureeNuitMobil(debut, joursFeriesModification) : 8) : 12;
      // Service général : la fin peut être avancée (service qui termine avant 16 h), de 2 h à 8 h de poste.
      const dureeGeneralOk = regime === "general" && Number.isInteger(duree) && duree >= HEURE_FIN_MIN - 8 && duree <= 8;
      if (duree !== attendue && !dureeGeneralOk) throw new ErreurRegime("requete_invalide", `La durée doit rester de ${attendue} heures.`);
      const attenduHeure = regime === "urgences" && type === "nuit" ? 20 : regime === "mobil" && type === "nuit" ? mobil.heureDebutNuitMobil(debut, joursFeriesModification) : 8;
      const partiesDebut = dakarParts(debut);
      if (partiesDebut.hour !== attenduHeure || partiesDebut.minute !== 0 || partiesDebut.second !== 0 || debut.getUTCMilliseconds() !== 0) {
        throw new ErreurRegime("requete_invalide", `Le poste doit commencer à ${attenduHeure} h 00 précises, sans secondes ni millisecondes, heure de Dakar.`);
      }
      if (regime === "general") {
        const parts = dakarParts(debut);
        if (parts.isoWeekday > 5) throw new ErreurRegime("conflit", "Le service général est planifié du lundi au vendredi ; le samedi et le dimanche sont des jours de repos.");
        const h = await cl.query(`SELECT 1 FROM jours_feries WHERE actif AND date_ferie=$1::date`, [dateDakar(debut)]);
        if (h.rows.length) throw new ErreurRegime("conflit", "Un poste du service général ne peut pas être programmé un jour férié.");
      }
      if (regime === "mobil" && type === "jour") {
        const parts = dakarParts(debut);
        if (parts.isoWeekday > 5 && c.inclureWeekEndsMobil !== true) throw new ErreurRegime("conflit", "Le planning Mobil de jour exclut normalement le samedi et le dimanche. Activez l'exception si elle a été autorisée.");
        const h = await cl.query(`SELECT 1 FROM jours_feries WHERE actif AND date_ferie=$1::date`, [dateDakar(debut)]);
        if (h.rows.length && c.inclureJoursFeriesMobil !== true) throw new ErreurRegime("conflit", "Le planning Mobil de jour exclut normalement les jours fériés. Activez l'exception si elle a été autorisée.");
      }
      // Repos et rotation : mêmes contrôles que pour la génération (seules les erreurs bloquent ; les avertissements restent permis).
      {
        // Tous les régimes inspectent aussi les postes Mobil voisins afin qu'une modification
        // d'un autre régime ne puisse pas placer un poste pendant le repos obligatoire de 56 h.
        const autres = await cl.query(`SELECT id::text AS id, regime::text AS regime, type_poste::text AS type, starts_at AS debut, ends_at AS fin FROM plannings
          WHERE agent_id=$1::uuid AND id <> $2::uuid AND statut <> 'annule'
            AND ($3::regime_code='mobil' OR regime=$3::regime_code OR regime='mobil')
            AND starts_at >= $4::timestamptz - interval '6 days' AND starts_at <= $5::timestamptz + interval '6 days'`, [txt(p.agent_id), id, regime, debut, fin]);
        const voisins: Poste[] = autres.rows.map((x) => ({ posteId: txt(x.id), regime: txt(x.regime) as Regime, type: txt(x.type) as TypePoste, debut: new Date(String(x.debut)), fin: new Date(String(x.fin)) }));
        const modifie: Poste = { posteId: id, regime, type, debut, fin };
        if (regime === "garde") {
          const bloquant = verifierGardes([...voisins, modifie].filter((x) => x.regime === "garde")).find((f) => f.gravite === "erreur" && f.posteIds.includes(id));
          if (bloquant) throw new ErreurRegime("conflit", bloquant.message);
        }
        if (regime === "urgences") {
          const bloquant = verifierPostesUrgences([...voisins, modifie].filter((x) => x.regime === "urgences")).find((f) => f.gravite === "erreur" && f.posteIds.includes(id));
          if (bloquant) throw new ErreurRegime("conflit", bloquant.message);
        }
        if (regime === "mobil" || voisins.some((x) => x.regime === "mobil")) {
          const bloquant = mobil.verifierPlanningsMobil([...voisins, modifie]).find((f) => f.gravite === "erreur" && f.posteIds.includes(id));
          if (bloquant) throw new ErreurRegime("conflit", bloquant.message);
        }
      }
      const upd = await cl.query(`UPDATE plannings SET starts_at=$2, ends_at=$3, statut='modifie', motif=$4, modifie_par=$5::uuid
        WHERE id=$1::uuid RETURNING id::text AS id`, [id, debut, fin, motif, user.id]);
      if (!upd.rowCount) throw new ErreurRegime("introuvable", "Planning introuvable.");
      await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,nouvelle_valeur,motif,ip)
        VALUES($1,'planning_modifie','plannings',$2,$3::jsonb,$4,$5)`, [user.id, id, JSON.stringify({ debut: debut.toISOString(), fin: fin.toISOString(), regime, type, inclureWeekEndsMobil: c.inclureWeekEndsMobil === true, inclureJoursFeriesMobil: c.inclureJoursFeriesMobil === true }), motif, req.ip]);
      await cl.query("COMMIT"); tx = false;
      return { succes: true, message: "Planning modifié et historisé dans PostgreSQL." };
    } catch (e) {
      if (tx) await cl.query("ROLLBACK").catch(() => {});
      if (e instanceof ErreurRegime) throw e;
      if (pgCode(e)) mapSqlErreur(e);
      throw e;
    } finally { cl.release(); }
  }

  private async annulerPlanning(id: string, user: Utilisateur, now: Date) {
    exigeRole(user, "administrateur", "responsable");
    const cl = await this.pool.connect();
    let tx = false;
    try {
      await cl.query("BEGIN"); tx = true;
      const p = await cl.query(`SELECT id::text AS id, agent_id::text AS "agentId", service_id::text AS "serviceId", starts_at AS debut
        FROM plannings WHERE id=$1::uuid AND statut <> 'annule' FOR UPDATE`, [exigeUuid(id, "Planning")]);
      const r = p.rows[0];
      if (!r) throw new ErreurRegime("introuvable", "Planning introuvable.");
      if (user.role === "responsable" && !user.servicesGeres.includes(txt(r.serviceId))) throw new ErreurRegime("non_autorise", "Planning hors de votre périmètre.");
      if (new Date(String(r.debut)) <= now) throw new ErreurRegime("conflit", "Seuls les postes futurs peuvent être annulés.");
      const pts = await cl.query(`SELECT 1 FROM pointages WHERE planning_id=$1::uuid LIMIT 1`, [id]);
      if (pts.rows.length) throw new ErreurRegime("conflit", "Ce poste possède des pointages. Il est conservé pour protéger l’historique.");
      await cl.query(`UPDATE plannings SET statut='annule', motif='Annulation demandée par l’encadrement', modifie_par=$2::uuid WHERE id=$1::uuid`, [id, user.id]);
      await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,nouvelle_valeur,motif)
        VALUES($1,'planning_annule','plannings',$2,$3::jsonb,$4)`, [user.id, id, JSON.stringify({ statut: "annule" }), "Annulation d’un poste futur"]);
      await cl.query("COMMIT"); tx = false;
      return { succes: true, message: "Poste annulé. L’historique est conservé." };
    } catch (e) {
      if (tx) await cl.query("ROLLBACK").catch(() => {});
      if (e instanceof ErreurRegime) throw e;
      if (pgCode(e)) mapSqlErreur(e);
      throw e;
    } finally { cl.release(); }
  }

  private async pointageStation(req: Requete,user:Utilisateur,now:Date) {
    exigeRole(user,"administrateur","responsable"); const c=obj(req.corps); const code=typeof c.badgeCode==="string"?c.badgeCode.trim():"";
    // Second moyen de pointage au poste partagé : le matricule saisi par le responsable authentifié (sans badge).
    const matriculeSaisi=typeof c.matricule==="string"?c.matricule.trim():""; const parMatricule=!code&&matriculeSaisi!=="";
    const m=parMatricule?null:/^FANN-BADGE:([0-9a-f-]{36}):([A-Za-z0-9_-]{40,100})$/.exec(code); const type=c.type==="arrivee"||c.type==="depart"?c.type:null; const idempotency=typeof c.idempotencyKey==="string"?c.idempotencyKey:""; const offline=c.horsLigne===true;
    if(parMatricule){ if(!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,39}$/.test(matriculeSaisi)||!type||!idempotency||idempotency.length>100) throw new ErreurRegime("requete_invalide","Matricule, type de pointage ou clé d’idempotence invalide."); }
    else if(!m||!uuid.test(m[1])||!type||!idempotency||idempotency.length>100) throw new ErreurRegime("requete_invalide","Badge versionné, type ou clé d’idempotence invalide.");
    const methodeId=parMatricule?"matricule":"badge"; let agentId=m?m[1]:""; const tokenHash=m?hashToken(m[2]):null;
    let capture=now;
    if(offline){const raw=typeof c.capturedAt==="string"?c.capturedAt:"";capture=new Date(raw);if(!raw||Number.isNaN(capture.getTime())||capture.getTime()>now.getTime()+300000||capture.getTime()<now.getTime()-7*86400000) throw new ErreurRegime("requete_invalide","Heure hors ligne invalide ou trop éloignée.");}
    const cl=await this.pool.connect();let tx=false;
    try {await cl.query("BEGIN");tx=true;
      if(parMatricule){
        // Le matricule est unique mais sensible à la casse en base : on compare sans casse et on refuse toute ambiguïté.
        const trouves=await cl.query(`SELECT id::text AS id FROM agents WHERE lower(matricule)=lower($1) AND actif LIMIT 2`,[matriculeSaisi]);
        if(!trouves.rows[0]) throw new ErreurRegime("introuvable","Matricule inconnu ou agent inactif.");
        if(trouves.rows.length>1) throw new ErreurRegime("conflit","Matricule ambigu : contactez l’administrateur.");
        agentId=txt(trouves.rows[0].id);
      }
      // Sérialise les pointages d'un même agent : sans ce verrou, deux postes qui scannent le même badge en même temps
      // lisent tous deux « pas d'arrivée » (READ COMMITTED) et enregistrent deux arrivées. Verrou levé au COMMIT/ROLLBACK.
      await cl.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",[`fann-pointage:station:${agentId}`]);
      const exist=await cl.query(`SELECT p.id::text AS id,p.service_id::text AS "serviceId",p.type::text AS type,p.validation::text AS validation,p.server_ts AS "serverTs",p.captured_ts AS "capturedTs" FROM pointages p WHERE p.agent_id=$1::uuid AND p.idempotency_key=$2 LIMIT 1`,[agentId,idempotency]);
      if(exist.rows[0]){
        // Poste de pointage : tout superviseur peut pointer un agent de l'hôpital (le rejeu ne révèle donc rien de plus).
        await cl.query("COMMIT");tx=false;return {reussi:true,rejoue:true,pointageId:txt(exist.rows[0].id),type:txt(exist.rows[0].type),validation:txt(exist.rows[0].validation),serverTs:new Date(String(exist.rows[0].serverTs)).toISOString(),capturedAt:exist.rows[0].capturedTs?new Date(String(exist.rows[0].capturedTs)).toISOString():null,message:"Événement déjà reçu ; aucun doublon créé."};}
      const data=await cl.query(`SELECT a.id::text AS id,a.prenom,a.nom,a.matricule,af.service_id::text AS "serviceId",af.regime::text AS regime,s.nom AS service,${parMatricule?"NULL::text":"b.id::text"} AS "badgeId" FROM agents a
        JOIN LATERAL(SELECT service_id,regime FROM agent_affectations WHERE agent_id=a.id AND date_debut <= (now() AT TIME ZONE 'Africa/Dakar')::date AND(date_fin IS NULL OR date_fin>(now() AT TIME ZONE 'Africa/Dakar')::date) ORDER BY date_debut DESC LIMIT 1) af ON true
        JOIN services s ON s.id=af.service_id ${parMatricule?"":"JOIN badges_agents b ON b.agent_id=a.id AND b.actif AND b.token_hash=$2"} WHERE a.id=$1::uuid AND a.actif FOR SHARE OF ${parMatricule?"a":"a,b"}`,parMatricule?[agentId]:[agentId,tokenHash]);
      const a=data.rows[0];if(!a) throw new ErreurRegime(parMatricule?"introuvable":"non_autorise",parMatricule?"Agent sans affectation active : pointage par matricule impossible.":"Badge invalide, révoqué ou agent inactif.");
      // Poste de pointage : le superviseur peut pointer un agent d'un autre service ; le cas est tracé dans le journal d'audit.
      const autreService=user.role==="responsable"&&!user.servicesGeres.includes(txt(a.serviceId));
      // Le matricule n'est pas un secret : hors de ses services, un responsable doit scanner le badge physique.
      if(autreService&&parMatricule) throw new ErreurRegime("non_autorise","Pour un agent d'un autre service, scannez son badge imprimé : le matricule seul n'est accepté que pour les agents de vos services.");
      const posteR=await cl.query(`SELECT id::text AS id,poste_id::text AS "posteId",starts_at AS debut,ends_at AS fin,regime::text AS regime,type_poste::text AS type
        FROM plannings WHERE agent_id=$1::uuid AND statut <> 'annule'
          AND (($3::pointage_type='arrivee' AND starts_at <= $2::timestamptz + interval '60 minutes' AND ends_at >= $2::timestamptz)
            OR ($3::pointage_type='depart' AND starts_at <= $2::timestamptz AND ends_at >= $2::timestamptz - interval '2 hours'))
        ORDER BY starts_at LIMIT 1 FOR SHARE`,[agentId,capture,type]);
      const poste=posteR.rows[0];const posteId=poste?txt(poste.posteId):null;const planningId=poste?txt(poste.id):null;
      // Pointages du même poste (toute la durée du planning) ET pointages des 2 dernières minutes (anti double scan).
      // Sans la jointure sur le planning, un départ enregistré plus de 2 minutes après l'arrivée était refusé (« arrivée absente »)
      // et une seconde arrivée tardive était acceptée.
      const pointsRecents=await cl.query(`SELECT type::text AS type,validation::text AS validation,server_ts AS at,poste_code AS "posteCode"
        FROM pointages WHERE agent_id=$1::uuid AND (server_ts >= $2::timestamptz - interval '2 minutes' OR ($3::uuid IS NOT NULL AND planning_id=$3::uuid)) ORDER BY server_ts DESC LIMIT 50`,[agentId,now,planningId]);
      const existPoste=pointsRecents.rows.filter(x=>posteId ? txt(x.posteCode)===posteId : x.posteCode==null);
      const bons=existPoste.filter(x=>txt(x.validation)!=="refuse");const arrivee= bons.some(x=>txt(x.type)==="arrivee");const depart=bons.some(x=>txt(x.type)==="depart");
      const dernier=existPoste.reduce<Date|null>((latest,x)=>{const d=new Date(String(x.at));return !latest||d>latest?d:latest;},null);
      if(dernier && now.getTime()-dernier.getTime()<120_000) throw new ErreurRegime("conflit","Deux pointages du même agent doivent être espacés d’au moins deux minutes.");
      if(poste&&type==="arrivee"&&arrivee) throw new ErreurRegime("conflit","Une arrivée existe déjà pour ce poste.");
      if(poste&&type==="depart"&&!arrivee) throw new ErreurRegime("conflit","L’arrivée doit être enregistrée avant le départ.");
      if(poste&&type==="depart"&&depart) throw new ErreurRegime("conflit","Un départ existe déjà pour ce poste.");
      const validation=offline||!poste?"a_verifier":"accepte";const motif=offline?"pointage_hors_ligne_a_verifier":!poste?"aucun_poste_planifie":null;
      const ins=await cl.query(`INSERT INTO pointages(agent_id,service_id,planning_id,zone_id,type,server_ts,captured_ts,validation,motif_refus,source,idempotency_key,statut_localisation,methode_loc,position_suspecte,app_version,poste_code)
        VALUES($1::uuid,$2::uuid,$3::uuid,NULL,$4::pointage_type,$5::timestamptz,$6::timestamptz,$7::validation_pointage,$8,$9,$10,'indisponible','poste_partage_sans_gps',false,$11,$12) RETURNING id::text AS id,server_ts AS "serverTs"`,
        [agentId,a.serviceId,planningId,type,now,offline?capture:null,validation,motif,offline?"station_hors_ligne":(parMatricule?"station_matricule":"station_badge"),idempotency,typeof c.appVersion==="string"?c.appVersion.slice(0,40):"station-pwa-1",posteId]);
      const pointage=ins.rows[0];
      await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,nouvelle_valeur,motif,ip) VALUES($1,$2,'pointages',$3,$4::jsonb,$5,$6)`,[user.id,offline?"pointage_station_hors_ligne":(parMatricule?"pointage_station_matricule":"pointage_station_badge"),txt(pointage.id),JSON.stringify({agentId,type,validation,source:offline?"station_hors_ligne":(parMatricule?"station_matricule":"station_badge"),methode:methodeId,capture:capture.toISOString(),...(autreService?{agentAutreService:true,serviceAgent:txt(a.serviceId)}:{})}),parMatricule?"Pointage par matricule au poste partagé":"Pointage par badge au poste partagé",req.ip]);
      await cl.query("COMMIT");tx=false;return {reussi:true,rejoue:false,pointageId:txt(pointage.id),agent:`${txt(a.prenom)} ${txt(a.nom)}`,matricule:a.matricule??null,service:txt(a.service),type,validation,serverTs:new Date(String(pointage.serverTs)).toISOString(),capturedAt:offline?capture.toISOString():null,message:offline?"Pointage synchronisé et mis en attente de vérification.":!poste?"Pointage enregistré, poste à vérifier.":"Pointage enregistré dans PostgreSQL."};
    }catch(e){if(tx) await cl.query("ROLLBACK").catch(()=>{});if(e instanceof ErreurRegime) throw e;if(pgCode(e)) mapSqlErreur(e);throw e;}finally{cl.release();}
  }

  private async tableauDeBord(now:Date,req:Requete,user:Utilisateur) {
    exigeRole(user,"administrateur","responsable");
    const scope=user.role==="administrateur"; const sv=user.servicesGeres;
    // Filtres de l'écran (régime, service) : appliqués côté serveur comme en mode démonstration.
    const params:unknown[]=[now]; const conditions:string[]=[];
    if(!scope){params.push(sv);conditions.push(`s.id=ANY($${params.length}::uuid[])`);}
    if(req.requete.regime){if(!regimeValide(req.requete.regime)) throw new ErreurRegime("requete_invalide","Régime inconnu.");params.push(req.requete.regime);conditions.push(`p.regime=$${params.length}::regime_code`);}
    if(req.requete.service){params.push(exigeUuid(req.requete.service,"Service"));conditions.push(`s.id=$${params.length}::uuid`);}
    const scopeCondition=conditions.length?conditions.join(" AND "):"true";
    const r=await this.pool.query(`WITH poste AS(
      SELECT p.id,p.agent_id,p.service_id,p.regime::text AS regime,p.type_poste::text AS type,p.starts_at,p.ends_at
      FROM plannings p JOIN services s ON s.id=p.service_id WHERE p.statut <> 'annule' AND p.starts_at <= $1::timestamptz AND p.ends_at > $1::timestamptz AND ${scopeCondition}
    ), pts AS(SELECT p.agent_id,p.planning_id,p.type::text AS type,p.validation::text AS validation,p.statut_localisation::text AS loc,p.position_suspecte,p.server_ts,p.captured_ts FROM pointages p WHERE p.server_ts >= $1::timestamptz - interval '36 hours' AND p.server_ts <= $1::timestamptz)
      SELECT po.regime,po.type,po.agent_id::text AS "agentId",po.starts_at AS debut,po.ends_at AS fin,
        bool_or(pt.type='arrivee' AND pt.validation IN('accepte','valide_manuellement')) AS arrivee,
        bool_or(pt.type='depart' AND pt.validation IN('accepte','valide_manuellement')) AS depart,
        bool_or(pt.type='arrivee' AND pt.validation='a_verifier') AS "arriveeAverifier",
        bool_or(pt.validation='a_verifier') AS "aVerifier",
        bool_or(pt.loc='hors_zone') AS "horsZone",bool_or(pt.loc='precision_insuffisante') AS "precisionInsuffisante",bool_or(pt.position_suspecte) AS "positionSuspecte",
        min(${tsEff("pt")}) FILTER(WHERE pt.type='arrivee' AND pt.validation IN('accepte','valide_manuellement')) AS "heureArrivee"
      FROM poste po LEFT JOIN pts pt ON pt.planning_id=po.id GROUP BY po.id,po.regime,po.type,po.agent_id,po.starts_at,po.ends_at`,params);
    const lignes=r.rows;const parRegime:Record<string,any>={};
    for(const regime of ["general","garde","urgences","mobil"]){const groupe=lignes.filter(x=>txt(x.regime)===regime);const postesEnCours:Record<string,number>={};for(const p of groupe) postesEnCours[txt(p.type)]=(postesEnCours[txt(p.type)]??0)+1;
      const present=groupe.filter(p=>p.arrivee===true&&p.depart!==true).length;const attendus=groupe.length;const sansArrivee=groupe.filter(p=>p.arrivee!==true&&new Date(String(p.debut)).getTime()<=now.getTime()-TOLERANCE_RETARD_MIN*60000).length;
      const retards=groupe.filter(p=>p.heureArrivee&&new Date(String(p.heureArrivee)).getTime()>new Date(String(p.debut)).getTime()+TOLERANCE_RETARD_MIN*60000).length;
      parRegime[regime]={attendus,presents:present,enAttenteArrivee:groupe.filter(p=>p.arrivee!==true).length,absentsAConfirmer:sansArrivee,retards,pointagesIncomplets:groupe.filter(p=>new Date(String(p.fin))<now&&p.arrivee===true&&p.depart!==true).length,horsZone:groupe.filter(p=>p.horsZone===true).length,precisionInsuffisante:groupe.filter(p=>p.precisionInsuffisante===true).length,aVerifier:groupe.filter(p=>p.aVerifier===true).length,positionsSuspectes:groupe.filter(p=>p.positionSuspecte===true).length,enRepos:null,postesEnCours};
    }
    const tendance=await this.pool.query(`SELECT d.jour::date::text AS jour,COUNT(DISTINCT p.agent_id)::int AS presents FROM generate_series(($1::date-6),$1::date,interval '1 day') d(jour) LEFT JOIN pointages p ON (p.server_ts AT TIME ZONE 'Africa/Dakar')::date=d.jour::date AND p.type='arrivee' AND p.validation IN('accepte','valide_manuellement') AND ($2::boolean OR p.service_id=ANY($3::uuid[])) GROUP BY d.jour ORDER BY d.jour`,[dateDakar(now),scope,sv]);
    const services=await this.pool.query(`SELECT count(*)::int AS total FROM services s WHERE s.actif AND ${scope?"true":"s.id=ANY($1::uuid[])"}`,scope?[]:[sv]);
    const agents=await this.pool.query(`SELECT count(DISTINCT a.id)::int AS total FROM agents a JOIN agent_affectations af ON af.agent_id=a.id AND af.date_debut <= (now() AT TIME ZONE 'Africa/Dakar')::date AND(af.date_fin IS NULL OR af.date_fin>(now() AT TIME ZONE 'Africa/Dakar')::date) WHERE a.actif AND ${scope?"true":"af.service_id=ANY($1::uuid[])"}`,scope?[]:[sv]);
    const badges=await this.pool.query(`SELECT count(*)::int AS total FROM badges_agents b JOIN agents a ON a.id=b.agent_id
      JOIN LATERAL(SELECT service_id FROM agent_affectations WHERE agent_id=a.id AND date_debut <= (now() AT TIME ZONE 'Africa/Dakar')::date AND(date_fin IS NULL OR date_fin>(now() AT TIME ZONE 'Africa/Dakar')::date) ORDER BY date_debut DESC LIMIT 1) af ON true
      WHERE b.actif AND a.actif AND ($1::boolean OR af.service_id=ANY($2::uuid[]))`,[scope,sv]);
    const incidents=await this.pool.query(`SELECT count(*)::int AS total FROM pointages x
      WHERE x.server_ts >= $1::timestamptz - interval '48 hours'
        AND (x.validation IN ('a_verifier','refuse') OR x.position_suspecte OR x.statut_localisation IN ('hors_zone','precision_insuffisante'))
        AND ($2::boolean OR x.service_id=ANY($3::uuid[]))`,[now,scope,sv]);
    const postes=Object.values(parRegime).reduce((s:any,x:any)=>s+x.attendus,0); const presents=Object.values(parRegime).reduce((s:any,x:any)=>s+x.presents,0);
    const tendance7Jours=tendance.rows.map(x=>({date:txt(x.jour),presents:num(x.presents)}));
    return { genereLe:now.toISOString(), parRegime, indisponible:[], source:"postgresql", fictif:false,
      resume:{agentsActifs:num(agents.rows[0]?.total),servicesActifs:num(services.rows[0]?.total),postesEnCours:postes,presents,pointagesAExaminer:num(incidents.rows[0]?.total),badgesActifs:num(badges.rows[0]?.total),tauxPresence:postes?Math.round(presents/postes*100):0},tendance7Jours,
      activiteRecente:[] };
  }

  private async genererClassement(req:Requete,user:Utilisateur,now:Date) {
    exigeRole(user,"administrateur");const c=obj(req.corps);const mois=valideDate(c.mois,"Mois du classement");validerMois(mois);
    const debut=new Date(`${mois}T00:00:00.000Z`);if(debut.getTime()>=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)) throw new ErreurRegime("requete_invalide","Le classement peut être généré seulement pour un mois entièrement terminé.");
    const d=new Date(`${mois}T00:00:00.000Z`);const next=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1));
    const existe=await this.pool.query(`SELECT 1 FROM classements_mensuels WHERE mois=$1::date LIMIT 1`,[mois]);
    if(existe.rows.length) throw new ErreurRegime("conflit","Un classement existe déjà pour ce mois. Il est immuable pour préserver la traçabilité.");
    const regle=await this.pool.query(`SELECT version,criteres,departage FROM parametres_scores ORDER BY version DESC LIMIT 1`);const row=regle.rows[0];
    const rules:ReglesScore={version:num(row?.version)||REGLES_SCORE_DEFAUT.version,criteres:typeof row?.criteres==="object"&&row.criteres!==null?row.criteres as ReglesScore["criteres"]:REGLES_SCORE_DEFAUT.criteres,departage:Array.isArray(row?.departage)?row.departage as ReglesScore["departage"]:REGLES_SCORE_DEFAUT.departage};
    const mesure=await this.pool.query(`WITH actifmois AS(
        SELECT a.id,a.prenom,a.nom,af.service_id,af.regime::text AS regime,s.nom AS service
        FROM agents a JOIN LATERAL(SELECT service_id,regime FROM agent_affectations WHERE agent_id=a.id AND date_debut < $2::date AND(date_fin IS NULL OR date_fin >= $1::date) ORDER BY date_debut DESC LIMIT 1) af ON true JOIN services s ON s.id=af.service_id
      ), stats AS(
        SELECT p.agent_id,COUNT(*)::int AS postes,
          COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM pointages x WHERE x.planning_id=p.id AND x.type='arrivee' AND x.validation IN('accepte','valide_manuellement')))::int AS honores,
          COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM pointages x WHERE x.planning_id=p.id AND x.type='arrivee' AND x.validation IN('accepte','valide_manuellement') AND ${tsEff("x")}>p.starts_at+interval '${TOLERANCE_RETARD_MIN} minutes'))::int AS retards,
          COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM pointages x WHERE x.planning_id=p.id AND x.type='arrivee' AND x.validation IN('accepte','valide_manuellement')) AND EXISTS(SELECT 1 FROM pointages x WHERE x.planning_id=p.id AND x.type='depart' AND x.validation IN('accepte','valide_manuellement')))::int AS complets,
          COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM pointages x WHERE x.planning_id=p.id AND (x.validation IN('a_verifier','refuse') OR x.position_suspecte)))::int AS anomalies,
          COUNT(*) FILTER(WHERE EXISTS(SELECT 1 FROM pointages x WHERE x.planning_id=p.id AND x.statut_localisation='hors_zone'))::int AS horszone
        FROM plannings p WHERE p.starts_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Dakar') AND p.starts_at < ($2::date::timestamp AT TIME ZONE 'Africa/Dakar') AND p.statut <> 'annule' GROUP BY p.agent_id
      ), abs AS(SELECT aa.agent_id,COUNT(*)::int AS injustifiees FROM absences_anomalies aa WHERE aa.statut='injustifiee' AND aa.debut < ($2::date::timestamp AT TIME ZONE 'Africa/Dakar') AND aa.fin >= ($1::date::timestamp AT TIME ZONE 'Africa/Dakar') GROUP BY aa.agent_id)
      SELECT a.id::text AS id,a.prenom,a.nom,a.service_id::text AS "serviceId",a.regime,a.service,COALESCE(s.postes,0)::int AS postes,COALESCE(s.honores,0)::int AS honores,COALESCE(s.retards,0)::int AS retards,COALESCE(s.complets,0)::int AS complets,COALESCE(s.anomalies,0)::int AS anomalies,COALESCE(s.horszone,0)::int AS horszone,abs.injustifiees::int AS injustifiees
      FROM actifmois a LEFT JOIN stats s ON s.agent_id=a.id LEFT JOIN abs ON abs.agent_id=a.id ORDER BY a.nom,a.prenom`,[mois,next.toISOString().slice(0,10)]);
    const donnees:DonneesAgentMensuelles[]=mesure.rows.map(x=>({agentId:txt(x.id),nom:`${txt(x.prenom)} ${txt(x.nom)}`,service:txt(x.service),regime:txt(x.regime) as Regime,postesPlanifies:num(x.postes),postesHonores:num(x.honores),retards:num(x.retards),absencesInjustifiees:x.injustifiees == null ? null : num(x.injustifiees),pointagesComplets:num(x.complets),anomaliesNonResolues:num(x.anomalies),pointagesHorsZone:num(x.horszone)}));
    const result=creerClassementMensuel({id:randomUUID(),mois,agents:donnees,regles:rules,generePar:user.id,maintenant:now});
    const cl=await this.pool.connect();let tx=false;
    try{await cl.query("BEGIN");tx=true;
      await cl.query(`INSERT INTO classements_mensuels(id,mois,version_regles,genere_par,regles_departage,classement,top5) VALUES($1::uuid,$2::date,$3,$4::uuid,$5::jsonb,$6::jsonb,$7::jsonb)`,[result.id,mois,rules.version,user.id,JSON.stringify(rules.departage),JSON.stringify(result.classement),JSON.stringify(result.top5)]);
      for(const s of result.scores){await cl.query(`INSERT INTO scores_mensuels(agent_id,mois,version_regles,score_total,taux_presence,retards,absences_injustifiees,pointages_complets,anomalies,pointages_hors_zone,detail) VALUES($1::uuid,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,[s.agentId,mois,rules.version,s.scoreTotal,s.tauxPresence,s.retards,s.absencesInjustifiees,s.pointagesComplets,s.anomalies,s.pointagesHorsZone,JSON.stringify(s.detail)]);}
      await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,nouvelle_valeur,motif) VALUES($1,'classement_mensuel_genere','classements_mensuels',$2,$3::jsonb,'Calcul depuis les plannings et pointages PostgreSQL')`,[user.id,mois,JSON.stringify({classementId:result.id,agentsClasses:result.classement.length,versionRegles:rules.version})]);await cl.query("COMMIT");tx=false;return {mois,classement:result,top5:result.top5,generationPossible:false};
    }catch(e){if(tx) await cl.query("ROLLBACK").catch(()=>{});if(pgCode(e)) mapSqlErreur(e);throw e;}finally{cl.release();}
  }
  private async classement(req:Requete,user:Utilisateur):Promise<Reponse> {
    exigeRole(user,"administrateur","responsable");const moisRaw=req.requete.mois??"";const mois=moisRaw.length===7?`${moisRaw}-01`:moisRaw;validerMois(mois);
    const r=await this.pool.query(`SELECT id::text AS id,mois::text AS mois,version_regles AS "versionRegles",genere_le AS "genereLe",genere_par::text AS "generePar",classement,top5 FROM classements_mensuels WHERE mois=$1::date`,[mois]);const row=r.rows[0];const today=new Date();const generationPossible=new Date(`${mois}T00:00:00Z`).getTime()<Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),1);
    if(!row)return json(200,{mois,classement:null,top5:[],generationPossible});
    let classement=(Array.isArray(row.classement)?row.classement:[]) as ClassementMensuel["classement"];
    if(user.role==="responsable") {
      const svc=await this.pool.query(`SELECT nom FROM services WHERE id=ANY($1::uuid[])`,[user.servicesGeres]);
      const names=new Set(svc.rows.map(x=>txt(x.nom)));
      classement=classement.filter(x=>names.has(x.service)).map((x,i)=>({...x,rang:i+1}));
    }
    const top5=classement.slice(0,5);
    const snap:ClassementMensuel={id:txt(row.id),mois:txt(row.mois).slice(0,10),versionRegles:num(row.versionRegles),genereLe:new Date(String(row.genereLe)).toISOString(),generePar:txt(row.generePar),scores:[],classement,top5,audit:[{id:`audit-${txt(row.id)}`,at:new Date(String(row.genereLe)).toISOString(),acteurId:txt(row.generePar),action:"classement_mensuel_genere",detail:{agentsClasses:classement.length,versionRegles:num(row.versionRegles)}}]};
    if(req.requete.format==="csv"){
      const csv=exporterClassementMensuelCsv(snap);
      return {statut:200,texte:csv.csv,typeContenu:"text/csv; charset=utf-8",entetes:{"Content-Disposition":`attachment; filename="${csv.nomFichier}"`}};
    }
    return json(200,{mois,classement:snap,top5:snap.top5,generationPossible:false});
  }

  private async historique(req:Requete,user:Utilisateur){
    if(!user.agentId) throw new ErreurRegime("non_autorise","Ce compte n’est pas associé à un agent.");const date=valideDate(req.requete.date??dateDakar(new Date()),"Date");let debut=date,fin=date;
    if(req.requete.type==="semaine"){const d=parseCle(date);const wd=new Date(Date.UTC(d.year,d.month-1,d.day)).getUTCDay()||7;const start=new Date(Date.UTC(d.year,d.month-1,d.day-(wd-1)));const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);debut=start.toISOString().slice(0,10);fin=end.toISOString().slice(0,10);}else if(req.requete.type==="mois"){debut=`${date.slice(0,7)}-01`;const d=new Date(`${debut}T00:00:00Z`);d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(d.getUTCDate()-1);fin=d.toISOString().slice(0,10);}else if(req.requete.type!==undefined&&req.requete.type!=="jour") throw new ErreurRegime("requete_invalide","Type de période invalide.");
    const r=await this.pool.query(`SELECT a.prenom AS agent_prenom,a.nom AS agent_nom,s.nom AS service,p.regime::text AS regime,p.type_poste::text AS type_poste,p.starts_at AS prevu_debut,
      min(${tsEff("x")}) FILTER(WHERE x.type='arrivee' AND x.validation IN('accepte','valide_manuellement')) AS arrivee_reelle,
      min(${tsEff("x")}) FILTER(WHERE x.type='depart' AND x.validation IN('accepte','valide_manuellement')) AS depart_reel,
      CASE WHEN min(${tsEff("x")}) FILTER(WHERE x.type='arrivee' AND x.validation IN('accepte','valide_manuellement')) > p.starts_at + interval '${TOLERANCE_RETARD_MIN} minutes' THEN floor(extract(epoch FROM ((min(${tsEff("x")}) FILTER (WHERE x.type='arrivee' AND x.validation IN ('accepte','valide_manuellement'))) - p.starts_at)) / 60)::int ELSE 0 END AS retard_min,
      CASE WHEN bool_or(x.validation='a_verifier') THEN 'a_verifier' WHEN bool_or(x.validation='refuse') THEN 'refuse' WHEN count(*) FILTER(WHERE x.type='arrivee' AND x.validation IN('accepte','valide_manuellement'))>0 AND count(*) FILTER(WHERE x.type='depart' AND x.validation IN('accepte','valide_manuellement'))>0 THEN 'complet' WHEN now()>p.ends_at THEN 'incomplet' ELSE 'en_cours' END AS statut_presence,
      COALESCE((array_agg(x.statut_localisation::text ORDER BY x.server_ts DESC) FILTER(WHERE x.id IS NOT NULL))[1],'indisponible') AS statut_localisation,
      CASE WHEN bool_or(x.position_suspecte) THEN 'position_suspecte' WHEN bool_or(x.validation='a_verifier') THEN 'verification_manuelle' ELSE '' END AS anomalies
      FROM plannings p JOIN agents a ON a.id=p.agent_id JOIN services s ON s.id=p.service_id LEFT JOIN pointages x ON x.planning_id=p.id
      WHERE p.agent_id=$1::uuid AND p.starts_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Dakar') AND p.starts_at < (($3::date+1)::timestamp AT TIME ZONE 'Africa/Dakar') AND p.statut<>'annule'
      GROUP BY p.id,a.prenom,a.nom,s.nom,p.regime,p.type_poste,p.starts_at,p.ends_at ORDER BY p.starts_at DESC`,[user.agentId,debut,fin]);
    return {lignes:r.rows.map(x=>({...x,prevu_debut:new Date(String(x.prevu_debut)).toISOString(),arrivee_reelle:x.arrivee_reelle?new Date(String(x.arrivee_reelle)).toISOString():null,depart_reel:x.depart_reel?new Date(String(x.depart_reel)).toISOString():null}))};
  }
  /** Condition SQL commune à la liste et au compteur : une anomalie = un pointage à examiner dans les 48 dernières heures, dans le périmètre du compte. */
  private static readonly SQL_ANOMALIE = `x.server_ts >= $1::timestamptz-interval '48 hours' AND (x.validation IN('a_verifier','refuse') OR x.position_suspecte OR x.statut_localisation IN('hors_zone','precision_insuffisante')) AND ($2::boolean OR x.service_id=ANY($3::uuid[]))`;

  private async anomalies(user:Utilisateur,now:Date,statutDemande?:string){
    exigeRole(user,"administrateur","responsable");
    const filtre=statutDemande===undefined?"a_suivre":statutDemande;
    if(!["a_suivre","nouvelle","consultee","traitee","toutes"].includes(filtre)) throw new ErreurRegime("requete_invalide","Statut d’anomalie invalide.");
    const r=await this.pool.query(`SELECT x.id::text AS "pointageId",x.agent_id::text AS "agentId",a.prenom||' '||a.nom AS agent,s.nom AS service,x.validation::text AS validation,x.statut_localisation::text AS localisation,x.position_suspecte,x.motif_refus,x.server_ts AS at,x.service_id::text AS "serviceId",COALESCE(sv.statut,'nouvelle') AS statut,sv.maj_le AS "statutLe"
      FROM pointages x JOIN agents a ON a.id=x.agent_id JOIN services s ON s.id=x.service_id LEFT JOIN anomalies_suivi sv ON sv.pointage_id=x.id
      WHERE ${OperationsPostgres.SQL_ANOMALIE} AND ($4::text='toutes' OR ($4::text='a_suivre' AND COALESCE(sv.statut,'nouvelle')<>'traitee') OR COALESCE(sv.statut,'nouvelle')=$4::text) ORDER BY x.server_ts DESC LIMIT 200`,[now,user.role==="administrateur",user.servicesGeres,filtre]);
    return {anomalies:r.rows.map(x=>({pointageId:x.pointageId,agentId:x.agentId,agent:x.agent,service:x.service,gravite:x.position_suspecte||x.validation==="refuse"?"erreur":"avertissement",type:x.position_suspecte?"position_suspecte":x.validation==="a_verifier"?"verification_manuelle":x.localisation==="hors_zone"?"hors_zone":"precision_insuffisante",message:txt(x.motif_refus)||`Pointage à examiner · ${txt(x.validation)} · ${txt(x.localisation)}`,at:new Date(String(x.at)).toISOString(),statut:txt(x.statut),statutLe:x.statutLe?new Date(String(x.statutLe)).toISOString():null}))};
  }

  /**
   * Compteurs de l'en-tête, calculés dans PostgreSQL pour le seul compte connecté (jamais depuis le navigateur).
   * Règles : messages non lus = messages visibles pour ce compte, non archivés et sans ligne de lecture ;
   * anomalies nouvelles = anomalies du périmètre sans ligne de suivi ; une anomalie consultée ou traitée ne compte plus.
   */
  private async compteurs(user:Utilisateur,now:Date){
    exigeUuid(user.id,"Identifiant de session");
    const admin=user.role==="administrateur";
    const encadrement=admin||user.role==="responsable";
    // L'administrateur est l'auteur des diffusions : il n'a pas de boîte de réception.
    const messages=admin?0:num((await this.pool.query(`SELECT count(*)::int AS n FROM messages_diffusion m
      WHERE m.archive_le IS NULL AND ${sqlMessageVisiblePour("$1")}
        AND NOT EXISTS (SELECT 1 FROM messages_lectures l WHERE l.message_id=m.id AND l.user_id=$1::uuid)`,[user.id])).rows[0]?.n);
    let anomalies:{nouvelles:number;consultees:number}|null=null;
    if(encadrement){
      const r=await this.pool.query(`SELECT count(*) FILTER(WHERE sv.statut IS NULL)::int AS nouvelles,count(*) FILTER(WHERE sv.statut='consultee')::int AS consultees
        FROM pointages x LEFT JOIN anomalies_suivi sv ON sv.pointage_id=x.id WHERE ${OperationsPostgres.SQL_ANOMALIE}`,[now,admin,user.servicesGeres]);
      anomalies={nouvelles:num(r.rows[0]?.nouvelles),consultees:num(r.rows[0]?.consultees)};
    }
    return {messagesNonLus:messages,anomaliesNouvelles:anomalies?anomalies.nouvelles:null,anomaliesConsultees:anomalies?anomalies.consultees:null,source:"postgresql"};
  }

  /** Règle métier : ouvrir la liste ne change rien. « consultee » et « traitee » sont des actions explicites, auditées, limitées au périmètre du compte. */
  private async marquerAnomalie(idBrut:string,req:Requete,user:Utilisateur){
    exigeRole(user,"administrateur","responsable");
    exigeUuid(user.id,"Identifiant de session");
    const id=exigeUuid(idBrut,"Identifiant de l’anomalie");
    const statut=obj(req.corps).statut;
    if(statut!=="consultee"&&statut!=="traitee") throw new ErreurRegime("requete_invalide","Statut attendu : consultee ou traitee.");
    const p=await this.pool.query(`SELECT 1 FROM pointages x WHERE x.id=$1::uuid AND ($2::boolean OR x.service_id=ANY($3::uuid[]))`,[id,user.role==="administrateur",user.servicesGeres]);
    if(!p.rows.length) throw new ErreurRegime("introuvable","Anomalie introuvable dans votre périmètre.");
    await this.pool.query(`INSERT INTO anomalies_suivi(pointage_id,statut,maj_par) VALUES($1::uuid,$2,$3::uuid)
      ON CONFLICT (pointage_id) DO UPDATE SET statut=EXCLUDED.statut,maj_par=EXCLUDED.maj_par,maj_le=now()`,[id,statut,user.id]);
    await this.audit(user.id,"anomalie_statut","anomalies_suivi",id,{statut},"Suivi d’une anomalie de pointage",req.ip);
    return {ok:true,statut};
  }

  private async listerAbsences(req: Requete, user: Utilisateur, now: Date): Promise<Reponse> {
    exigeRole(user, "administrateur", "responsable");
    const debut = req.requete.debut ? valideDate(req.requete.debut, "Date de début") : null;
    const fin = req.requete.fin ? valideDate(req.requete.fin, "Date de fin") : null;
    if (debut && fin && fin < debut) throw new ErreurRegime("requete_invalide", "La date de fin précède la date de début.");
    const r = await this.pool.query(`
      SELECT aa.id::text AS id, aa.agent_id::text AS "agentId", aa.service_id::text AS "serviceId",
        a.prenom || ' ' || a.nom AS agent, s.nom AS service,
        to_char(aa.debut AT TIME ZONE 'Africa/Dakar', 'YYYY-MM-DD') AS debut,
        to_char(aa.fin AT TIME ZONE 'Africa/Dakar', 'YYYY-MM-DD') AS fin,
        aa.categorie, aa.statut::text AS statut, aa.note_admin AS note,
        aa.cree_par::text AS "creePar", aa.created_at AS "creeLe",
        aa.valide_par::text AS "validePar", aa.valide_le AS "valideLe", aa.motif_validation AS "motifValidation"
      FROM absences_anomalies aa
      JOIN agents a ON a.id = aa.agent_id
      LEFT JOIN services s ON s.id = aa.service_id
      WHERE ($1::date IS NULL OR (aa.fin AT TIME ZONE 'Africa/Dakar')::date >= $1::date)
        AND ($2::date IS NULL OR (aa.debut AT TIME ZONE 'Africa/Dakar')::date <= $2::date)
        AND ($3::boolean OR aa.service_id = ANY($4::uuid[]))
      ORDER BY aa.debut DESC, a.nom, a.prenom LIMIT 1000`, [debut, fin, user.role === "administrateur", user.servicesGeres]);
    const absences = r.rows.map((x) => ({
      ...x,
      creeLe: x.creeLe ? new Date(String(x.creeLe)).toISOString() : null,
      valideLe: x.valideLe ? new Date(String(x.valideLe)).toISOString() : null,
    }));
    const format = req.requete.format ?? "json";
    if (format === "csv") {
      const colonnes = [
        { cle: "agent", titre: "Agent" }, { cle: "service", titre: "Service" },
        { cle: "debut", titre: "Début" }, { cle: "fin", titre: "Fin" },
        { cle: "categorie", titre: "Catégorie" }, { cle: "statut", titre: "Statut" },
        { cle: "note", titre: "Note administrative" }, { cle: "creeLe", titre: "Enregistrée le" },
        { cle: "valideLe", titre: "Décidée le" }, { cle: "motifValidation", titre: "Motif de décision" },
      ];
      const csv = versCsvLocal(colonnes, absences as unknown as Record<string, unknown>[]);
      return { statut: 200, texte: csv, typeContenu: "text/csv; charset=utf-8", entetes: { "Content-Disposition": `attachment; filename="absences-${now.toISOString().slice(0, 10)}.csv"` } };
    }
    if (format !== "json") throw new ErreurRegime("requete_invalide", "Format attendu : json ou csv.");
    return json(200, { absences, categories: ["absence", "congé", "autorisation", "autre"], source: "postgresql", fictif: false, note: "Évitez d’inscrire un diagnostic médical dans les notes." });
  }

  private async creerAbsence(req: Requete, user: Utilisateur) {
    exigeRole(user, "administrateur", "responsable");
    const c = obj(req.corps);
    const agentId = exigeUuid(c.agentId, "Agent");
    const debut = valideDate(c.debut, "Début de l’absence");
    const fin = valideDate(c.fin, "Fin de l’absence");
    if (fin < debut) throw new ErreurRegime("requete_invalide", "La fin de l’absence précède son début.");
    const categories = new Set(["absence", "congé", "autorisation", "autre"]);
    const categorie = typeof c.categorie === "string" ? c.categorie.trim() : "";
    if (!categories.has(categorie)) throw new ErreurRegime("requete_invalide", "Choisissez une catégorie valide.");
    const note = typeof c.note === "string" ? c.note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500) : "";
    const a = await this.pool.query(`
      SELECT a.id::text AS id, af.service_id::text AS "serviceId"
      FROM agents a JOIN LATERAL (
        SELECT service_id FROM agent_affectations
        WHERE agent_id=a.id AND date_debut <= $2::date AND (date_fin IS NULL OR date_fin > $2::date)
        ORDER BY date_debut DESC LIMIT 1
      ) af ON true
      JOIN services s ON s.id=af.service_id AND s.actif
      WHERE a.id=$1::uuid AND a.actif`, [agentId, debut]);
    const agent = a.rows[0];
    if (!agent) throw new ErreurRegime("introuvable", "Agent actif avec affectation valide à cette date introuvable.");
    const serviceId = txt(agent.serviceId);
    if (user.role === "responsable" && !user.servicesGeres.includes(serviceId)) throw new ErreurRegime("non_autorise", "Agent hors de votre périmètre de service.");
    const cl = await this.pool.connect(); let tx = false;
    try {
      await cl.query("BEGIN"); tx = true;
      const inserted = await cl.query(`
        INSERT INTO absences_anomalies (agent_id, service_id, debut, fin, categorie, note_admin, statut, valide_par, valide_le, motif_validation, impact_score, cree_par)
        VALUES ($1::uuid, $2::uuid, ($3::date::timestamp AT TIME ZONE 'Africa/Dakar'), ((($4::date + 1)::timestamp AT TIME ZONE 'Africa/Dakar') - interval '1 microsecond'), $5, $6, 'a_confirmer', NULL, NULL, NULL, false, $7::uuid)
        RETURNING id::text AS id, created_at AS "creeLe"`, [agentId, serviceId, debut, fin, categorie, note || null, user.id]);
      const row = inserted.rows[0];
      if (!row?.id) throw new Error("PostgreSQL n'a pas renvoyé l'identifiant d'absence.");
      await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,nouvelle_valeur,motif,ip)
        VALUES($1::uuid,'absence_enregistree_a_confirmer','absences_anomalies',$2,$3::jsonb,$4,$5)`, [user.id, txt(row.id), JSON.stringify({ agentId, serviceId, debut, fin, categorie, statut: "a_confirmer" }), "Absence créée à confirmer ; aucun impact de score avant décision", req.ip]);
      await cl.query("COMMIT"); tx = false;
      return { succes: true, absence: { id: txt(row.id), agentId, serviceId, debut, fin, categorie, note: note || null, statut: "a_confirmer", creePar: user.id, creeLe: new Date(String(row.creeLe)).toISOString(), validePar: null, valideLe: null, motifValidation: null }, message: "Absence enregistrée à confirmer. Elle n’impacte pas encore le classement." };
    } catch (e) {
      if (tx) await cl.query("ROLLBACK").catch(() => {});
      if (e instanceof ErreurRegime) throw e;
      if (pgCode(e)) mapSqlErreur(e);
      throw e;
    } finally { cl.release(); }
  }

  private async deciderAbsence(id: string, req: Requete, user: Utilisateur, now: Date) {
    exigeRole(user, "administrateur", "responsable");
    const c = obj(req.corps);
    const statut = c.statut;
    if (statut !== "justifiee" && statut !== "injustifiee" && statut !== "refusee") throw new ErreurRegime("requete_invalide", "Décision attendue : justifiee, injustifiee ou refusee.");
    const motif = typeof c.motif === "string" ? c.motif.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500) : "";
    if (motif.length < 4) throw new ErreurRegime("requete_invalide", "Un motif d’au moins 4 caractères est obligatoire.");
    const cl = await this.pool.connect(); let tx = false;
    try {
      await cl.query("BEGIN"); tx = true;
      const found = await cl.query(`SELECT id::text AS id, agent_id::text AS "agentId", service_id::text AS "serviceId", statut::text AS statut, note_admin AS note,
          to_char(debut AT TIME ZONE 'Africa/Dakar','YYYY-MM-DD') AS debut, to_char(fin AT TIME ZONE 'Africa/Dakar','YYYY-MM-DD') AS fin, categorie, cree_par::text AS "creePar", created_at AS "creeLe"
        FROM absences_anomalies WHERE id=$1::uuid FOR UPDATE`, [id]);
      const old = found.rows[0];
      if (!old) throw new ErreurRegime("introuvable", "Absence introuvable.");
      if (user.role === "responsable" && !user.servicesGeres.includes(txt(old.serviceId))) throw new ErreurRegime("non_autorise", "Absence hors de votre périmètre.");
      if (old.statut !== "a_confirmer") throw new ErreurRegime("conflit", "Cette absence a déjà fait l’objet d’une décision ; aucune réécriture n’est autorisée.");
      const updated = await cl.query(`UPDATE absences_anomalies SET statut=$2::statut_absence, valide_par=$3::uuid, valide_le=$4, motif_validation=$5, impact_score=($2::statut_absence='injustifiee'::statut_absence)
        WHERE id=$1::uuid AND statut='a_confirmer'
        RETURNING statut::text AS statut, valide_par::text AS "validePar", valide_le AS "valideLe", motif_validation AS "motifValidation"`, [id, statut, user.id, now, motif]);
      if (!updated.rows[0]) throw new ErreurRegime("conflit", "L’absence a été décidée simultanément par un autre utilisateur.");
      await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,ancienne_valeur,nouvelle_valeur,motif,ip)
        VALUES($1::uuid,'absence_decidee','absences_anomalies',$2,$3::jsonb,$4::jsonb,$5,$6)`, [user.id, id, JSON.stringify({ statut: old.statut }), JSON.stringify({ statut, validePar: user.id, impactScore: statut === "injustifiee" }), motif, req.ip]);
      await cl.query("COMMIT"); tx = false;
      return { succes: true, message: `Absence marquée « ${statut} ».`, absence: { ...old, ...updated.rows[0], valideLe: updated.rows[0].valideLe ? new Date(String(updated.rows[0].valideLe)).toISOString() : null, creeLe: old.creeLe ? new Date(String(old.creeLe)).toISOString() : null } };
    } catch (e) {
      if (tx) await cl.query("ROLLBACK").catch(() => {});
      if (e instanceof ErreurRegime) throw e;
      if (pgCode(e)) mapSqlErreur(e);
      throw e;
    } finally { cl.release(); }
  }

  /** Feuilles d'émargement hebdomadaires par service (aperçu JSON ou classeur .xlsx en base64), lues dans PostgreSQL. */
  private async emargement(req: Requete, user: Utilisateur, now: Date): Promise<Reponse> {
    exigeRole(user, "administrateur", "responsable");
    const dateQ = req.requete.date || dateDakar(now);
    let lundi: string;
    try { lundi = lundiDeLaSemaine(dateQ); }
    catch (e) { throw new ErreurRegime("requete_invalide", e instanceof Error ? e.message : "Date invalide."); }
    const debut = `${lundi}T00:00:00.000Z`; // Africa/Dakar = UTC+0 toute l'année
    const fin = new Date(new Date(debut).getTime() + 7 * 86_400_000).toISOString();
    const perimetre = user.role === "responsable" ? user.servicesGeres : null;
    const [agentsR, servicesR, postesR] = await Promise.all([
      this.pool.query(`SELECT a.id::text AS id, a.prenom, a.nom, a.actif, af.service_id::text AS "serviceId", af.regime::text AS regime
        FROM agents a JOIN LATERAL (SELECT service_id, regime FROM agent_affectations WHERE agent_id=a.id AND date_debut <= $1::date AND (date_fin IS NULL OR date_fin > $1::date) ORDER BY date_debut DESC LIMIT 1) af ON true
        WHERE a.actif ORDER BY a.nom, a.prenom`, [lundi]),
      this.pool.query(`SELECT id::text AS id, nom FROM services WHERE actif ORDER BY nom`),
      this.pool.query(`SELECT p.agent_id::text AS "agentId", p.starts_at AS debut, p.ends_at AS fin, p.regime::text AS regime, p.type_poste::text AS type
        FROM plannings p WHERE p.statut <> 'annule' AND p.starts_at >= $1::timestamptz AND p.starts_at < $2::timestamptz`, [debut, fin]),
    ]);
    const visible = (serviceId: string) => !perimetre || perimetre.includes(serviceId);
    const agents = agentsR.rows.filter((a) => visible(txt(a.serviceId))).map((a) => ({ id: txt(a.id), prenom: txt(a.prenom), nom: txt(a.nom), serviceId: txt(a.serviceId), regime: txt(a.regime), actif: a.actif === true }));
    const ids = new Set(agents.map((a) => a.id));
    const services = servicesR.rows.filter((s) => visible(txt(s.id))).map((s) => ({ id: txt(s.id), nom: txt(s.nom) }));
    const postes = postesR.rows.filter((p) => ids.has(txt(p.agentId))).map((p) => ({ agentId: txt(p.agentId), debut: new Date(String(p.debut)), fin: new Date(String(p.fin)), regime: txt(p.regime), type: txt(p.type) }));
    const emargement = construireEmargement({ dateDansLaSemaine: lundi, agents, services, postes });
    return reponseEmargement(emargement, req.requete);
  }

  private async rapports(req: Requete, user: Utilisateur, now: Date): Promise<Reponse> {
    const typeRaw = req.requete.type ?? "jour";
    if (typeRaw !== "jour" && typeRaw !== "semaine" && typeRaw !== "mois") throw new ErreurRegime("requete_invalide", "Type : jour, semaine ou mois.");
    const type = typeRaw as TypeRapport;
    const date = req.requete.date ? valideDate(req.requete.date, "Date") : dateDakar(now);
    const periode = periodePour(type, date);
    const valeurs: unknown[] = [periode.debut, periode.fin, now];
    const conditions: string[] = ["p.starts_at >= $1::timestamptz", "p.starts_at < $2::timestamptz", "p.statut <> 'annule'"];
    if (user.role === "brancardier") {
      if (!user.agentId) throw new ErreurRegime("non_autorise", "Compte sans fiche agent.");
      valeurs.push(user.agentId); conditions.push(`p.agent_id=$${valeurs.length}::uuid`);
    } else if (user.role === "responsable") {
      valeurs.push(user.servicesGeres); conditions.push(`p.service_id=ANY($${valeurs.length}::uuid[])`);
    }
    if (req.requete.service) {
      const serviceId = exigeUuid(req.requete.service, "Service");
      valeurs.push(serviceId); conditions.push(`p.service_id=$${valeurs.length}::uuid`);
    }
    if (req.requete.agent) {
      const agentId = exigeUuid(req.requete.agent, "Agent");
      valeurs.push(agentId); conditions.push(`p.agent_id=$${valeurs.length}::uuid`);
    }
    if (req.requete.regime) {
      if (!regimeValide(req.requete.regime)) throw new ErreurRegime("requete_invalide", "Régime inconnu.");
      valeurs.push(req.requete.regime); conditions.push(`p.regime=$${valeurs.length}::regime_code`);
    }
    if (req.requete.validation) {
      const vals = ["accepte", "refuse", "a_verifier", "valide_manuellement"];
      if (!vals.includes(req.requete.validation)) throw new ErreurRegime("requete_invalide", "Statut de validation inconnu.");
      valeurs.push(req.requete.validation); conditions.push(`EXISTS (SELECT 1 FROM pointages fx WHERE fx.planning_id=p.id AND fx.validation=$${valeurs.length}::validation_pointage)`);
    }
    if (req.requete.statutLocalisation) {
      const vals = ["dans_zone", "hors_zone", "precision_insuffisante", "indisponible", "refusee", "ancienne", "suspecte", "zone_inactive", "zone_inconnue"];
      if (!vals.includes(req.requete.statutLocalisation)) throw new ErreurRegime("requete_invalide", "Statut de localisation inconnu.");
      valeurs.push(req.requete.statutLocalisation); conditions.push(`EXISTS (SELECT 1 FROM pointages fx WHERE fx.planning_id=p.id AND fx.statut_localisation=$${valeurs.length}::statut_loc)`);
    }
    const r = await this.pool.query(`
      WITH postes AS (
        SELECT p.id, p.agent_id, p.service_id, p.regime::text AS regime, p.type_poste::text AS type_poste,
          p.starts_at, p.ends_at, a.nom AS agent_nom, a.prenom AS agent_prenom, a.matricule, s.nom AS service
        FROM plannings p JOIN agents a ON a.id=p.agent_id JOIN services s ON s.id=p.service_id
        WHERE ${conditions.join(" AND ")}
      ), mesures AS (
        SELECT p.*,
          min(${tsEff("x")}) FILTER (WHERE x.type='arrivee' AND x.validation IN ('accepte','valide_manuellement')) AS arrivee,
          min(${tsEff("x")}) FILTER (WHERE x.type='depart' AND x.validation IN ('accepte','valide_manuellement')) AS depart,
          bool_or(x.validation='a_verifier') AS a_verifier, bool_or(x.validation='refuse') AS refuse,
          bool_or(x.position_suspecte) AS position_suspecte,
          bool_or(x.validation='valide_manuellement') AS validation_manuelle,
          string_agg(x.motif_validation_manuelle, ' | ') FILTER (WHERE x.motif_validation_manuelle IS NOT NULL) AS motif_validation_manuelle,
          (array_agg(x.statut_localisation::text ORDER BY x.server_ts ASC) FILTER (WHERE x.id IS NOT NULL))[1] AS statut_localisation,
          (array_agg(x.distance_m ORDER BY x.server_ts ASC) FILTER (WHERE x.id IS NOT NULL))[1] AS distance_m,
          (array_agg(x.precision_m ORDER BY x.server_ts ASC) FILTER (WHERE x.id IS NOT NULL))[1] AS precision_m,
          (array_agg(x.latitude ORDER BY x.server_ts ASC) FILTER (WHERE x.id IS NOT NULL))[1] AS latitude,
          (array_agg(x.longitude ORDER BY x.server_ts ASC) FILTER (WHERE x.id IS NOT NULL))[1] AS longitude
        FROM postes p LEFT JOIN pointages x ON x.planning_id=p.id
        GROUP BY p.id,p.agent_id,p.service_id,p.regime,p.type_poste,p.starts_at,p.ends_at,p.agent_nom,p.agent_prenom,p.matricule,p.service
      )
      SELECT m.*,
        CASE WHEN m.arrivee IS NOT NULL AND m.arrivee > m.starts_at + interval '${TOLERANCE_RETARD_MIN} minutes' THEN floor(extract(epoch FROM (m.arrivee-m.starts_at))/60)::int ELSE 0 END AS retard_min,
        CASE WHEN m.depart IS NOT NULL AND m.depart < m.ends_at - interval '5 minutes' THEN floor(extract(epoch FROM (m.ends_at-m.depart))/60)::int ELSE 0 END AS depart_anticipe_min,
        CASE WHEN m.arrivee IS NOT NULL AND m.depart IS NOT NULL AND m.depart >= m.arrivee THEN floor(extract(epoch FROM (m.depart-m.arrivee))/60)::int ELSE NULL END AS duree_reelle_min,
        CASE WHEN COALESCE(m.refuse,false) THEN 'refuse' WHEN COALESCE(m.a_verifier,false) OR COALESCE(m.position_suspecte,false) THEN 'a_verifier'
          WHEN m.arrivee IS NOT NULL AND m.depart IS NOT NULL THEN 'complet'
          WHEN $3::timestamptz > m.ends_at AND m.arrivee IS NULL THEN 'absent_a_confirmer'
          WHEN $3::timestamptz > m.ends_at AND m.arrivee IS NOT NULL THEN 'incomplet' ELSE 'en_cours' END AS statut_presence
      FROM mesures m ORDER BY m.starts_at,m.agent_nom,m.agent_prenom`, valeurs);
    const lignes: LigneRapport[] = r.rows.map((x) => {
      const arrivee = x.arrivee ? new Date(String(x.arrivee)) : null;
      const depart = x.depart ? new Date(String(x.depart)) : null;
      const debut = new Date(String(x.starts_at)); const fin = new Date(String(x.ends_at));
      const localisation = txt(x.statut_localisation);
      const retard = num(x.retard_min); const anticip = num(x.depart_anticipe_min);
      const anomalies: string[] = [];
      if (x.statut_presence === "absent_a_confirmer") anomalies.push("absence_a_confirmer");
      if (x.statut_presence === "incomplet") anomalies.push("pointage_incomplet");
      if (retard > 0) anomalies.push("retard");
      if (anticip > 0) anomalies.push("depart_anticipe");
      if (localisation === "hors_zone") anomalies.push("hors_zone");
      if (localisation === "precision_insuffisante") anomalies.push("precision_insuffisante");
      if (x.position_suspecte === true) anomalies.push("position_suspecte");
      return {
        agentId: txt(x.agent_id), agent_nom: txt(x.agent_nom), agent_prenom: txt(x.agent_prenom), matricule: x.matricule == null ? null : txt(x.matricule),
        service: txt(x.service), regime: txt(x.regime), type_poste: txt(x.type_poste), prevu_debut: dakarLocal(debut), prevu_fin: dakarLocal(fin),
        arrivee_reelle: dakarLocal(arrivee), depart_reel: dakarLocal(depart), duree_reelle_min: x.duree_reelle_min == null ? null : num(x.duree_reelle_min),
        retard_min: retard, depart_anticipe_min: anticip, statut_presence: txt(x.statut_presence), statut_localisation: localisation,
        distance_m: x.distance_m == null ? null : num(x.distance_m), precision_m: x.precision_m == null ? null : num(x.precision_m),
        latitude: user.role === "administrateur" && x.latitude != null ? num(x.latitude) : null,
        longitude: user.role === "administrateur" && x.longitude != null ? num(x.longitude) : null,
        anomalies: anomalies.join(", "), validation_manuelle: x.validation_manuelle === true ? "oui" : "non", motif_validation_manuelle: user.role === "brancardier" ? "" : txt(x.motif_validation_manuelle),
      };
    });
    // Synthèse calculée exclusivement à partir des lignes déjà filtrées et autorisées.
    const groupe = new Map<string, LigneRapport[]>();
    for (const l of lignes) {
      const k = JSON.stringify([l.agentId, l.service, l.regime]);
      const old = groupe.get(k) ?? []; old.push(l); groupe.set(k, old);
    }
    const synthese: SyntheseAgent[] = [...groupe.entries()].map(([k, l]) => {
      const [agentId, service, regime] = JSON.parse(k) as [string, string, string];
      const premier = l[0];
      const count = (fn: (x: LigneRapport) => boolean) => l.filter(fn).length;
      const postesBruts = r.rows.filter((x) => txt(x.agent_id) === agentId);
      const repos = postesBruts.flatMap((x) => {
        const p: Poste = { posteId: txt(x.id), regime: txt(x.regime) as Regime, type: txt(x.type_poste) as TypePoste, debut: new Date(String(x.starts_at)), fin: new Date(String(x.ends_at)) };
        if (p.regime === "garde" && p.type === "garde") return [garde.periodeRepos(p)];
        if (p.regime === "urgences" && (p.type === "jour" || p.type === "nuit")) return [urgences.periodeReposPrevue(p)];
        if (p.regime === "mobil" && p.type === "nuit") return [mobil.periodeReposNuitMobil(p)];
        return [];
      }).filter((p) => p.fin > periode.debut && p.debut < periode.fin);
      return {
        agentId, agent: `${premier.agent_prenom} ${premier.agent_nom}`, service, regime,
        postes_service: count(x => x.type_poste === "service"), postes_jour: count(x => x.type_poste === "jour"), postes_nuit: count(x => x.type_poste === "nuit"), gardes: count(x => x.type_poste === "garde"),
        retards: count(x => x.retard_min > 0), retard_total_min: l.reduce((s,x)=>s+x.retard_min,0), absences_a_confirmer: count(x => x.anomalies.includes("absence_a_confirmer")),
        pointages_incomplets: count(x => x.anomalies.includes("pointage_incomplet")), departs_anticipes: count(x => x.depart_anticipe_min > 0),
        pointages_hors_zone: count(x => x.anomalies.includes("hors_zone")), validations_manuelles: count(x => x.validation_manuelle === "oui"),
        duree_totale_min: l.reduce((s,x)=>s+(x.duree_reelle_min??0),0), repos_prevus: repos.map((p) => `${dakarLocal(p.debut)} -> ${dakarLocal(p.fin)}`).join(" | "),
      };
    });
    const rapport: Rapport = { periode, genereLe: now.toISOString(), lignes, synthese, notes: [
      "Un poste est rattaché à la période de son début (un poste de nuit appartient au jour où il commence).",
      "Les lignes sont calculées depuis les plannings et pointages enregistrés dans PostgreSQL.",
      "Le score et le classement mensuel sont calculés séparément à partir des pointages.",
      "Une absence à confirmer n’impacte pas le classement ; seules les décisions injustifiées validées sont prises en compte.",
    ] };
    const format = req.requete.format ?? "json";
    if (format === "csv" || format === "synthese-csv") {
      if (user.role === "brancardier" && format === "synthese-csv") throw new ErreurRegime("non_autorise", "Synthèse réservée aux responsables.");
      const out = exporterCsv(rapport, { id: user.id, role: user.role, servicesGeres: user.servicesGeres, agentId: user.agentId ?? undefined }, format === "csv" ? "lignes" : "synthese");
      return { statut: 200, texte: out.csv, typeContenu: "text/csv; charset=utf-8", entetes: { "Content-Disposition": `attachment; filename="${out.nomFichier}"` } };
    }
    if (format !== "json") throw new ErreurRegime("requete_invalide", "Format attendu : json, csv ou synthese-csv.");
    return json(200, user.role === "brancardier" ? { ...rapport, synthese: undefined } : rapport);
  }
}
