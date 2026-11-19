import { test } from "node:test";
import assert from "node:assert/strict";
import { optionsPoolPostgres } from "./pool-postgres.ts";

test("pool PostgreSQL : limites par défaut explicites et bornées", () => {
  assert.deepEqual(optionsPoolPostgres({}, "fann-pointage-test"), {
    max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    statement_timeout: 60000, idle_in_transaction_session_timeout: 15000,
    lock_timeout: 5000, application_name: "fann-pointage-test",
  });
});

test("pool PostgreSQL : paramètres réglables pour un VPS plus puissant", () => {
  const p = optionsPoolPostgres({ PG_POOL_MAX: "16", PG_STATEMENT_TIMEOUT_MS: "90000", PG_IDLE_TX_TIMEOUT_MS: "20000", PG_LOCK_TIMEOUT_MS: "2500" }, "fann-prod");
  assert.equal(p.max, 16);
  assert.equal(p.statement_timeout, 90000);
  assert.equal(p.idle_in_transaction_session_timeout, 20000);
  assert.equal(p.lock_timeout, 2500);
});

test("pool PostgreSQL : refuse les valeurs hors limites et les noms ambigus", () => {
  for (const env of [{ PG_POOL_MAX: "0" }, { PG_POOL_MAX: "51" }, { PG_STATEMENT_TIMEOUT_MS: "0" }, { PG_IDLE_TX_TIMEOUT_MS: "999999" }, { PG_LOCK_TIMEOUT_MS: "abc" }]) {
    assert.throws(() => optionsPoolPostgres(env, "fann-test"));
  }
  assert.throws(() => optionsPoolPostgres({}, "nom avec espaces"));
});
