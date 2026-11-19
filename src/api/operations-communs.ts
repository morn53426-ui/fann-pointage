// Utilitaires partagés par les modules de routes métier PostgreSQL (operations-*.ts) : lecture prudente de valeurs SQL/JSON,
// contrôle de rôle et d'identifiant, et contexte minimal (pool + journal d'audit) injecté dans les modules extraits.
import { ErreurRegime } from "../shared/types.ts";
import { parseCle } from "../shared/civil.ts";
import type { PoolPg } from "../pointage/postgres.ts";
import type { Utilisateur } from "./magasin.ts";

export type Ligne = Record<string, unknown>;
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const txt = (v: unknown) => String(v ?? "");
export const num = (v: unknown) => Number(v ?? 0);
export const obj = (v: unknown): Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function exigeRole(user: Utilisateur, ...roles: Utilisateur["role"][]) { if (!roles.includes(user.role)) throw new ErreurRegime("non_autorise", "Votre rôle ne permet pas cette opération."); }
export function exigeUuid(v: unknown, nom: string): string { if (typeof v !== "string" || !uuid.test(v)) throw new ErreurRegime("requete_invalide", `${nom} invalide.`); return v; }

export const pgCode = (e: unknown) => typeof e === "object" && e !== null ? String((e as { code?: unknown }).code ?? "") : "";
export function valideDate(v: unknown, champ: string): string { if (typeof v !== "string") throw new ErreurRegime("requete_invalide", `${champ} est obligatoire.`); try { parseCle(v); } catch { throw new ErreurRegime("requete_invalide", `${champ} doit être une date réelle au format AAAA-MM-JJ.`); } return v; }
export function mapSqlErreur(e: unknown): never {
  const code = pgCode(e);
  if (code === "23505") throw new ErreurRegime("conflit", "Cette opération crée un doublon ou un élément déjà enregistré.");
  if (code === "23P01") throw new ErreurRegime("conflit", "Le planning chevauche un autre poste de cet agent.");
  if (code === "23503") throw new ErreurRegime("conflit", "Cette opération référence un agent, service ou élément inexistant ou encore utilisé.");
  if (code === "23514") throw new ErreurRegime("conflit", "Une règle métier PostgreSQL interdit cette opération. Vérifiez le régime, les horaires et l’affectation.");
  throw e;
}

/** Ce dont un module extrait d'OperationsPostgres a besoin : le pool SQL et l'écriture dans le journal d'audit. */
export interface ContexteOps {
  pool: PoolPg;
  /** Secret serveur des QR et badges (jamais exposé) et dérivation du jeton d'un badge. */
  secretQr: string;
  tokenBadge(agentId: string, version: number): string;
  audit(userId: string, action: string, table: string, id: string | null, nouvelle: unknown, motif: string | null, ip?: string | null): Promise<void>;
}
