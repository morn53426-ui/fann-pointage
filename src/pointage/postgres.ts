// Dépôt PostgreSQL transactionnel pour le moteur métier de pointage.
// Cette couche utilise une interface minimale compatible avec pg.Pool/PoolClient,
// afin que les tests unitaires n'aient pas besoin de démarrer PostgreSQL.
// Les identifiants agent/service/zone/planning attendus sont les UUID du schéma SQL.
import { ErreurRegime } from "../shared/types.ts";
import type { Regime, TypePoste } from "../shared/types.ts";
import type { ZoneLoc } from "./localisation.ts";
import { ErreurDoublon } from "./service.ts";
import type { AgentCtx, Depots, EvenementSecurite, NouveauPointage, PointageEnregistre, PostePlanifie } from "./service.ts";

type Ligne = Record<string, unknown>;
export interface ResultatPg {
  rows: Ligne[];
  rowCount?: number | null;
}
export interface QueryablePg {
  query(sql: string, valeurs?: readonly unknown[]): Promise<ResultatPg>;
}
export interface ClientPg extends QueryablePg { release(): void }
export interface PoolPg extends QueryablePg { connect(): Promise<ClientPg>; end?(): Promise<void> }

const date = (v: unknown): Date => v instanceof Date ? v : new Date(String(v));
const dateNullable = (v: unknown): Date | null => v === null || v === undefined ? null : date(v);
const nombreNullable = (v: unknown): number | null => v === null || v === undefined ? null : Number(v);
const chaineNullable = (v: unknown): string | null => v === null || v === undefined ? null : String(v);

const COLONNES_POINTAGE = `
  p.id::text AS id,
  p.agent_id::text AS "agentId",
  p.service_id::text AS "serviceId",
  p.planning_id::text AS "planningId",
  p.poste_code AS "posteId",
  p.zone_id::text AS "zoneId",
  p.type::text AS type,
  p.server_ts AS "serverTs",
  p.captured_ts AS "capturedTs",
  p.validation::text AS validation,
  p.motif_refus AS "motifRefus",
  p.idempotency_key AS "idempotencyKey",
  p.statut_localisation::text AS "statutLocalisation",
  p.latitude AS latitude,
  p.longitude AS longitude,
  p.precision_m AS "precisionM",
  p.position_collectee_le AS "positionCollecteeLe",
  p.distance_m AS "distanceM",
  p.methode_loc AS "methodeLoc",
  p.position_suspecte AS "positionSuspecte",
  p.app_version AS "appVersion",
  qt.token_hash AS "tokenHash",
  p.source AS source,
  p.valide_manuellement_par::text AS "valideManuellementPar",
  p.motif_validation_manuelle AS "motifValidationManuelle"`;

function convertirPointage(l: Ligne): PointageEnregistre {
  return {
    id: String(l.id), agentId: String(l.agentId), serviceId: String(l.serviceId),
    planningId: chaineNullable(l.planningId), posteId: chaineNullable(l.posteId), zoneId: chaineNullable(l.zoneId),
    type: l.type as PointageEnregistre["type"], serverTs: date(l.serverTs), capturedTs: dateNullable(l.capturedTs),
    validation: l.validation as PointageEnregistre["validation"], motifRefus: chaineNullable(l.motifRefus),
    idempotencyKey: String(l.idempotencyKey), statutLocalisation: l.statutLocalisation as PointageEnregistre["statutLocalisation"],
    latitude: nombreNullable(l.latitude), longitude: nombreNullable(l.longitude), precisionM: nombreNullable(l.precisionM),
    positionCollecteeLe: dateNullable(l.positionCollecteeLe), distanceM: nombreNullable(l.distanceM),
    methodeLoc: chaineNullable(l.methodeLoc), positionSuspecte: l.positionSuspecte === true,
    appVersion: chaineNullable(l.appVersion), tokenHash: chaineNullable(l.tokenHash), source: String(l.source),
    valideManuellementPar: chaineNullable(l.valideManuellementPar), motifValidationManuelle: chaineNullable(l.motifValidationManuelle),
  };
}

function estDoublonIdempotence(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const x = e as { code?: unknown; constraint?: unknown; message?: unknown };
  return x.code === "23505" && (
    String(x.constraint ?? "").includes("pointages_agent_id_idempotency_key") ||
    String(x.message ?? "").includes("pointages_agent_id_idempotency_key")
  );
}

/**
 * Implémentation durable du contrat Depots utilisé par traiterPointage.
 * L'écriture du pointage et la consommation du QR sont atomiques : la migration
 * 0011 déclenche l'insertion de qr_token_uses dans la transaction courante.
 * Le service applicatif doit rester en mode démo tant que les autres routes,
 * les profils et les plannings ne sont pas eux aussi chargés depuis PostgreSQL.
 */
export class DepotPointagePostgres implements Depots {
  private readonly pool: PoolPg;
  private readonly secret: string;
  private readonly horloge: () => Date;

  constructor(pool: PoolPg, secret: string, horloge: () => Date = () => new Date()) {
    if (secret.length < 32) throw new Error("Le secret QR PostgreSQL doit comporter au moins 32 caractères.");
    this.pool = pool;
    this.secret = secret;
    this.horloge = horloge;
  }

  maintenant(): Date { return this.horloge(); }
  secretQr(): string { return this.secret; }

  async agent(id: string): Promise<AgentCtx | null> {
    const r = await this.pool.query(`
      SELECT a.id::text AS id, a.actif, af.service_id::text AS "serviceId", af.regime::text AS regime
      FROM agents a
      JOIN LATERAL (
        SELECT service_id, regime
        FROM agent_affectations
        WHERE agent_id = a.id
          AND date_debut <= (($2::timestamptz AT TIME ZONE 'Africa/Dakar')::date)
          AND (date_fin IS NULL OR date_fin > (($2::timestamptz AT TIME ZONE 'Africa/Dakar')::date))
        ORDER BY date_debut DESC
        LIMIT 1
      ) af ON true
      WHERE a.id = $1::uuid
      LIMIT 1`, [id, this.maintenant()]);
    const l = r.rows[0];
    return l ? { id: String(l.id), actif: l.actif === true, serviceId: String(l.serviceId), regime: l.regime as Regime } : null;
  }

  async zone(id: string): Promise<ZoneLoc | null> {
    const r = await this.pool.query(`
      SELECT id::text AS id, nom, service_id::text AS "serviceId", latitude, longitude,
             rayon_m AS "rayonM", precision_max_m AS "precisionMaxM", hors_zone_action AS "horsZoneAction", actif
      FROM zones_pointage WHERE id = $1::uuid LIMIT 1`, [id]);
    const l = r.rows[0];
    if (!l) return null;
    return {
      id: String(l.id), nom: String(l.nom), serviceId: String(l.serviceId), actif: l.actif === true,
      latitude: Number(l.latitude), longitude: Number(l.longitude), rayonM: Number(l.rayonM),
      precisionMaxM: Number(l.precisionMaxM), horsZoneAction: l.horsZoneAction === "anomalie" ? "anomalie" : "refuser",
    };
  }

  async zonesDuService(serviceId: string): Promise<ZoneLoc[]> {
    const r = await this.pool.query(`
      SELECT id::text AS id, nom, service_id::text AS "serviceId", latitude, longitude,
             rayon_m AS "rayonM", precision_max_m AS "precisionMaxM", hors_zone_action AS "horsZoneAction", actif
      FROM zones_pointage WHERE service_id = $1::uuid AND actif ORDER BY nom`, [serviceId]);
    return r.rows.map((l) => ({
      id: String(l.id), nom: String(l.nom), serviceId: String(l.serviceId), actif: l.actif === true,
      latitude: Number(l.latitude), longitude: Number(l.longitude), rayonM: Number(l.rayonM),
      precisionMaxM: Number(l.precisionMaxM), horsZoneAction: l.horsZoneAction === "anomalie" ? "anomalie" : "refuser",
    }));
  }

  async zonesActives(): Promise<ZoneLoc[]> {
    const r = await this.pool.query(`
      SELECT id::text AS id, nom, service_id::text AS "serviceId", latitude, longitude,
             rayon_m AS "rayonM", precision_max_m AS "precisionMaxM", hors_zone_action AS "horsZoneAction", actif
      FROM zones_pointage WHERE actif ORDER BY nom`);
    return r.rows.map((l) => ({
      id: String(l.id), nom: String(l.nom), serviceId: String(l.serviceId), actif: l.actif === true,
      latitude: Number(l.latitude), longitude: Number(l.longitude), rayonM: Number(l.rayonM),
      precisionMaxM: Number(l.precisionMaxM), horsZoneAction: l.horsZoneAction === "anomalie" ? "anomalie" : "refuser",
    }));
  }

  async postesAgent(agentId: string, autour: Date): Promise<PostePlanifie[]> {
    const r = await this.pool.query(`
      SELECT p.id::text AS "planningId", p.poste_id::text AS "posteId", p.regime::text AS regime,
             p.type_poste::text AS type, p.starts_at AS debut, p.ends_at AS fin
      FROM plannings p
      WHERE p.agent_id = $1::uuid AND p.statut <> 'annule'
        AND p.starts_at <= $2::timestamptz + interval '4 hours'
        AND p.ends_at >= $2::timestamptz - interval '2 hours'
      ORDER BY p.starts_at ASC`, [agentId, autour]);
    return r.rows.map((l) => ({
      planningId: String(l.planningId), posteId: String(l.posteId), regime: l.regime as Regime,
      type: l.type as TypePoste, debut: date(l.debut), fin: date(l.fin),
    }));
  }

  async pointagesDuPoste(agentId: string, posteId: string): Promise<PointageEnregistre[]> {
    const r = await this.pool.query(`
      SELECT ${COLONNES_POINTAGE}
      FROM pointages p LEFT JOIN qr_tokens qt ON qt.id = p.qr_token_id
      WHERE p.agent_id = $1::uuid AND p.poste_code = $2
      ORDER BY p.server_ts ASC`, [agentId, posteId]);
    return r.rows.map(convertirPointage);
  }

  async pointageParCle(agentId: string, cle: string): Promise<PointageEnregistre | null> {
    const r = await this.pool.query(`
      SELECT ${COLONNES_POINTAGE}
      FROM pointages p LEFT JOIN qr_tokens qt ON qt.id = p.qr_token_id
      WHERE p.agent_id = $1::uuid AND p.idempotency_key = $2
      LIMIT 1`, [agentId, cle]);
    return r.rows[0] ? convertirPointage(r.rows[0]) : null;
  }

  async qrDejaUtilise(tokenHash: string, agentId: string): Promise<boolean> {
    const r = await this.pool.query(`
      SELECT 1 AS present
      FROM qr_token_uses u JOIN qr_tokens q ON q.id = u.token_id
      WHERE q.token_hash = $1 AND u.agent_id = $2::uuid LIMIT 1`, [tokenHash, agentId]);
    return r.rows.length > 0;
  }

  async compterRefusHorsZone(agentId: string, depuis: Date): Promise<number> {
    const r = await this.pool.query(`
      SELECT count(*)::int AS total FROM pointages
      WHERE agent_id = $1::uuid AND statut_localisation = 'hors_zone' AND server_ts >= $2::timestamptz`, [agentId, depuis]);
    return Number(r.rows[0]?.total ?? 0);
  }

  async enregistrer(p: NouveauPointage): Promise<PointageEnregistre> {
    const client = await this.pool.connect();
    let transactionOuverte = false;
    try {
      await client.query("BEGIN");
      transactionOuverte = true;
      let qrTokenId: string | null = null;
      if (p.tokenHash) {
        const qr = await client.query(`
          -- Ne pas utiliser FOR SHARE ici : fann_app n'a volontairement pas le privilège UPDATE
          -- sur qr_tokens. Le trigger SECURITY DEFINER consommer_qr_au_pointage verrouille
          -- et revalide le QR dans la même transaction que l'insertion du pointage.
          SELECT id::text AS id FROM qr_tokens
          WHERE token_hash = $1 AND zone_id = $2::uuid
            AND issued_at <= $3::timestamptz AND expires_at > $3::timestamptz`, [p.tokenHash, p.zoneId, p.serverTs]);
        if (!qr.rows[0]) throw new ErreurRegime("qr_invalide", "QR absent de la base, expiré ou associé à une autre zone.");
        qrTokenId = String(qr.rows[0].id);
      }

      const inserted = await client.query(`
        INSERT INTO pointages (
          agent_id, service_id, planning_id, zone_id, type, server_ts, validation, motif_refus,
          source, idempotency_key, statut_localisation, latitude, longitude, precision_m,
          position_collectee_le, distance_m, methode_loc, position_suspecte, app_version,
          valide_manuellement_par, motif_validation_manuelle, poste_code, captured_ts, qr_token_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::pointage_type, $6::timestamptz,
          $7::validation_pointage, $8, $9, $10, $11::statut_loc, $12, $13, $14,
          $15::timestamptz, $16, $17, $18, $19, $20::uuid, $21, $22, $23::timestamptz, $24::uuid
        ) RETURNING id::text AS id`, [
          p.agentId, p.serviceId, p.planningId, p.zoneId, p.type, p.serverTs, p.validation, p.motifRefus,
          p.source, p.idempotencyKey, p.statutLocalisation, p.latitude, p.longitude, p.precisionM,
          p.positionCollecteeLe, p.distanceM, p.methodeLoc, p.positionSuspecte, p.appVersion,
          p.valideManuellementPar, p.motifValidationManuelle, p.posteId, p.capturedTs ?? null, qrTokenId,
        ]);
      const id = inserted.rows[0]?.id;
      if (typeof id !== "string") throw new Error("PostgreSQL n'a pas renvoyé l'identifiant du pointage.");
      const final = await client.query(`
        SELECT ${COLONNES_POINTAGE}
        FROM pointages p LEFT JOIN qr_tokens qt ON qt.id = p.qr_token_id
        WHERE p.id = $1::uuid LIMIT 1`, [id]);
      if (!final.rows[0]) throw new Error("Pointage inséré mais introuvable dans la transaction.");
      await client.query("COMMIT");
      transactionOuverte = false;
      return convertirPointage(final.rows[0]);
    } catch (e) {
      if (transactionOuverte) {
        try { await client.query("ROLLBACK"); } catch { /* conserve l'erreur initiale */ }
      }
      if (estDoublonIdempotence(e)) throw new ErreurDoublon();
      throw e;
    } finally {
      client.release();
    }
  }

  async journaliser(e: EvenementSecurite): Promise<void> {
    await this.pool.query(`
      INSERT INTO journal_audit (action, objet_table, objet_id, nouvelle_valeur)
      VALUES ($1, $2, $3, $4::jsonb)`, [
      e.type.slice(0, 120), "pointages", e.agentId, JSON.stringify({ at: e.at.toISOString(), ...(e.detail ?? {}) }),
    ]);
  }

  /** Une validation manuelle est limitée au statut et au motif ; les colonnes source restent immuables par trigger SQL. */
  async marquerValideManuellement(id: string, acteurId: string, motif: string): Promise<PointageEnregistre> {
    const justification = motif.trim();
    if (justification.length < 4) throw new ErreurRegime("requete_invalide", "Une justification d'au moins 4 caractères est obligatoire.");
    const r = await this.pool.query(`
      UPDATE pointages p
      SET validation = 'valide_manuellement', valide_manuellement_par = $2::uuid, motif_validation_manuelle = $3
      WHERE p.id = $1::uuid AND p.validation IN ('a_verifier', 'refuse')
      RETURNING p.id::text AS id`, [id, acteurId, justification]);
    const final = r.rows[0]?.id
      ? await this.pool.query(`SELECT ${COLONNES_POINTAGE} FROM pointages p LEFT JOIN qr_tokens qt ON qt.id = p.qr_token_id WHERE p.id = $1::uuid`, [String(r.rows[0].id)])
      : { rows: [] as Ligne[] };
    if (!final.rows[0]) throw new ErreurRegime("non_modifiable", "Pointage absent ou non modifiable.");
    return convertirPointage(final.rows[0]);
  }
}
