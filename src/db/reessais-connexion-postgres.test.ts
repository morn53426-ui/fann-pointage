import { test } from "node:test";
import assert from "node:assert/strict";
import { avecReessaisConnexionPostgres, estErreurPostgresTemporaire } from "./reessais-connexion-postgres.ts";

const erreur = (code: string) => Object.assign(new Error(`Erreur PostgreSQL de test : ${code}`), { code });

test("reconnexion PostgreSQL : retente ECONNREFUSED puis réussit", async () => {
  let appels = 0;
  const pauses: number[] = [];
  const tentatives: number[] = [];
  const resultat = await avecReessaisConnexionPostgres(async () => {
    appels += 1;
    if (appels < 3) throw erreur("ECONNREFUSED");
    return "connecté";
  }, {
    maxAttempts: 5,
    initialDelayMs: 100,
    maxDelayMs: 500,
    sleep: async (ms) => { pauses.push(ms); },
    onRetry: (nextAttempt) => tentatives.push(nextAttempt),
  });
  assert.equal(resultat, "connecté");
  assert.equal(appels, 3);
  assert.deepEqual(pauses, [100, 200]);
  assert.deepEqual(tentatives, [2, 3]);
});

test("reconnexion PostgreSQL : ne masque pas une erreur de schéma ou de droits", async () => {
  let appels = 0;
  const erreurSchema = erreur("42P01");
  await assert.rejects(() => avecReessaisConnexionPostgres(async () => {
    appels += 1;
    throw erreurSchema;
  }, { sleep: async () => { assert.fail("Aucune pause ne doit avoir lieu pour une erreur non temporaire."); } }), erreurSchema);
  assert.equal(appels, 1);
  assert.equal(estErreurPostgresTemporaire(erreur("ECONNREFUSED")), true);
  assert.equal(estErreurPostgresTemporaire(erreur("42P01")), false);
  assert.equal(estErreurPostgresTemporaire(new Error("Erreur sans code")), false);
});

test("reconnexion PostgreSQL : arrête les tentatives après la limite définie", async () => {
  let appels = 0;
  await assert.rejects(() => avecReessaisConnexionPostgres(async () => {
    appels += 1;
    throw erreur("ECONNREFUSED");
  }, { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0, sleep: async () => {} }), /ECONNREFUSED/);
  assert.equal(appels, 3);
});

test("reconnexion PostgreSQL : valide les paramètres de tentatives", async () => {
  await assert.rejects(() => avecReessaisConnexionPostgres(async () => "ok", { maxAttempts: 0 }), /maxAttempts/);
});
