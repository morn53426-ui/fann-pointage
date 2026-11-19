/** Gestion de la disponibilité transitoire de PostgreSQL au démarrage.
 * Ne relance que les erreurs de transport/serveur temporairement indisponible :
 * les erreurs de schéma, de droits ou de configuration échouent immédiatement.
 */
export interface OptionsReessaisPostgres {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (nextAttempt: number, error: unknown, delayMs: number) => void;
}

const CODES_TEMPORAIRES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "53300", // too_many_connections
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "08006", // connection_failure
  "08007", // transaction_resolution_unknown
  "08030", // connection_does_not_exist
]);

export function estErreurPostgresTemporaire(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && CODES_TEMPORAIRES.has(code);
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Exécute une sonde de démarrage avec temporisation progressive bornée. */
export async function avecReessaisConnexionPostgres<T>(
  operation: () => Promise<T>,
  options: OptionsReessaisPostgres = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 30;
  const initialDelayMs = options.initialDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 2_000;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 120) {
    throw new RangeError("maxAttempts doit être compris entre 1 et 120.");
  }
  if (!Number.isInteger(initialDelayMs) || initialDelayMs < 0) {
    throw new RangeError("initialDelayMs doit être un entier positif ou nul.");
  }
  if (!Number.isInteger(maxDelayMs) || maxDelayMs < initialDelayMs) {
    throw new RangeError("maxDelayMs doit être un entier supérieur ou égal à initialDelayMs.");
  }

  const sleep = options.sleep ?? pause;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !estErreurPostgresTemporaire(error)) throw error;
      const delayMs = Math.min(initialDelayMs * 2 ** Math.min(attempt - 1, 20), maxDelayMs);
      options.onRetry?.(attempt + 1, error, delayMs);
      await sleep(delayMs);
    }
  }
}
