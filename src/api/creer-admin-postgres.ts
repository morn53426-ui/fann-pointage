// Création explicite du premier compte administrateur pour la sonde de transition.
// À lancer une seule fois depuis un environnement contrôlé; aucun secret n'est imprimé.
import { Pool } from "pg";
import { hashMotDePasse } from "./auth.ts";
import { controlerMotDePasse } from "./mot-de-passe.ts";
import { DepotAuthentificationPostgres } from "./auth-postgres.ts";
import type { ClientPg, PoolPg, ResultatPg } from "../pointage/postgres.ts";

const url = process.env.DATABASE_URL?.trim() ?? "";
const identifiant = process.argv[2]?.trim() ?? "";
const motDePasse = process.env.ADMIN_INITIAL_MOT_DE_PASSE ?? "";
// --si-absent : n'échoue pas et ne modifie rien si l'identifiant existe déjà.
// --reinitialiser-mot-de-passe : change explicitement le mot de passe d'un admin existant,
// révoque ses sessions et ne crée jamais de doublon.
const options = process.argv.slice(3);
const siAbsent = options.includes("--si-absent");
const reinitialiser = options.includes("--reinitialiser-mot-de-passe");
if (siAbsent && reinitialiser) throw new Error("Choisissez une seule option : --si-absent ou --reinitialiser-mot-de-passe.");
if (options.some((x) => x !== "--si-absent" && x !== "--reinitialiser-mot-de-passe")) throw new Error("Option inconnue. Options : --si-absent, --reinitialiser-mot-de-passe.");
if (!url) throw new Error("DATABASE_URL est obligatoire.");
if (!/^[A-Za-z0-9._-]{3,80}$/.test(identifiant)) throw new Error("Usage : npm run admin:postgres -- identifiant ; lettres, chiffres, point, tiret et underscore uniquement.");
const erreurMotDePasse = controlerMotDePasse("administrateur", motDePasse, "provisoire");
if (erreurMotDePasse) throw new Error(`ADMIN_INITIAL_MOT_DE_PASSE refusé : ${erreurMotDePasse}`);
const sslMode = process.env.PGSSL?.trim().toLowerCase();
if (sslMode && sslMode !== "require") throw new Error("PGSSL accepte uniquement 'require' ou une valeur vide.");
const pg = new Pool({
  connectionString: url, max: 2, connectionTimeoutMillis: 5000,
  ...(sslMode === "require" ? { ssl: { rejectUnauthorized: true } } : {}),
  application_name: "fann-pointage-bootstrap-admin",
});
const adapter: PoolPg = {
  query: async (sql: string, values: readonly unknown[] = []): Promise<ResultatPg> => {
    const r = await pg.query(sql, [...values]);
    return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount };
  },
  connect: async (): Promise<ClientPg> => {
    const client = await pg.connect();
    return {
      query: async (sql: string, values: readonly unknown[] = []): Promise<ResultatPg> => {
        const r = await client.query(sql, [...values]);
        return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount };
      },
      release: () => client.release(),
    };
  },
  end: () => pg.end(),
};
try {
  await pg.query("SELECT 1 FROM identifiants_application LIMIT 0");
  const depot = new DepotAuthentificationPostgres(adapter);
  const existant = await depot.parIdentifiant(identifiant);
  if (reinitialiser) {
    if (!existant) throw new Error(`Le compte « ${identifiant} » n'existe pas. Créez-le d'abord sans option.`);
    if (existant.role !== "administrateur") throw new Error("Refus de réinitialiser : ce compte n'est pas administrateur.");
    if (!existant.actif) throw new Error("Ce compte administrateur est désactivé. Réactivez-le via la procédure d'administration approuvée avant de réinitialiser son mot de passe.");
    const modifie = await depot.changerMotDePasse(existant.id, hashMotDePasse(motDePasse));
    if (!modifie) throw new Error("Le compte n'a pas pu être mis à jour ; aucune confirmation de réinitialisation n'est possible.");
    console.log(`Mot de passe du compte administrateur « ${existant.identifiant} » réinitialisé ; les sessions existantes ont été révoquées.`);
    console.log("Le nouveau mot de passe est celui de ADMIN_INITIAL_MOT_DE_PASSE dans le fichier .env. Il n'a pas été affiché.");
  } else if (siAbsent && existant) {
    console.log(`Le compte « ${identifiant} » existe déjà : aucun changement (mot de passe conservé).`);
  } else {
    const compte = await depot.creer({
      identifiant,
      hash: hashMotDePasse(motDePasse),
      role: "administrateur",
      agentId: null,
    });
    console.log(`Compte administrateur créé : ${compte.identifiant} (${compte.id}).`);
    console.log("Le mot de passe n'a pas été affiché. Il doit être récupéré localement depuis ADMIN_INITIAL_MOT_DE_PASSE dans .env.");
  }
} finally {
  await pg.end();
}
