// Sonde préproduction : authentification et identité persistantes, routes métier bloquées.
// Ce point d'entrée ne constitue PAS le serveur de production de pointage.
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { LimiteurTentatives } from "./auth.ts";
import { creerDemo } from "./demo.ts";
import { DepotAuthentificationPostgres } from "./auth-postgres.ts";
import { lireConfigurationDemo } from "./configuration.ts";
import { creerServeur } from "./serveur.ts";
import type { ClientPg, PoolPg, ResultatPg } from "../pointage/postgres.ts";
import { optionsPoolPostgres } from "../db/pool-postgres.ts";

if ((process.env.FANN_MODE ?? "").trim().toLowerCase() !== "postgres-auth") {
  console.error("Démarrage refusé : définir FANN_MODE=postgres-auth explicitement pour lancer la sonde d'authentification.");
  process.exit(1);
}
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
const secretSession = process.env.SESSION_SECRET ?? "";
if (!databaseUrl) throw new Error("DATABASE_URL est obligatoire pour la sonde PostgreSQL.");
if (secretSession.length < 32) throw new Error("SESSION_SECRET doit contenir au moins 32 caractères aléatoires.");
if (/[\r\n]/.test(secretSession)) throw new Error("SESSION_SECRET contient des caractères interdits.");

const sslMode = process.env.PGSSL?.trim().toLowerCase();
if (sslMode && sslMode !== "require") throw new Error("PGSSL accepte uniquement 'require' ou une valeur vide.");
const pool = new Pool({
  connectionString: databaseUrl,
  ...optionsPoolPostgres(process.env, "fann-pointage-auth-probe"),
  ...(sslMode === "require" ? { ssl: { rejectUnauthorized: true } } : {}),
});

const adapter: PoolPg = {
  query: async (sql: string, values: readonly unknown[] = []): Promise<ResultatPg> => {
    const r = await pool.query(sql, [...values]);
    return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount };
  },
  connect: async (): Promise<ClientPg> => {
    const client = await pool.connect();
    return {
      query: async (sql: string, values: readonly unknown[] = []): Promise<ResultatPg> => {
        const r = await client.query(sql, [...values]);
        return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount };
      },
      release: () => client.release(),
    };
  },
  end: () => pool.end(),
};

let serveur: ReturnType<typeof creerServeur> | undefined;
try {
  await pool.query("SELECT 1 FROM identifiants_application LIMIT 0");
  await pool.query("SELECT 1 FROM profiles LIMIT 0");
  const config = lireConfigurationDemo(process.env);
  // Ce magasin in-memory ne sert qu'à satisfaire la structure historique du routeur.
  // Les routes métier sont bloquées dès qu'une session DB est utilisée.
  const { magasin } = creerDemo(new Date(), { zone: config.zone, motDePasse: process.env.DEMO_MOT_DE_PASSE });
  magasin.secretSession = secretSession;
  const auth = new DepotAuthentificationPostgres(adapter);
  const ctx = {
    magasin,
    limiteur: new LimiteurTentatives(),
    maintenant: () => new Date(),
    authentificationPersistante: auth,
  };
  const web = fileURLToPath(new URL("../../web", import.meta.url));
  serveur = creerServeur(ctx, web, { trustProxy: process.env.TRUST_PROXY === "1", mode: "postgres-auth-transition" });
  serveur.listen(config.port, config.host, () => {
    console.log(`FANN POINTAGE — sonde authentification PostgreSQL sur ${config.host}:${config.port}`);
    console.log("Comptes et identité : PostgreSQL. Routes pointage/agents/plannings : volontairement désactivées (HTTP 503).");
    console.log("Ne pas utiliser pour le pointage officiel tant que les dépôts métier ne sont pas raccordés.");
  });
} catch (e) {
  await pool.end().catch(() => {});
  throw e;
}

let fermetureEnCours = false;
const fermer = () => {
  if (fermetureEnCours) return;
  fermetureEnCours = true;
  if (!serveur) { void pool.end(); return; }
  serveur.close(() => { void pool.end(); });
};
process.once("SIGINT", fermer);
process.once("SIGTERM", fermer);
