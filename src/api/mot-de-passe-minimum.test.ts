import { test } from "node:test";
import assert from "node:assert/strict";
import { gererRequete } from "./routes.ts";
import type { Contexte, Reponse } from "./routes.ts";
import { creerDemo } from "./demo.ts";
import { LimiteurTentatives } from "./auth.ts";

const NOW = new Date("2026-10-12T10:00:00.000Z");
const MDP = "Securite-Tests-2026!";
const appel = (ctx: Contexte, methode: string, chemin: string, o: { corps?: unknown; jeton?: string; ip?: string } = {}): Promise<Reponse> =>
  gererRequete(ctx, { methode, chemin, requete: {}, corps: o.corps, ip: o.ip ?? "ip-mdp-minimum", entetes: { authorization: o.jeton ? `Bearer ${o.jeton}` : undefined } });

test("mot de passe : minimum 6 caractères à la création et à la réinitialisation, maximum 200", async () => {
  const { magasin } = creerDemo(NOW, { motDePasse: MDP });
  const ctx: Contexte = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => magasin.horloge };
  const connexion = await appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "admin", motDePasse: MDP } });
  assert.equal(connexion.statut, 200);
  const jeton = (connexion.corps as { jeton: string }).jeton;
  const creer = (motDePasse: string, identifiant: string) =>
    appel(ctx, "POST", "/api/utilisateurs", { jeton, corps: { identifiant, motDePasse, role: "responsable", servicesGeres: ["s-gen"] } });

  assert.equal((await creer("abcde", "chef.cinq")).statut, 400, "5 caractères refusés");
  assert.equal((await creer("x".repeat(201), "chef.long")).statut, 400, "201 caractères refusés");
  const ok = await creer("abcdef", "chef.six");
  assert.equal(ok.statut, 201, JSON.stringify(ok.corps));
  const id = (ok.corps as { utilisateur: { id: string } }).utilisateur.id;

  assert.equal((await appel(ctx, "PATCH", `/api/utilisateurs/${id}`, { jeton, corps: { motDePasse: "abcde" } })).statut, 400, "réinitialisation à 5 caractères refusée");
  assert.equal((await appel(ctx, "PATCH", `/api/utilisateurs/${id}`, { jeton, corps: { motDePasse: "uvwxyz" } })).statut, 200, "réinitialisation à 6 caractères acceptée");
  const reconnexion = await appel(ctx, "POST", "/api/connexion", { corps: { identifiant: "chef.six", motDePasse: "uvwxyz" }, ip: "ip-mdp-reco" });
  assert.equal(reconnexion.statut, 200);
});
