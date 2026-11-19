/** Paramètres communs et bornés du pool PostgreSQL applicatif. */
export interface OptionsPoolPostgres {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  statement_timeout: number;
  idle_in_transaction_session_timeout: number;
  lock_timeout: number;
  application_name: string;
}

function entierBorne(env: Record<string, string | undefined>, nom: string, defaut: number, min: number, max: number): number {
  const brut = env[nom];
  const n = brut === undefined || brut.trim() === "" ? defaut : Number(brut);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${nom} doit être compris entre ${min} et ${max}.`);
  }
  return n;
}

/**
 * Limites explicites : les connexions, requêtes longues, transactions oubliées
 * et attentes de verrou ne peuvent pas croître sans borne.
 * Le nombre de connexions doit rester coordonné avec le nombre d'instances et
 * max_connections de PostgreSQL. Ne pas répliquer l'API tant que le limiteur
 * de connexion n'est pas partagé entre instances.
 */
export function optionsPoolPostgres(env: Record<string, string | undefined>, applicationName: string): OptionsPoolPostgres {
  if (!/^[a-zA-Z0-9_.-]{1,63}$/.test(applicationName)) throw new Error("application_name PostgreSQL invalide.");
  return {
    max: entierBorne(env, "PG_POOL_MAX", 10, 1, 50),
    connectionTimeoutMillis: entierBorne(env, "PG_CONNECT_TIMEOUT_MS", 5000, 1000, 30000),
    idleTimeoutMillis: entierBorne(env, "PG_IDLE_TIMEOUT_MS", 30000, 1000, 120000),
    statement_timeout: entierBorne(env, "PG_STATEMENT_TIMEOUT_MS", 60000, 1000, 300000),
    idle_in_transaction_session_timeout: entierBorne(env, "PG_IDLE_TX_TIMEOUT_MS", 15000, 1000, 120000),
    lock_timeout: entierBorne(env, "PG_LOCK_TIMEOUT_MS", 5000, 250, 30000),
    application_name: applicationName,
  };
}
