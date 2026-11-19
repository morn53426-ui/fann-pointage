// Messagerie persistante PostgreSQL : diffusion générale, comptes ou services ciblés, liste par destinataire, lecture et archivage.
// Extraite d'operations-postgres.ts ; même logique, mêmes requêtes SQL et mêmes droits (diffusion et archivage : administrateur seul).
import { ErreurRegime } from "../shared/types.ts";
import type { Utilisateur } from "./magasin.ts";
import type { Requete } from "./routes.ts";
import { exigeRole, exigeUuid, num, obj, txt } from "./operations-communs.ts";
import type { ContexteOps, Ligne } from "./operations-communs.ts";

/** Date civile de Dakar (UTC sans heure d'été) : jamais CURRENT_DATE, qui dépend du fuseau de la session PostgreSQL. */
const DATE_DAKAR = "(now() AT TIME ZONE 'Africa/Dakar')::date";

/**
 * Condition SQL unique « ce message (alias m) est destiné à ce compte » : diffusion générale, compte ciblé, ou service du destinataire
 * (responsable du service, ou agent affecté à ce service à la date du jour à Dakar). Utilisée par la liste, la lecture et sa vérification
 * pour qu'une modification future ne puisse pas les faire diverger. `param` est le paramètre SQL de l'identifiant du compte (ex. "$1").
 */
export function sqlMessageVisiblePour(param: string): string {
  return `(
    m.portee='tous'
    OR EXISTS (SELECT 1 FROM messages_destinataires md WHERE md.message_id=m.id AND md.user_id=${param}::uuid)
    OR EXISTS (SELECT 1 FROM messages_services_destinataires msd WHERE msd.message_id=m.id AND (
      EXISTS (SELECT 1 FROM responsable_services rs JOIN profiles rp ON rp.user_id=rs.user_id AND rp.actif
        WHERE rs.user_id=${param}::uuid AND rs.service_id=msd.service_id AND rp.role='responsable')
      OR EXISTS (SELECT 1 FROM profiles p JOIN agents a ON a.id=p.agent_id AND a.actif JOIN agent_affectations aa ON aa.agent_id=a.id
        WHERE p.user_id=${param}::uuid AND p.actif AND aa.service_id=msd.service_id
          AND aa.date_debut <= ${DATE_DAKAR} AND (aa.date_fin IS NULL OR aa.date_fin > ${DATE_DAKAR}))
    ))
  )`;
}

export async function listerDestinatairesMessages(ops: ContexteOps, user: Utilisateur) {
  exigeRole(user, "administrateur");
  const [comptes, services] = await Promise.all([
    ops.pool.query(`
      SELECT p.user_id::text AS id, p.role::text AS role,
        COALESCE(NULLIF(btrim(concat_ws(' ', a.prenom, a.nom)), ''), i.identifiant) AS nom
      FROM profiles p
      JOIN identifiants_application i ON i.user_id=p.user_id
      LEFT JOIN agents a ON a.id=p.agent_id
      WHERE p.actif AND p.role <> 'administrateur'
      ORDER BY lower(COALESCE(NULLIF(btrim(concat_ws(' ', a.prenom, a.nom)), ''), i.identifiant)), p.user_id
      LIMIT 1000`),
    ops.pool.query(`
      SELECT s.id::text AS id, s.nom
      FROM services s
      WHERE s.actif AND (
        EXISTS (SELECT 1 FROM agent_affectations aa JOIN agents a ON a.id=aa.agent_id
          JOIN profiles p ON p.agent_id=a.id AND p.actif
          WHERE aa.service_id=s.id AND a.actif AND aa.date_debut <= ${DATE_DAKAR}
            AND (aa.date_fin IS NULL OR aa.date_fin > ${DATE_DAKAR}))
        OR EXISTS (SELECT 1 FROM responsable_services rs JOIN profiles p ON p.user_id=rs.user_id AND p.actif
          WHERE rs.service_id=s.id AND p.role='responsable')
      ) ORDER BY lower(s.nom), s.id`),
  ]);
  return {
    comptes: comptes.rows.map((r) => ({ id: txt(r.id), role: txt(r.role), nom: txt(r.nom) })),
    services: services.rows.map((r) => ({ id: txt(r.id), nom: txt(r.nom) })),
  };
}

export async function listerMessages(ops: ContexteOps, user: Utilisateur, inclureArchives = false) {
  exigeUuid(user.id, "Identifiant de session");
  const admin = user.role === "administrateur";
  const archives = admin && inclureArchives;
  const r = await ops.pool.query(`
    SELECT m.id::text AS id, m.titre, m.contenu, m.cree_le AS "creeLe", m.archive_le AS "archiveLe",
      m.portee, m.priorite, c.identifiant AS auteur,
      (l.message_id IS NOT NULL) AS lu,
      (SELECT count(*)::int FROM messages_lectures ml WHERE ml.message_id=m.id) AS "nombreLectures",
      (SELECT count(*)::int FROM messages_destinataires md2 WHERE md2.message_id=m.id) AS "nombreComptesDestinataires",
      (SELECT count(*)::int FROM messages_services_destinataires msd2 WHERE msd2.message_id=m.id) AS "nombreServicesDestinataires"
    FROM messages_diffusion m
    LEFT JOIN identifiants_application c ON c.user_id=m.auteur_user_id
    LEFT JOIN messages_lectures l ON l.message_id=m.id AND l.user_id=$1::uuid
    WHERE ($3::boolean OR m.archive_le IS NULL) AND ($2::boolean OR ${sqlMessageVisiblePour("$1")})
    ORDER BY m.cree_le DESC, m.id DESC
    LIMIT 200`, [user.id, admin, archives]);
  const messages = r.rows.map((m) => ({
    id: txt(m.id), titre: txt(m.titre), contenu: txt(m.contenu),
    creeLe: m.creeLe instanceof Date ? m.creeLe.toISOString() : txt(m.creeLe),
    auteur: txt(m.auteur) || "Administration", portee: txt(m.portee || "tous"),
    priorite: txt(m.priorite || "normale"), lu: admin || m.lu === true,
    ...(admin ? {
      nombreLectures: num(m.nombreLectures), nombreComptesDestinataires: num(m.nombreComptesDestinataires), nombreServicesDestinataires: num(m.nombreServicesDestinataires),
      archive: m.archiveLe != null, ...(m.archiveLe != null ? { archiveLe: m.archiveLe instanceof Date ? m.archiveLe.toISOString() : txt(m.archiveLe) } : {}),
    } : {}),
  }));
  return { messages, nonLus: admin ? 0 : messages.filter((m) => !m.lu).length, source: "postgresql" };
}

/** Retire un message pour tous les destinataires (archivage : la ligne, les lectures et l'audit sont conservés). Administrateur uniquement. */
export async function archiverMessage(ops: ContexteOps, idBrut: string, user: Utilisateur, ip: string) {
  exigeRole(user, "administrateur");
  exigeUuid(user.id, "Identifiant de session");
  const id = exigeUuid(idBrut, "Identifiant du message");
  const r = await ops.pool.query(`UPDATE messages_diffusion SET archive_le = GREATEST(now(), cree_le) WHERE id=$1::uuid AND archive_le IS NULL RETURNING id::text AS id, titre, portee, priorite`, [id]);
  if (!r.rows[0]) {
    const existant = await ops.pool.query(`SELECT 1 FROM messages_diffusion WHERE id=$1::uuid`, [id]);
    if (!existant.rows.length) throw new ErreurRegime("introuvable", "Message introuvable.");
    return { ok: true, archive: true, dejaArchive: true, message: "Ce message était déjà retiré." };
  }
  await ops.audit(user.id, "message_archive", "messages_diffusion", txt(r.rows[0].id), { titre: txt(r.rows[0].titre), portee: txt(r.rows[0].portee), priorite: txt(r.rows[0].priorite) }, "Message retiré par l’administrateur", ip);
  return { ok: true, archive: true, dejaArchive: false, message: "Message retiré : il n’apparaît plus chez les destinataires." };
}

export async function diffuserMessage(ops: ContexteOps, req: Requete, user: Utilisateur) {
  exigeRole(user, "administrateur");
  exigeUuid(user.id, "Identifiant de session");
  const c = obj(req.corps);
  const titre = typeof c.titre === "string" ? c.titre.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  const contenu = typeof c.contenu === "string" ? c.contenu.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "";
  const portee = c.portee === undefined ? "tous" : c.portee;
  const priorite = c.priorite === undefined ? "normale" : c.priorite;
  if (titre.length < 3 || titre.length > 120) throw new ErreurRegime("requete_invalide", "Le titre doit contenir entre 3 et 120 caractères.");
  if (!contenu || contenu.length > 4000) throw new ErreurRegime("requete_invalide", "Le message est obligatoire et limité à 4 000 caractères.");
  if (portee !== "tous" && portee !== "comptes" && portee !== "services") throw new ErreurRegime("requete_invalide", "Choisissez une portée de message valide.");
  if (priorite !== "normale" && priorite !== "urgente") throw new ErreurRegime("requete_invalide", "Choisissez une priorité valide.");

  const rawComptes = c.destinataireIds === undefined ? [] : c.destinataireIds;
  const rawServices = c.serviceIds === undefined ? [] : c.serviceIds;
  if (!Array.isArray(rawComptes) || rawComptes.length > 100 || !Array.isArray(rawServices) || rawServices.length > 50)
    throw new ErreurRegime("requete_invalide", "La liste des destinataires dépasse la limite autorisée.");
  const destinataireIds = [...new Set(rawComptes.map((v) => exigeUuid(v, "Identifiant destinataire").toLowerCase()))];
  const serviceIds = [...new Set(rawServices.map((v) => exigeUuid(v, "Identifiant de service").toLowerCase()))];
  if (portee === "comptes" && destinataireIds.length === 0) throw new ErreurRegime("requete_invalide", "Sélectionnez au moins un compte destinataire.");
  if (portee === "services" && serviceIds.length === 0) throw new ErreurRegime("requete_invalide", "Sélectionnez au moins un service destinataire.");
  if (portee === "tous" && (destinataireIds.length || serviceIds.length)) throw new ErreurRegime("requete_invalide", "Les destinataires ciblés doivent être vides pour une diffusion générale.");
  if ((portee === "comptes" && serviceIds.length) || (portee === "services" && destinataireIds.length))
    throw new ErreurRegime("requete_invalide", "Le type de destinataire ne correspond pas à la portée sélectionnée.");

  const client = await ops.pool.connect();
  let transaction = false;
  let m: Ligne | undefined;
  try {
    await client.query("BEGIN"); transaction = true;
    if (portee === "comptes") {
      const valides = await client.query(`SELECT user_id::text AS id FROM profiles
        WHERE actif AND role <> 'administrateur' AND user_id = ANY($1::uuid[])`, [destinataireIds]);
      if (valides.rows.length !== destinataireIds.length) throw new ErreurRegime("requete_invalide", "Un ou plusieurs destinataires sont introuvables, inactifs ou ne peuvent pas recevoir ce message.");
    } else if (portee === "services") {
      const valides = await client.query("SELECT id::text AS id FROM services WHERE actif AND id=ANY($1::uuid[])", [serviceIds]);
      if (valides.rows.length !== serviceIds.length) throw new ErreurRegime("requete_invalide", "Un ou plusieurs services destinataires sont inactifs ou introuvables.");
    }
    const insere = await client.query(`
      INSERT INTO messages_diffusion (titre, contenu, auteur_user_id, portee, priorite)
      VALUES ($1, $2, $3::uuid, $4, $5)
      RETURNING id::text AS id, titre, contenu, cree_le AS "creeLe", portee, priorite`,
      [titre, contenu, user.id, portee, priorite]);
    m = insere.rows[0];
    if (!m) throw new Error("La création du message n'a retourné aucun identifiant.");
    if (portee === "comptes") {
      await client.query("INSERT INTO messages_destinataires(message_id,user_id) SELECT $1::uuid, unnest($2::uuid[])", [m.id, destinataireIds]);
    } else if (portee === "services") {
      await client.query("INSERT INTO messages_services_destinataires(message_id,service_id) SELECT $1::uuid, unnest($2::uuid[])", [m.id, serviceIds]);
    }
    await client.query("COMMIT"); transaction = false;
  } catch (e) {
    if (transaction) await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  if (!m) throw new Error("La création du message a échoué.");
  const porteeTexte = portee === "tous" ? "tous les comptes actifs" : portee === "comptes" ? `${destinataireIds.length} compte(s) sélectionné(s)` : `${serviceIds.length} service(s) sélectionné(s)`;
  await ops.audit(user.id, "message_diffuse", "messages_diffusion", txt(m.id), { titre, portee, priorite, nombreDestinataires: portee === "comptes" ? destinataireIds.length : portee === "services" ? serviceIds.length : null }, `Message envoyé à ${porteeTexte}`, req.ip);
  return { message: { id: txt(m.id), titre: txt(m.titre), contenu: txt(m.contenu), creeLe: m.creeLe instanceof Date ? m.creeLe.toISOString() : txt(m.creeLe), auteur: user.identifiant, portee: txt(m.portee), priorite: txt(m.priorite), lu: true }, messageInfo: `Message enregistré : ${porteeTexte}.` };
}

export async function marquerMessageLu(ops: ContexteOps, idBrut: string, user: Utilisateur) {
  exigeUuid(idBrut, "Identifiant du message");
  exigeUuid(user.id, "Identifiant de session");
  const r = await ops.pool.query(`
    INSERT INTO messages_lectures (message_id, user_id)
    SELECT m.id, $2::uuid FROM messages_diffusion m
    WHERE m.id=$1::uuid AND m.archive_le IS NULL AND ${sqlMessageVisiblePour("$2")}
    ON CONFLICT (message_id, user_id) DO NOTHING
    RETURNING message_id`, [idBrut, user.id]);
  if ((r.rowCount ?? r.rows.length) > 0) return { ok: true, lu: true };
  // Aucune ligne insérée : soit déjà lu (succès idempotent), soit message archivé ou non destiné à ce compte (introuvable).
  const existant = await ops.pool.query(`SELECT 1 FROM messages_diffusion m WHERE m.id=$1::uuid AND m.archive_le IS NULL AND ${sqlMessageVisiblePour("$2")}`, [idBrut, user.id]);
  if (!existant.rows.length) throw new ErreurRegime("introuvable", "Message introuvable ou vous n’êtes pas destinataire.");
  return { ok: true, lu: true };
}
