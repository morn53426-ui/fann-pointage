// Hachage scrypt asynchrone : compatible avec les hachages existants, non bloquant, concurrence bornée.
import test from "node:test";
import assert from "node:assert/strict";
import { hashMotDePasse, verifierMotDePasse, hashMotDePasseAsync, verifierMotDePasseAsync, FileCalculs, ErreurSurcharge } from "./auth.ts";

test("hachage asynchrone : même format et compatibilité croisée avec les fonctions synchrones", async () => {
  const ancien = hashMotDePasse("Motdepasse-Ancien-1");
  assert.equal(await verifierMotDePasseAsync("Motdepasse-Ancien-1", ancien), true, "un hachage existant reste vérifiable");
  assert.equal(await verifierMotDePasseAsync("autre", ancien), false);
  const nouveau = await hashMotDePasseAsync("Motdepasse-Nouveau-2");
  assert.match(nouveau, /^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(verifierMotDePasse("Motdepasse-Nouveau-2", nouveau), true, "un hachage asynchrone reste vérifiable par l'ancienne fonction");
  assert.notEqual(nouveau, await hashMotDePasseAsync("Motdepasse-Nouveau-2"), "sel aléatoire");
  assert.equal(await verifierMotDePasseAsync("x", "format-invalide"), false);
});

test("hachage asynchrone : la boucle d'événements reste libre pendant le calcul", async () => {
  let battements = 0;
  const minuteur = setInterval(() => { battements += 1; }, 5);
  const hachage = ["a", "b", "c", "d", "e", "f"].map((m) => hashMotDePasseAsync(`mot-de-passe-${m}`));
  await Promise.all(hachage);
  clearInterval(minuteur);
  assert.ok(battements >= 3, `la boucle d'événements a continué de tourner (${battements} battements)`);
});

test("file de calculs : concurrence bornée, ordre conservé, surcharge refusée sans bloquer ceux déjà en file", async () => {
  const file = new FileCalculs(2, 2);
  let enCours = 0; let maxEnCours = 0; const ordre: number[] = [];
  const liberer: Array<() => void> = [];
  const tache = (n: number) => file.executer(async () => {
    enCours += 1; maxEnCours = Math.max(maxEnCours, enCours); ordre.push(n);
    await new Promise<void>((r) => liberer.push(r));
    enCours -= 1; return n;
  });
  const lancees = [tache(1), tache(2), tache(3), tache(4)];           // 2 actives + 2 en attente
  await assert.rejects(() => tache(5), ErreurSurcharge);              // file pleine
  await new Promise((r) => setImmediate(r));
  assert.equal(maxEnCours, 2);
  while (liberer.length) { liberer.shift()!(); await new Promise((r) => setImmediate(r)); }
  assert.deepEqual(await Promise.all(lancees), [1, 2, 3, 4]);
  assert.deepEqual(ordre, [1, 2, 3, 4]);
  assert.equal(maxEnCours, 2, "jamais plus de 2 calculs simultanés");
  assert.equal(await file.executer(async () => "libre"), "libre", "la file est de nouveau disponible");
});
