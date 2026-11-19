// Mot de passe provisoire des agents : mode « aleatoire » (défaut depuis la v32) et mode « telephone » (opt-in explicite, interdit en production).
import test from "node:test";
import assert from "node:assert/strict";
import { creerCompteAgentDansTransaction, genererCodeProvisoire, modeProvisoire, verifierModeProvisoireProduction } from "./auth-postgres.ts";
import { ALPHABET_CODE_PROVISOIRE, normaliserCodeProvisoire, variantesMotDePasseProvisoire, afficherCodeProvisoire } from "./mot-de-passe.ts";
import { verifierMotDePasseAsync } from "./auth.ts";

function clientSimule() {
  const appels: { sql: string; values: readonly unknown[] }[] = [];
  return { appels, client: { query: async (sql: string, values: readonly unknown[] = []) => { appels.push({ sql, values }); return { rows: [], rowCount: 0 }; } } };
}
async function avecMode<T>(mode: string | undefined, f: () => Promise<T>): Promise<T> {
  const avant = process.env.FANN_MDP_PROVISOIRE;
  if (mode === undefined) delete process.env.FANN_MDP_PROVISOIRE; else process.env.FANN_MDP_PROVISOIRE = mode;
  try { return await f(); } finally { if (avant === undefined) delete process.env.FANN_MDP_PROVISOIRE; else process.env.FANN_MDP_PROVISOIRE = avant; }
}

test("code provisoire : 8 caractères lisibles (sans 0/O/1/I/L), différents à chaque tirage", () => {
  const codes = new Set<string>();
  for (let i = 0; i < 300; i += 1) {
    const c = genererCodeProvisoire();
    assert.match(c, /^[A-Z2-9]{8}$/);
    assert.ok([...c].every((ch) => ALPHABET_CODE_PROVISOIRE.includes(ch)));
    assert.ok(!/[01OIL]/.test(c), "aucun caractère ambigu");
    codes.add(c);
  }
  assert.ok(codes.size >= 299, "tirages indépendants");
});

test("code provisoire : saisie tolérante (tiret, espaces, minuscules) et rejet des valeurs invalides", () => {
  assert.equal(normaliserCodeProvisoire("abcd-ef23"), "ABCDEF23");
  assert.equal(normaliserCodeProvisoire(" ABCD EF23 "), "ABCDEF23");
  assert.equal(normaliserCodeProvisoire("ABCDEF2"), null, "trop court");
  assert.equal(normaliserCodeProvisoire("ABCDEF2O"), null, "caractère hors alphabet");
  assert.equal(normaliserCodeProvisoire(42), null);
  assert.equal(afficherCodeProvisoire("ABCDEF23"), "ABCD-EF23");
  assert.ok(variantesMotDePasseProvisoire("abcd-ef23").includes("ABCDEF23"));
  assert.ok(variantesMotDePasseProvisoire("77 123 45 67").includes("771234567"), "la saisie du téléphone reste prise en charge");
});

test("mode aleatoire : compte créé sans téléphone, code montré une fois, hachage valide, rien en clair ni dans l'audit", async () => {
  await avecMode("aleatoire", async () => {
    const { client, appels } = clientSimule();
    const r = await creerCompteAgentDansTransaction(client as never, { id: "11111111-1111-4111-8111-111111111111", matricule: "AB123", telephone: null, actif: true }, null, "127.0.0.1");
    assert.equal(r.cree, true);
    if (!r.cree) return;
    assert.equal(r.identifiant, "ab123");
    assert.match(r.motDePasseProvisoire ?? "", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const code = (r.motDePasseProvisoire ?? "").replace("-", "");
    const insertion = appels.find((a) => a.sql.includes("INSERT INTO identifiants_application"))!;
    const hash = String(insertion.values[2]);
    assert.equal(await verifierMotDePasseAsync(code, hash), true, "le hachage stocké correspond au code normalisé");
    assert.equal(await verifierMotDePasseAsync("771234567", hash), false);
    for (const a of appels) for (const v of a.values) assert.ok(!String(v).includes(code) && !String(v).includes(r.motDePasseProvisoire ?? "?"), "le code n'apparaît dans aucun paramètre SQL (hash excepté)");
    const audit = appels.find((a) => a.sql.includes("INSERT INTO journal_audit"))!;
    assert.ok(!JSON.stringify(audit.values).includes(code));
    assert.match(JSON.stringify(audit.values), /code provisoire aléatoire/);
  });
});

test("mode telephone : uniquement sur demande explicite ; comportement historique, aucun code retourné", async () => {
  await avecMode("telephone", async () => {
    assert.equal(modeProvisoire(), "telephone");
    const { client, appels } = clientSimule();
    const r = await creerCompteAgentDansTransaction(client as never, { id: "11111111-1111-4111-8111-111111111111", matricule: "AB123", telephone: "+221 77 123 45 67", actif: true }, null, "127.0.0.1");
    assert.deepEqual(r, { cree: true, identifiant: "ab123" });
    const hash = String(appels.find((a) => a.sql.includes("INSERT INTO identifiants_application"))!.values[2]);
    assert.equal(await verifierMotDePasseAsync("771234567", hash), true);
    const sans = await creerCompteAgentDansTransaction(clientSimule().client as never, { id: "11111111-1111-4111-8111-111111111111", matricule: "AB123", telephone: null, actif: true }, null, "127.0.0.1");
    assert.deepEqual(sans, { cree: false, raison: "telephone_absent" }, "sans téléphone : pas de compte en mode téléphone");
  });
});

test("audit v31 F-02 : le mode par défaut (variable absente, vide ou inconnue) est « aleatoire », jamais le téléphone", async () => {
  for (const mode of [undefined, "", "aleatoire", "n'importe quoi", "TELEPHONE"]) {
    await avecMode(mode, async () => {
      assert.equal(modeProvisoire(), "aleatoire", String(mode));
      const r = await creerCompteAgentDansTransaction(clientSimule().client as never, { id: "11111111-1111-4111-8111-111111111111", matricule: "AB123", telephone: "+221 77 123 45 67", actif: true }, null, "127.0.0.1");
      assert.equal(r.cree, true);
      if (r.cree) assert.match(r.motDePasseProvisoire ?? "", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/, "un code aléatoire est généré, pas le téléphone");
    });
  }
});

test("audit v31 F-02 : en production (FANN_ENV=production), le démarrage est refusé avec le mode « telephone » ou une valeur inconnue", () => {
  assert.throws(() => verifierModeProvisoireProduction({ FANN_ENV: "production", FANN_MDP_PROVISOIRE: "telephone" }), /interdit en production/);
  assert.throws(() => verifierModeProvisoireProduction({ FANN_ENV: " Production ", FANN_MDP_PROVISOIRE: "autre" }), /aleatoire/);
  assert.doesNotThrow(() => verifierModeProvisoireProduction({ FANN_ENV: "production", FANN_MDP_PROVISOIRE: "aleatoire" }));
  assert.doesNotThrow(() => verifierModeProvisoireProduction({ FANN_ENV: "production" }), "absent = mode sûr par défaut");
  assert.doesNotThrow(() => verifierModeProvisoireProduction({ FANN_MDP_PROVISOIRE: "telephone" }), "hors production : toléré (démonstration)");
});
