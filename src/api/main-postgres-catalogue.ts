// Serveur opérationnel PostgreSQL : registre agents/services, pointages, planning, badges, QR et classements.
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";
import { Pool } from "pg";
import { LimiteurTentatives } from "./auth.ts";
import { DepotAuthentificationPostgres, verifierModeProvisoireProduction } from "./auth-postgres.ts";
import { DepotCataloguePostgres } from "./catalogue-postgres.ts";
import { OperationsPostgres } from "./operations-postgres.ts";
import { MagasinDemo } from "./magasin.ts";
import { creerServeur } from "./serveur.ts";
import { avertissementsSecrets } from "./secrets.ts";
import type { EvenementConnexion } from "./routes.ts";
import type { ClientPg, PoolPg, ResultatPg } from "../pointage/postgres.ts";
import { avecReessaisConnexionPostgres } from "../db/reessais-connexion-postgres.ts";
import { optionsPoolPostgres } from "../db/pool-postgres.ts";

if ((process.env.FANN_MODE ?? "").trim().toLowerCase() !== "postgres-catalogue") {
  throw new Error("Démarrage refusé : FANN_MODE=postgres-catalogue est requis.");
}
verifierModeProvisoireProduction(process.env);
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const secretSession = process.env.SESSION_SECRET ?? "";
if (!databaseUrl) throw new Error("DATABASE_URL est obligatoire pour le catalogue PostgreSQL.");
if (secretSession.length < 32 || /[\r\n]/.test(secretSession) || secretSession.includes("replace_me")) throw new Error("SESSION_SECRET doit contenir au moins 32 caractères aléatoires valides.");
const secretBadge = process.env.BADGE_SECRET ?? "";
if (!/^[A-Za-z0-9_-]{32,}$/.test(secretBadge) || secretBadge.includes("replace_me")) throw new Error("BADGE_SECRET doit contenir au moins 32 caractères URL-safe et rester stable entre les redémarrages.");
for (const avertissement of avertissementsSecrets(secretSession, secretBadge)) console.warn(`AVERTISSEMENT : ${avertissement}`);
const secretQr = createHmac("sha256", secretBadge).update("FANN-POINTAGE:QR-BADGE-SYSTEM:v1").digest("hex");
const port = Number(process.env.PORT ?? "8787");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT invalide.");
const host = (process.env.HOST ?? "0.0.0.0").trim() || "0.0.0.0";
const sslMode = process.env.PGSSL?.trim().toLowerCase();
if (sslMode && sslMode !== "require") throw new Error("PGSSL accepte uniquement 'require' ou une valeur vide.");
const pool = new Pool({
  connectionString: databaseUrl,
  ...optionsPoolPostgres(process.env, "fann-pointage-operational-postgres"),
  ...(sslMode === "require" ? { ssl: { rejectUnauthorized: true } } : {}),
});
// pg-pool émet "error" lorsqu'une connexion inactive est perdue (par ex. pendant
// un redémarrage PostgreSQL). Sans listener, cet événement peut faire tomber Node.
// Le pool retire la connexion défaillante et en ouvrira une autre aux requêtes suivantes.
pool.on("error", (error: Error & { code?: string }) => {
  const code = typeof error.code === "string" ? error.code : "ERREUR_CONNEXION";
  console.error(`PostgreSQL : connexion inactive perdue (${code}). Nouvelle connexion au prochain accès.`);
});
const adapter: PoolPg = {
  query: async (sql: string, values: readonly unknown[] = []): Promise<ResultatPg> => {
    const r = await pool.query(sql, [...values]);
    return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount };
  },
  connect: async (): Promise<ClientPg> => {
    const c = await pool.connect();
    return {
      query: async (sql: string, values: readonly unknown[] = []): Promise<ResultatPg> => {
        const r = await c.query(sql, [...values]);
        return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount };
      },
      release: () => c.release(),
    };
  },
  end: () => pool.end(),
};

let serveur: ReturnType<typeof creerServeur> | undefined;
try {
  // Le service peut être démarré pendant une courte indisponibilité réseau de la base
  // (notamment lors d'un redémarrage Docker). On réessaie les sondes en lecture seule,
  // sans masquer les erreurs de schéma ou de permissions.
  const c = await avecReessaisConnexionPostgres(async () => {
    await pool.query("SELECT 1 FROM identifiants_application LIMIT 0");
    await pool.query("SELECT 1 FROM profiles LIMIT 0");
    const mig = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0013_catalogue_reel_agents_services' LIMIT 1");
    if (!mig.rows.length) throw new Error("Migration du catalogue absente. Exécutez d'abord : npm run migrate:catalogue");
    const migRuntime = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0014_runtime_operations_and_agent_photo' LIMIT 1");
    if (!migRuntime.rows.length) throw new Error("Migration opérationnelle 0014 absente. Exécutez npm run migrate:catalogue puis npm run db:configure-app-role.");
    const migAbsences = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0015_absences_rapports_postgres' LIMIT 1");
    if (!migAbsences.rows.length) throw new Error("Migration du registre des absences 0015 absente. Exécutez npm run migrate:catalogue puis npm run db:configure-app-role.");
    const migBadge = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0016_badge_profession_contact' LIMIT 1");
    if (!migBadge.rows.length) throw new Error("Migration du badge 0016 (profession, adresse, téléphone) absente. Exécutez npm run migrate:catalogue puis npm run db:configure-app-role.");
    const mobilEnum = await pool.query("SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='regime_code' AND e.enumlabel='mobil'");
    if (!mobilEnum.rows.length) throw new Error("Régime Mobil absent du type PostgreSQL. Exécutez npm run migrate:catalogue.");
    const migMobil = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0018_planning_mobil_rules' LIMIT 1");
    if (!migMobil.rows.length) throw new Error("Migration des règles de planning Mobil 0018 absente. Exécutez npm run migrate:catalogue puis npm run db:configure-app-role.");
    const migCalendrier = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0020_regles_calendrier_services' LIMIT 1");
    if (!migCalendrier.rows.length) throw new Error("Migration des règles de calendrier 0020 absente. Exécutez npm run migrate:catalogue.");
    const migMessagerie = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0021_messagerie_diffusion' LIMIT 1");
    if (!migMessagerie.rows.length) throw new Error("Migration de la messagerie 0021 absente. Exécutez npm run migrate:catalogue puis npm run db:configure-app-role.");
    const migDestinataires = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0022_messagerie_destinataires' LIMIT 1");
    if (!migDestinataires.rows.length) throw new Error("Migration des destinataires 0022 absente. Exécutez npm run migrate:catalogue puis npm run db:configure-app-role.");
    const migComptes = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0023_comptes_agents_mot_de_passe' LIMIT 1");
    if (!migComptes.rows.length) throw new Error("Migration des comptes agents 0023 absente. Exécutez npm run migrate:catalogue puis npm run db:configure-app-role.");
    const migExpiration = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0024_mot_de_passe_provisoire_expiration' LIMIT 1");
    if (!migExpiration.rows.length) throw new Error("Migration 0024 (expiration du mot de passe provisoire) absente. Exécutez npm run migrate:catalogue puis npm run db:configure-app-role.");
    const migSuivi = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0025_anomalies_suivi' LIMIT 1");
    if (!migSuivi.rows.length) throw new Error("Migration 0025 (suivi des anomalies) absente. Exécutez npm run migrate:catalogue puis npm run db:configure-app-role.");
    const migMobil24h = await pool.query("SELECT 1 FROM app_schema_migrations WHERE version='0026_mobil_gardes_24h_weekends_feries' LIMIT 1");
    if (!migMobil24h.rows.length) throw new Error("Migration 0026 (gardes Mobil de 24 h les week-ends/jours fériés) absente. Exécutez npm run migrate:catalogue puis redémarrez le service.");
    await pool.query("SELECT id, photo_data_url, profession, adresse, telephone FROM agents LIMIT 0");
    await pool.query("SELECT id, agent_id, token_hash, version, actif FROM badges_agents LIMIT 0");
    await pool.query("SELECT id, starts_at, ends_at FROM plannings LIMIT 0");
    await pool.query("SELECT id, server_ts, planning_id, qr_token_id, poste_code FROM pointages LIMIT 0");
    return pool.query("SELECT count(*)::int AS total FROM agents WHERE source_ref LIKE 'FANN-PHOTO-%'");
  }, {
    maxAttempts: 30,
    initialDelayMs: 250,
    maxDelayMs: 2_000,
    onRetry: (nextAttempt, error, delayMs) => {
      const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code : "ERREUR_CONNEXION";
      console.warn(`PostgreSQL indisponible au démarrage (${code}) ; nouvelle tentative ${nextAttempt}/30 dans ${delayMs} ms.`);
    },
  });
  const magasin = new MagasinDemo(new Date()); // magasin vide, aucune fiche démo n'est générée ni utilisée.
  magasin.secretSession = secretSession;
  const ctx = {
    magasin,
    limiteur: new LimiteurTentatives(),
    maintenant: () => new Date(),
    authentificationPersistante: new DepotAuthentificationPostgres(adapter),
    // Traçabilité des connexions : l'identifiant saisi n'est jamais enregistré (il pourrait contenir un mot de passe).
    journaliserConnexion: async (e: EvenementConnexion) => {
      await pool.query(
        "INSERT INTO journal_audit(user_id,action,objet_table,objet_id,nouvelle_valeur,motif,ip) VALUES($1::uuid,$2,'identifiants_application',$3::text,$4::jsonb,$5,$6)",
        [e.userId, e.action, e.userId, JSON.stringify({ compteConnu: e.userId !== null }), e.action === "connexion_reussie" ? "Connexion réussie" : e.action === "connexion_provisoire_reussie" ? "Première connexion avec le mot de passe provisoire" : e.action === "connexion_provisoire_expiree" ? "Connexion refusée : mot de passe provisoire expiré" : e.action === "connexion_debloquee" ? "Déblocage de connexion par l'administrateur" : "Échec de connexion", e.ip],
      );
    },
    cataloguePersistant: new DepotCataloguePostgres(adapter),
    operationsPersistantes: new OperationsPostgres(adapter, secretQr),
    modeApplication: "catalogue-postgres",
  };
  const web = fileURLToPath(new URL("../../web", import.meta.url));
  serveur = creerServeur(ctx, web, {
    trustProxy: process.env.TRUST_PROXY === "1",
    mode: "catalogue-postgres",
    checkReady: async () => {
      await pool.query("SELECT 1 FROM identifiants_application LIMIT 0");
      await pool.query("SELECT provisoire_depuis FROM identifiants_application LIMIT 0");
      const ready = await pool.query("SELECT count(*)::int AS total FROM app_schema_migrations WHERE version = ANY($1::text[])", [["0013_catalogue_reel_agents_services", "0014_runtime_operations_and_agent_photo", "0015_absences_rapports_postgres", "0016_badge_profession_contact", "0018_planning_mobil_rules", "0019_general_heure_fin", "0020_regles_calendrier_services", "0021_messagerie_diffusion", "0022_messagerie_destinataires", "0023_comptes_agents_mot_de_passe", "0024_mot_de_passe_provisoire_expiration", "0025_anomalies_suivi", "0026_mobil_gardes_24h_weekends_feries", "0027_indexes_performance_operational"]]);
      if (Number(ready.rows[0]?.total ?? 0) !== 14) throw new Error("Schéma PostgreSQL applicatif incomplet. Exécutez npm run migrate:catalogue.");
      await pool.query("SELECT id, photo_data_url, profession, adresse, telephone FROM agents LIMIT 0");
      await pool.query("SELECT id, token_hash FROM badges_agents LIMIT 0");
      await pool.query("SELECT id, qr_token_id, poste_code FROM pointages LIMIT 0");
      await pool.query("SELECT note_admin, valide_le, motif_validation, cree_par, service_id FROM absences_anomalies LIMIT 0");
      await pool.query("SELECT id, titre, contenu, auteur_user_id, cree_le FROM messages_diffusion LIMIT 0");
      await pool.query("SELECT message_id, user_id, lu_le FROM messages_lectures LIMIT 0");
      await pool.query("SELECT message_id, user_id FROM messages_destinataires LIMIT 0");
      await pool.query("SELECT message_id, service_id FROM messages_services_destinataires LIMIT 0");
      await pool.query("SELECT portee, priorite FROM messages_diffusion LIMIT 0");
      await pool.query("SELECT doit_changer_mot_de_passe FROM identifiants_application LIMIT 0");
    },
  });
  // Sans compte administrateur actif, toute connexion répond « Identifiants invalides » : on le dit clairement au démarrage.
  const admins = await pool.query("SELECT count(*)::int AS total FROM profiles WHERE role = 'administrateur' AND actif");
  const nbAdmins = Number(admins.rows[0]?.total ?? 0);
  serveur.listen(port, host, () => {
    console.log(`FANN POINTAGE — PostgreSQL connecté sur ${host}:${port}`);
    if (nbAdmins === 0) console.warn("ATTENTION : aucun compte administrateur actif. Créez-le sur la machine hôte avec : npm run admin:postgres -- admin");
    console.log(`Fiches de la liste CHNU Fann présentes : ${c.rows[0]?.total ?? 0}/54.`);
    console.log("Pointages, plannings, badges versionnés, QR dynamiques, historique, anomalies, tableau de bord et classements utilisent PostgreSQL.");
    console.log("Les badges et modifications du registre sont réservés à l’administrateur ; les responsables restent limités à leurs services.");
    console.log("Le registre des absences et les rapports SQL sont également servis depuis PostgreSQL ; ils restent à valider sur une vraie base de recette.");
  });
} catch (e) {
  await pool.end().catch(() => {});
  throw e;
}

let fermeture = false;
const fermer = () => {
  if (fermeture) return;
  fermeture = true;
  if (!serveur) { void pool.end(); return; }
  serveur.close(() => { void pool.end(); });
};
// Erreurs hors requête (promesse rejetée, exception tardive) : toujours écrites dans le journal du conteneur, jamais silencieuses.
process.on("unhandledRejection", (raison) => { console.error(`[ERREUR] promesse rejetée non gérée : ${raison instanceof Error ? `${raison.name}: ${raison.message}` : String(raison)}`.slice(0, 600)); });
process.on("uncaughtException", (erreur) => { console.error(`[ERREUR FATALE] ${erreur.name}: ${erreur.message}`.slice(0, 600)); fermer(); setTimeout(() => process.exit(1), 2000).unref(); });
process.once("SIGINT", fermer);
process.once("SIGTERM", fermer);
