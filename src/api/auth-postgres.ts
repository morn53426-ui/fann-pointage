// Dépôt PostgreSQL des comptes utilisé par les routes HTTP en mode postgres-catalogue.
// Les fonctions métier encore non migrées restent explicitement refusées par le routeur.
import { randomInt, randomUUID } from "node:crypto";
import { hashMotDePasseAsync } from "./auth.ts";
import { ALPHABET_CODE_PROVISOIRE, LONGUEUR_CODE_PROVISOIRE, afficherCodeProvisoire } from "./mot-de-passe.ts";
import { motDePasseDepuisTelephone } from "./mot-de-passe.ts";
import type { ClientPg, PoolPg, ResultatPg } from "../pointage/postgres.ts";
import type { Utilisateur } from "./magasin.ts";

export type RoleCompte = Utilisateur["role"];
export interface NouveauComptePersistant {
  identifiant: string;
  hash: string;
  role: RoleCompte;
  agentId: string | null;
  servicesGeres?: string[];
  /** Mot de passe provisoire : l'utilisateur devra le remplacer à sa première connexion. */
  doitChangerMotDePasse?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_SCRYPT = /^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/;
const identifiantNormalise = (s: string): string => s.trim().toLowerCase();

const SELECT_COMPTE = `
  SELECT p.user_id::text AS id, c.identifiant, c.mot_de_passe_hash AS hash,
         p.role::text AS role, p.agent_id::text AS "agentId", p.actif,
         c.session_version AS "sessionVersion", c.doit_changer_mot_de_passe AS "doitChangerMotDePasse", c.provisoire_depuis AS "provisoireDepuis",
         COALESCE(array_agg(DISTINCT rs.service_id::text) FILTER (WHERE rs.service_id IS NOT NULL), ARRAY[]::text[]) AS "servicesGeres"
  FROM profiles p
  JOIN identifiants_application c ON c.user_id = p.user_id
  LEFT JOIN responsable_services rs ON rs.user_id = p.user_id
`;

function texte(v: unknown): string { return String(v ?? ""); }
function versUtilisateur(l: Record<string, unknown>): Utilisateur {
  const role = texte(l.role);
  if (!["administrateur", "responsable", "brancardier"].includes(role)) throw new Error("Rôle de compte PostgreSQL inconnu.");
  const services = Array.isArray(l.servicesGeres) ? l.servicesGeres.filter((x): x is string => typeof x === "string") : [];
  return {
    id: texte(l.id), identifiant: texte(l.identifiant), hash: texte(l.hash),
    role: role as RoleCompte, agentId: l.agentId === null || l.agentId === undefined ? null : texte(l.agentId),
    actif: l.actif === true, sessionVersion: Number(l.sessionVersion ?? 0), servicesGeres: services,
    doitChangerMotDePasse: l.doitChangerMotDePasse === true,
    provisoireDepuis: l.provisoireDepuis instanceof Date ? l.provisoireDepuis : null,
  };
}
function lireUn(r: ResultatPg): Utilisateur | null { return r.rows[0] ? versUtilisateur(r.rows[0]) : null; }

function validerNouveauCompte(c: NouveauComptePersistant): { identifiant: string; services: string[] } {
  if (typeof c.identifiant !== "string") throw new Error("Identifiant invalide.");
  const identifiant = identifiantNormalise(c.identifiant);
  if (identifiant.length < 3 || identifiant.length > 80 || /[\u0000-\u001f\u007f]/.test(identifiant)) throw new Error("L’identifiant doit contenir entre 3 et 80 caractères valides.");
  if (!HASH_SCRYPT.test(c.hash)) throw new Error("Le mot de passe doit être fourni sous forme de hash scrypt valide.");
  if (!["administrateur", "responsable", "brancardier"].includes(c.role)) throw new Error("Rôle de compte invalide.");
  if (c.agentId !== null && !UUID.test(c.agentId)) throw new Error("Identifiant agent PostgreSQL invalide.");
  if (c.role === "brancardier" && !c.agentId) throw new Error("Un compte brancardier doit être lié à une fiche agent.");
  const services = [...new Set(c.servicesGeres ?? [])];
  if (services.some((id) => !UUID.test(id))) throw new Error("Identifiant service PostgreSQL invalide.");
  if (c.role === "responsable" && services.length === 0) throw new Error("Un responsable doit gérer au moins un service.");
  if (c.role !== "responsable" && services.length > 0) throw new Error("Seul un responsable peut recevoir des services gérés.");
  return { identifiant, services };
}

/**
 * Mode du mot de passe provisoire des agents (variable FANN_MDP_PROVISOIRE) :
 * - « aleatoire » (DÉFAUT depuis la v32, audit v31 F-02) : code de 8 caractères généré par le serveur, montré UNE fois à l'administrateur
 *   et remis séparément du badge ;
 * - « telephone » : le numéro de téléphone, chiffres seuls. Prévisible (le téléphone figure sur le badge) : réservé à une démonstration
 *   et à activer explicitement ; refusé au démarrage quand FANN_ENV=production (voir verifierModeProvisoireProduction).
 * Toute valeur inconnue retombe sur le mode sûr « aleatoire ».
 */
export const modeProvisoire = (): "telephone" | "aleatoire" => (process.env.FANN_MDP_PROVISOIRE?.trim() === "telephone" ? "telephone" : "aleatoire");

/** Refuse de démarrer en production avec un mot de passe provisoire prévisible ou une valeur de configuration inconnue. */
export function verifierModeProvisoireProduction(env: Record<string, string | undefined>): void {
  if ((env.FANN_ENV ?? "").trim().toLowerCase() !== "production") return;
  const valeur = (env.FANN_MDP_PROVISOIRE ?? "").trim();
  if (valeur !== "" && valeur !== "aleatoire") {
    throw new Error("FANN_ENV=production : FANN_MDP_PROVISOIRE doit être « aleatoire » (ou absent). Le mode « telephone » est prévisible et interdit en production.");
  }
}
export function genererCodeProvisoire(): string {
  let code = "";
  for (let i = 0; i < LONGUEUR_CODE_PROVISOIRE; i += 1) code += ALPHABET_CODE_PROVISOIRE[randomInt(ALPHABET_CODE_PROVISOIRE.length)];
  return code;
}

/**
 * Résultat de la création automatique d'un compte agent. Le mot de passe n'y figure QUE en mode « aleatoire », une seule fois,
 * pour être affiché à l'administrateur ; il n'est ni stocké en clair, ni journalisé.
 */
export type ResultatCompteAgent =
  | { cree: true; identifiant: string; motDePasseProvisoire?: string }
  | { cree: false; raison: "deja_existant" | "matricule_absent" | "matricule_trop_court" | "telephone_absent" | "identifiant_deja_utilise" | "agent_inactif" };

/**
 * Crée, dans la transaction de l'appelant, le compte d'un agent : identifiant = matricule, mot de passe provisoire = téléphone
 * (chiffres seuls), changement obligatoire à la première connexion. Ne lève pas d'erreur métier : retourne la raison d'un refus.
 * Un SAVEPOINT isole un éventuel conflit d'unicité pour ne pas annuler la transaction de l'appelant.
 */
export async function creerCompteAgentDansTransaction(
  client: Pick<ClientPg, "query">,
  agent: { id: string; matricule: string | null; telephone: string | null; actif: boolean },
  acteurId: string | null,
  ip: string,
): Promise<ResultatCompteAgent> {
  if (!agent.actif) return { cree: false, raison: "agent_inactif" };
  const matricule = (agent.matricule ?? "").trim();
  if (!matricule) return { cree: false, raison: "matricule_absent" };
  const identifiant = identifiantNormalise(matricule);
  if (identifiant.length < 3 || identifiant.length > 80 || /[\u0000-\u001f\u007f]/.test(identifiant)) return { cree: false, raison: "matricule_trop_court" };
  const aleatoire = modeProvisoire() === "aleatoire";
  const mdp = aleatoire ? genererCodeProvisoire() : motDePasseDepuisTelephone(agent.telephone);
  if (mdp === null) return { cree: false, raison: "telephone_absent" };
  const lie = await client.query(`SELECT user_id FROM profiles WHERE agent_id = $1::uuid FOR UPDATE`, [agent.id]);
  if (lie.rows[0]) return { cree: false, raison: "deja_existant" };
  const pris = await client.query(`SELECT 1 FROM identifiants_application WHERE lower(identifiant) = $1`, [identifiant]);
  if (pris.rows[0]) return { cree: false, raison: "identifiant_deja_utilise" };
  const id = randomUUID();
  await client.query("SAVEPOINT compte_agent");
  try {
    await client.query(`INSERT INTO profiles (user_id, role, agent_id, actif) VALUES ($1::uuid, 'brancardier'::role_code, $2::uuid, true)`, [id, agent.id]);
    await client.query(`INSERT INTO identifiants_application (user_id, identifiant, mot_de_passe_hash, doit_changer_mot_de_passe) VALUES ($1::uuid, $2, $3, true)`, [id, identifiant, await hashMotDePasseAsync(mdp)]);
    await client.query(`INSERT INTO journal_audit (user_id, action, objet_table, objet_id, nouvelle_valeur, motif, ip) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7)`, [
      acteurId, "compte_agent_cree_automatiquement", "identifiants_application", id,
      JSON.stringify({ role: "brancardier", agentLie: true, motDePasseProvisoire: true }),
      aleatoire ? "Compte agent créé automatiquement (matricule + code provisoire aléatoire), changement de mot de passe obligatoire" : "Compte agent créé automatiquement (matricule + téléphone), changement de mot de passe obligatoire", ip.slice(0, 45),
    ]);
    await client.query("RELEASE SAVEPOINT compte_agent");
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT compte_agent");
    const pg = e as { code?: unknown };
    if (pg.code === "23505") return { cree: false, raison: "identifiant_deja_utilise" };
    throw e;
  }
  return aleatoire ? { cree: true, identifiant, motDePasseProvisoire: afficherCodeProvisoire(mdp) } : { cree: true, identifiant };
}

async function chargerParId(q: Pick<PoolPg, "query"> | Pick<ClientPg, "query">, id: string): Promise<Utilisateur | null> {
  const r = await q.query(`${SELECT_COMPTE} WHERE p.user_id = $1::uuid GROUP BY p.user_id, c.user_id`, [id]);
  return lireUn(r);
}

export class DepotAuthentificationPostgres {
  private readonly pool: PoolPg;

  constructor(pool: PoolPg) { this.pool = pool; }

  async parIdentifiant(identifiant: string): Promise<Utilisateur | null> {
    if (typeof identifiant !== "string" || identifiant.length > 160) return null;
    const r = await this.pool.query(`${SELECT_COMPTE} WHERE lower(btrim(c.identifiant)) = $1 GROUP BY p.user_id, c.user_id`, [identifiantNormalise(identifiant)]);
    return lireUn(r);
  }

  async parId(id: string): Promise<Utilisateur | null> {
    if (!UUID.test(id)) return null;
    return chargerParId(this.pool, id);
  }

  /** Comptes persistants, triés, sans jamais exposer leurs empreintes dans la réponse API. */
  async lister(): Promise<Utilisateur[]> {
    const r = await this.pool.query(`${SELECT_COMPTE} GROUP BY p.user_id, c.user_id ORDER BY lower(c.identifiant), p.user_id`);
    return r.rows.map(versUtilisateur);
  }

  /** Services autorisés pour l'écran d'identité; aucune donnée du magasin démo n'est consultée. */
  async servicesVisibles(utilisateur: Utilisateur): Promise<{ id: string; nom: string }[]> {
    let r: ResultatPg;
    if (utilisateur.role === "administrateur") {
      r = await this.pool.query(`SELECT id::text AS id, nom FROM services WHERE actif ORDER BY nom`);
    } else if (utilisateur.role === "responsable") {
      r = await this.pool.query(`
        SELECT s.id::text AS id, s.nom
        FROM services s JOIN responsable_services rs ON rs.service_id = s.id
        WHERE rs.user_id = $1::uuid AND s.actif ORDER BY s.nom`, [utilisateur.id]);
    } else if (utilisateur.agentId) {
      r = await this.pool.query(`
        SELECT DISTINCT s.id::text AS id, s.nom
        FROM services s JOIN agent_affectations aa ON aa.service_id = s.id
        WHERE aa.agent_id = $1::uuid AND s.actif
          AND aa.date_debut <= (now() AT TIME ZONE 'Africa/Dakar')::date
          AND (aa.date_fin IS NULL OR aa.date_fin > (now() AT TIME ZONE 'Africa/Dakar')::date)
        ORDER BY s.nom`, [utilisateur.agentId]);
    } else {
      r = { rows: [], rowCount: 0 };
    }
    return r.rows.map((l) => ({ id: texte(l.id), nom: texte(l.nom) }));
  }

  /** Crée profil, identifiant et rattachements dans une seule transaction. */
  async creer(c: NouveauComptePersistant, acteurId: string | null = null, ip = ""): Promise<Utilisateur> {
    const valide = validerNouveauCompte(c);
    if (acteurId !== null && !UUID.test(acteurId)) throw new Error("Acteur d’audit invalide.");
    const client = await this.pool.connect();
    const id = randomUUID();
    let ouverte = false;
    try {
      await client.query("BEGIN"); ouverte = true;
      if (c.role === "brancardier" && c.agentId) {
        const agent = await client.query(`SELECT id FROM agents WHERE id = $1::uuid AND actif FOR UPDATE`, [c.agentId]);
        if (!agent.rows[0]) throw new Error("Sélectionnez une fiche agent active.");
        const lie = await client.query(`SELECT user_id FROM profiles WHERE agent_id = $1::uuid FOR UPDATE`, [c.agentId]);
        if (lie.rows[0]) throw new Error("Cet agent est déjà associé à un compte.");
      }
      if (valide.services.length) {
        const servicesActifs = await client.query(`SELECT id::text AS id FROM services WHERE actif AND id = ANY($1::uuid[]) FOR SHARE`, [valide.services]);
        if (servicesActifs.rows.length !== valide.services.length) throw new Error("Un ou plusieurs services sont inconnus ou désactivés.");
      }
      await client.query(`INSERT INTO profiles (user_id, role, agent_id, actif) VALUES ($1::uuid, $2::role_code, $3::uuid, true)`, [id, c.role, c.agentId]);
      await client.query(`INSERT INTO identifiants_application (user_id, identifiant, mot_de_passe_hash, doit_changer_mot_de_passe) VALUES ($1::uuid, $2, $3, $4)`, [id, valide.identifiant, c.hash, c.doitChangerMotDePasse === true]);
      if (valide.services.length) {
        await client.query(`INSERT INTO responsable_services (user_id, service_id) SELECT $1::uuid, v::uuid FROM unnest($2::text[]) AS v`, [id, valide.services]);
      }
      await client.query(`INSERT INTO journal_audit (user_id, action, objet_table, objet_id, nouvelle_valeur, motif, ip) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7)`, [
        acteurId, "compte_application_cree", "identifiants_application", id,
        JSON.stringify({ role: c.role, agentLie: c.agentId !== null, nombreServicesGeres: valide.services.length }),
        "Création d’un compte par l’administration", ip,
      ]);
      const compte = await chargerParId(client, id);
      if (!compte) throw new Error("Compte créé mais impossible à relire dans la transaction.");
      await client.query("COMMIT"); ouverte = false;
      return compte;
    } catch (e) {
      if (ouverte) { try { await client.query("ROLLBACK"); } catch { /* conserve l’erreur principale */ } }
      const pg = e as { code?: unknown; constraint?: unknown };
      if (pg.code === "23505" && String(pg.constraint ?? "").includes("identifiant_normalise")) throw new Error("Cet identifiant est déjà utilisé.");
      if (pg.code === "23505") throw new Error("Un élément du compte existe déjà.");
      throw e;
    } finally { client.release(); }
  }

  /** Invalide tous les jetons émis avant ce changement de mot de passe. Le hash n'est jamais copié dans l'audit. */
  async changerMotDePasse(id: string, hash: string, acteurId: string | null = null, ip = ""): Promise<boolean> {
    if (!UUID.test(id)) return false;
    if (!HASH_SCRYPT.test(hash)) throw new Error("Hash scrypt invalide.");
    const client = await this.pool.connect();
    let ouverte = false;
    try {
      await client.query("BEGIN"); ouverte = true;
      const r = await client.query(`UPDATE identifiants_application SET mot_de_passe_hash = $2, doit_changer_mot_de_passe = false, session_version = session_version + 1, updated_at = now() WHERE user_id = $1::uuid RETURNING user_id`, [id, hash]);
      if ((r.rowCount ?? r.rows.length) !== 1) { await client.query("ROLLBACK"); ouverte = false; return false; }
      await client.query(`INSERT INTO journal_audit (user_id, action, objet_table, objet_id, nouvelle_valeur, motif, ip) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7)`, [acteurId, "mot_de_passe_modifie", "identifiants_application", id, JSON.stringify({ sessionsRevoquees: true }), "Réinitialisation du mot de passe", ip]);
      await client.query("COMMIT"); ouverte = false;
      return true;
    } catch (e) {
      if (ouverte) { try { await client.query("ROLLBACK"); } catch { /* conserve l’erreur principale */ } }
      throw e;
    } finally { client.release(); }
  }

  /**
   * Changement du mot de passe par l'utilisateur lui-même (après vérification de l'ancien par l'appelant).
   * Révoque toutes les sessions, efface le drapeau « mot de passe provisoire » et retourne la nouvelle version de session
   * (null si le compte est introuvable ou désactivé) pour que l'appelant émette un jeton valide.
   */
  async changerMotDePassePropre(id: string, hash: string, ip = ""): Promise<number | null> {
    if (!UUID.test(id)) return null;
    if (!HASH_SCRYPT.test(hash)) throw new Error("Hash scrypt invalide.");
    const client = await this.pool.connect();
    let ouverte = false;
    try {
      await client.query("BEGIN"); ouverte = true;
      const r = await client.query(`UPDATE identifiants_application c SET mot_de_passe_hash = $2, doit_changer_mot_de_passe = false, session_version = c.session_version + 1, updated_at = now()
        FROM profiles p WHERE c.user_id = $1::uuid AND p.user_id = c.user_id AND p.actif RETURNING c.session_version AS "sessionVersion"`, [id, hash]);
      if (!r.rows[0]) { await client.query("ROLLBACK"); ouverte = false; return null; }
      await client.query(`INSERT INTO journal_audit (user_id, action, objet_table, objet_id, nouvelle_valeur, motif, ip) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7)`, [id, "mot_de_passe_change_par_utilisateur", "identifiants_application", id, JSON.stringify({ sessionsRevoquees: true }), "Changement du mot de passe par l’utilisateur", ip.slice(0, 45)]);
      await client.query("COMMIT"); ouverte = false;
      return Number(r.rows[0].sessionVersion ?? 0);
    } catch (e) {
      if (ouverte) { try { await client.query("ROLLBACK"); } catch { /* conserve l’erreur principale */ } }
      throw e;
    } finally { client.release(); }
  }

  /** Révocation administrative explicite de toutes les sessions sans changer le mot de passe. */
  async revoquerSessions(id: string, acteurId: string | null = null, ip = ""): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const client = await this.pool.connect();
    let ouverte = false;
    try {
      await client.query("BEGIN"); ouverte = true;
      const r = await client.query(`UPDATE identifiants_application SET session_version = session_version + 1, updated_at = now() WHERE user_id = $1::uuid RETURNING user_id`, [id]);
      if ((r.rowCount ?? r.rows.length) !== 1) { await client.query("ROLLBACK"); ouverte = false; return false; }
      await client.query(`INSERT INTO journal_audit (user_id, action, objet_table, objet_id, nouvelle_valeur, motif, ip) VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7)`, [acteurId, "sessions_revoquees", "identifiants_application", id, JSON.stringify({ sessionsRevoquees: true }), "Révocation administrative des sessions", ip]);
      await client.query("COMMIT"); ouverte = false;
      return true;
    } catch (e) {
      if (ouverte) { try { await client.query("ROLLBACK"); } catch { /* conserve l’erreur principale */ } }
      throw e;
    } finally { client.release(); }
  }

  /** Modifie activation/mot de passe de façon atomique et révoque toutes les sessions. */
  async modifierCompte(
    id: string,
    changements: { hash?: string; actif?: boolean; doitChanger?: boolean },
    acteurId: string | null = null,
    ip = "",
  ): Promise<Utilisateur | null> {
    if (!UUID.test(id)) return null;
    if (acteurId !== null && !UUID.test(acteurId)) throw new Error("Acteur d’audit invalide.");
    if (changements.hash !== undefined && !HASH_SCRYPT.test(changements.hash)) throw new Error("Hash scrypt invalide.");
    if (changements.hash === undefined && changements.actif === undefined) throw new Error("Aucune modification demandée.");

    const client = await this.pool.connect();
    let ouverte = false;
    try {
      await client.query("BEGIN"); ouverte = true;
      // Ordre de verrouillage constant : empêche deux désactivations concurrentes de retirer le dernier administrateur.
      const adminsActifs = changements.actif === false
        ? await client.query(`SELECT user_id FROM profiles WHERE role = 'administrateur'::role_code AND actif ORDER BY user_id FOR UPDATE`)
        : null;
      const cible = await client.query(`
        SELECT p.role::text AS role, p.actif, p.agent_id::text AS "agentId"
        FROM profiles p JOIN identifiants_application c ON c.user_id = p.user_id
        WHERE p.user_id = $1::uuid FOR UPDATE OF p, c`, [id]);
      if (!cible.rows[0]) { await client.query("ROLLBACK"); ouverte = false; return null; }
      const role = texte(cible.rows[0].role);
      const etaitActif = cible.rows[0].actif === true;
      if (changements.actif === false && etaitActif && role === "administrateur" && (adminsActifs?.rows.length ?? 0) <= 1) {
        throw new Error("Impossible de désactiver le dernier compte administrateur actif.");
      }
      if (changements.actif === true && role === "brancardier") {
        const agent = await client.query(`SELECT id FROM agents WHERE id = $1::uuid AND actif FOR SHARE`, [cible.rows[0].agentId]);
        if (!agent.rows[0]) throw new Error("Impossible de réactiver ce compte : la fiche de l’agent est absente ou désactivée.");
      }
      if (changements.actif !== undefined) {
        await client.query(`UPDATE profiles SET actif = $2 WHERE user_id = $1::uuid`, [id, changements.actif]);
      }
      await client.query(`
        UPDATE identifiants_application
        SET mot_de_passe_hash = COALESCE($2, mot_de_passe_hash),
            doit_changer_mot_de_passe = CASE WHEN $2::text IS NOT NULL THEN $3::boolean ELSE doit_changer_mot_de_passe END,
            session_version = session_version + 1, updated_at = now()
        WHERE user_id = $1::uuid`, [id, changements.hash ?? null, changements.doitChanger === true]);
      const action = changements.hash !== undefined
        ? "mot_de_passe_reinitialise"
        : changements.actif === true ? "compte_application_reactive" : "compte_application_desactive";
      await client.query(`
        INSERT INTO journal_audit (user_id, action, objet_table, objet_id, ancienne_valeur, nouvelle_valeur, motif, ip)
        VALUES ($1::uuid, $2, 'profiles', $3, $4::jsonb, $5::jsonb, $6, $7)`, [
        acteurId, action, id,
        JSON.stringify({ actif: etaitActif }),
        JSON.stringify({ actif: changements.actif ?? etaitActif, motDePasseReinitialise: changements.hash !== undefined, sessionsRevoquees: true }),
        "Modification administrative du compte", ip,
      ]);
      const compte = await chargerParId(client, id);
      if (!compte) throw new Error("Compte modifié mais impossible à relire dans la transaction.");
      await client.query("COMMIT"); ouverte = false;
      return compte;
    } catch (e) {
      if (ouverte) { try { await client.query("ROLLBACK"); } catch { /* conserve l’erreur principale */ } }
      const pg = e as { code?: unknown };
      if (pg.code === "23505") throw new Error("Cette modification entre en conflit avec une contrainte de compte.");
      throw e;
    } finally { client.release(); }
  }

  /** Désactive le profil et révoque les sessions via la même transaction atomique que PATCH. */
  async desactiver(id: string, acteurId: string | null = null, ip = ""): Promise<boolean> {
    return (await this.modifierCompte(id, { actif: false }, acteurId, ip)) !== null;
  }
}
