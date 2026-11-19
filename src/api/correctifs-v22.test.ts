// Correctifs v22 : expiration du mot de passe provisoire (7 jours), verrou global par compte,
// règle administrateur renforcée, cohérence du script de génération du .env VPS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { creerDemo } from "./demo.ts";
import { hashMotDePasse, LimiteurTentatives } from "./auth.ts";
import { gererRequete } from "./routes.ts";
import type { AuthentificationPersistante, Contexte, EvenementConnexion, Requete } from "./routes.ts";
import type { Utilisateur } from "./magasin.ts";
import { controlerMotDePasse, DUREE_MOT_DE_PASSE_PROVISOIRE_JOURS, provisoireExpire } from "./mot-de-passe.ts";

const T0 = new Date("2026-10-23T10:00:00.000Z");
const jours = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_USER_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";

function req(methode: string, chemin: string, corps?: unknown, jeton?: string, ip = "127.0.0.1"): Requete {
  return { methode, chemin, requete: {}, corps, entetes: { authorization: jeton ? `Bearer ${jeton}` : undefined }, ip };
}

class FauxAuth implements AuthentificationPersistante {
  users = new Map<string, Utilisateur>();
  constructor() {
    this.users.set(ADMIN_ID, { id: ADMIN_ID, identifiant: "admin", hash: hashMotDePasse("Phrase-de-passe-2026"), role: "administrateur", agentId: null, servicesGeres: [], actif: true, sessionVersion: 0 });
    this.users.set(AGENT_USER_ID, { id: AGENT_USER_ID, identifiant: "mat-4521", hash: hashMotDePasse("771234567"), role: "brancardier", agentId: AGENT_ID, servicesGeres: [], actif: true, sessionVersion: 0, doitChangerMotDePasse: true, provisoireDepuis: T0 });
  }
  async parIdentifiant(identifiant: string) { return [...this.users.values()].find((u) => u.identifiant === identifiant.trim().toLowerCase()) ?? null; }
  async parId(id: string) { return this.users.get(id) ?? null; }
  async servicesVisibles() { return []; }
  async lister(): Promise<Utilisateur[]> { return [...this.users.values()]; }
  async creer(c: { identifiant: string; hash: string; role: Utilisateur["role"]; agentId: string | null }): Promise<Utilisateur> { throw new Error("non utilisé " + c.identifiant); }
  async modifierCompte(id: string, c: { hash?: string; doitChanger?: boolean }) {
    const u = this.users.get(id); if (!u) return null;
    if (c.hash) { u.hash = c.hash; u.doitChangerMotDePasse = c.doitChanger === true; u.provisoireDepuis = c.doitChanger ? new Date(maintenant.getTime()) : null; }
    return u;
  }
  async revoquerSessions(id: string): Promise<boolean> { const u = this.users.get(id); if (!u) return false; u.sessionVersion = (u.sessionVersion ?? 0) + 1; return true; }
  async changerMotDePassePropre(id: string, hash: string): Promise<number | null> {
    const u = this.users.get(id); if (!u) return null;
    u.hash = hash; u.doitChangerMotDePasse = false; u.provisoireDepuis = null; u.sessionVersion = (u.sessionVersion ?? 0) + 1; return u.sessionVersion;
  }
}
let maintenant = T0;
function contexte(auth: FauxAuth, evenements: EvenementConnexion[] = []): Contexte {
  const { magasin } = creerDemo(T0, { motDePasse: "mot-de-passe-demo-qui-ne-doit-pas-passer" });
  maintenant = T0;
  return { magasin, limiteur: new LimiteurTentatives(), maintenant: () => maintenant, authentificationPersistante: auth, journaliserConnexion: async (e) => { evenements.push(e); } };
}

test("provisoireExpire : faux sans date ou sans mot de passe provisoire ; vrai seulement après 7 jours", () => {
  assert.equal(DUREE_MOT_DE_PASSE_PROVISOIRE_JOURS, 7);
  assert.equal(provisoireExpire({ doitChangerMotDePasse: true }, jours(30)), false, "date inconnue (comptes de démonstration)");
  assert.equal(provisoireExpire({ doitChangerMotDePasse: false, provisoireDepuis: T0 }, jours(30)), false, "mot de passe définitif");
  assert.equal(provisoireExpire({ doitChangerMotDePasse: true, provisoireDepuis: T0 }, jours(7)), false, "pile 7 jours : encore valable");
  assert.equal(provisoireExpire({ doitChangerMotDePasse: true, provisoireDepuis: T0 }, new Date(jours(7).getTime() + 1)), true);
});

test("connexion avec le mot de passe provisoire : valable 6 jours, journalisée comme première connexion", async () => {
  const evts: EvenementConnexion[] = [];
  const ctx = contexte(new FauxAuth(), evts);
  maintenant = jours(6);
  const r = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "mat-4521", motDePasse: "+221 77 123 45 67".replace("+221 ", "") }));
  assert.equal(r.statut, 200, JSON.stringify(r.corps));
  assert.equal(evts.at(-1)?.action, "connexion_provisoire_reussie");
});

test("connexion avec le mot de passe provisoire après 7 jours : 403 sans jeton, journalisée, même avec le bon mot de passe", async () => {
  const evts: EvenementConnexion[] = [];
  const ctx = contexte(new FauxAuth(), evts);
  maintenant = jours(8);
  const r = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "mat-4521", motDePasse: "771234567" }));
  assert.equal(r.statut, 403);
  assert.equal((r.corps as { erreur: string }).erreur, "mot_de_passe_provisoire_expire");
  assert.equal((r.corps as { jeton?: string }).jeton, undefined);
  assert.equal(evts.at(-1)?.action, "connexion_provisoire_expiree");
  // Mauvais mot de passe : toujours 401 (l'expiration ne révèle rien sans le bon mot de passe).
  const faux = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "mat-4521", motDePasse: "000111222" }));
  assert.equal(faux.statut, 401);
});

test("session ouverte avant l'échéance : après 7 jours, ni changement de mot de passe ni lecture ; l'administrateur peut réinitialiser, le compte redevient utilisable", async () => {
  const auth = new FauxAuth();
  const ctx = contexte(auth);
  maintenant = jours(6.9); // connexion quelques heures avant l'échéance ; la session d'un agent dure 26 h
  const l = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "mat-4521", motDePasse: "771234567" }));
  const jeton = (l.corps as { jeton: string }).jeton;
  maintenant = jours(7.1);
  const patch = await gererRequete(ctx, req("PATCH", "/api/moi", { motDePasseActuel: "771234567", nouveauMotDePasse: "Nouveau-Pass-2026" }, jeton));
  assert.equal(patch.statut, 403);
  assert.equal((patch.corps as { erreur: string }).erreur, "mot_de_passe_provisoire_expire");
  assert.equal((await gererRequete(ctx, req("GET", "/api/moi", undefined, jeton))).statut, 403);
  assert.equal((await gererRequete(ctx, req("POST", "/api/deconnexion", {}, jeton))).statut, 200, "la déconnexion reste possible");

  // Réinitialisation par l'administrateur : nouveau délai de 7 jours.
  const admin = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "Phrase-de-passe-2026" }));
  const adminJeton = (admin.corps as { jeton: string }).jeton;
  const reset = await gererRequete(ctx, req("PATCH", `/api/utilisateurs/${AGENT_USER_ID}`, { motDePasse: "654321" }, adminJeton));
  assert.equal(reset.statut, 200, JSON.stringify(reset.corps));
  const nouveau = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "mat-4521", motDePasse: "654321" }));
  assert.equal(nouveau.statut, 200, JSON.stringify(nouveau.corps));
});

test("liste des comptes (administrateur) : indique les comptes jamais activés et ceux dont le mot de passe provisoire a expiré", async () => {
  const ctx = contexte(new FauxAuth());
  maintenant = jours(10);
  const admin = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "Phrase-de-passe-2026" }));
  const liste = await gererRequete(ctx, req("GET", "/api/utilisateurs", undefined, (admin.corps as { jeton: string }).jeton));
  const agent = (liste.corps as { utilisateurs: { identifiant: string; doitChangerMotDePasse: boolean; provisoireExpire: boolean }[] }).utilisateurs.find((u) => u.identifiant === "mat-4521");
  assert.deepEqual([agent?.doitChangerMotDePasse, agent?.provisoireExpire], [true, true]);
});

test("verrou global par compte : 30 échecs répartis sur des adresses IP différentes bloquent le compte (429), les autres comptes restent ouverts", async () => {
  const ctx = contexte(new FauxAuth());
  for (let i = 0; i < 30; i++) {
    const r = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: `faux-${i}-xyz` }, undefined, `10.0.${i}.1`));
    assert.equal(r.statut, 401, `échec ${i + 1}`);
  }
  const bloque = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "Phrase-de-passe-2026" }, undefined, "10.9.9.9"));
  assert.equal(bloque.statut, 429, "même le bon mot de passe est refusé depuis une IP neuve");
  const autre = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "mat-4521", motDePasse: "771234567" }, undefined, "10.9.9.9"));
  assert.equal(autre.statut, 200, "un autre compte n'est pas touché");
  maintenant = new Date(T0.getTime() + 16 * 60_000);
  const apres = await gererRequete(ctx, req("POST", "/api/connexion", { identifiant: "admin", motDePasse: "Phrase-de-passe-2026" }, undefined, "10.9.9.9"));
  assert.equal(apres.statut, 200, "déblocage automatique après 15 minutes");
});

test("mot de passe administrateur : 9 chiffres à faible variété et mots de passe courants refusés, valeurs correctes acceptées", () => {
  for (const faible of ["000000001", "121212121", "112211221", "password1", "Administrateur", "0123456789"]) {
    assert.ok(controlerMotDePasse("administrateur", faible), `${faible} doit être refusé`);
  }
  for (const bon of ["482915307", "Phrase-de-passe-longue-2026", "7x3k9m2q4"]) {
    assert.equal(controlerMotDePasse("administrateur", bon), null, `${bon} doit être accepté`);
  }
  // Mot de passe choisi par un agent : mêmes interdits de variété.
  assert.ok(controlerMotDePasse("brancardier", "11221122", "personnel"));
  // Mot de passe provisoire posé par l'administrateur : règle inchangée (6 caractères).
  assert.equal(controlerMotDePasse("brancardier", "771234567", "provisoire"), null);
});

test("script VPS 02-generer-env.sh : exige 9 caractères pour le mot de passe administrateur, comme l'application", () => {
  const s = readFileSync(new URL("../../scripts/vps/02-generer-env.sh", import.meta.url), "utf8");
  assert.match(s, /-ge 9 \]/);
  assert.doesNotMatch(s, /-ge 6 \]/);
});
