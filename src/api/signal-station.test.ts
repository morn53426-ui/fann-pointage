// Retour sonore, vibration et notification du poste partagé (module web/signal-station.js, testé avec un environnement simulé).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = fileURLToPath(new URL("../../web", import.meta.url));
const { creerSignalStation } = (await import(pathToFileURL(`${web}/signal-station.js`).href)) as {
  creerSignalStation: (env: unknown) => {
    sonActif(): boolean; definirSon(actif: boolean): void; preparer(): void; jouer(niveau: string): void;
    permission(): string; demanderPermission(): Promise<string>; signaler(niveau: string, titre: string, corps: string, options?: { arrierePlanSeulement?: boolean }): Promise<boolean>;
  };
};

function environnement(opts: { permission?: string; hidden?: boolean; sansServiceWorker?: boolean; audioEnPanne?: boolean; notificationEnPanne?: boolean } = {}) {
  const frequences: number[] = [];
  const vibrations: number[][] = [];
  const notifications: { titre: string; options: Record<string, unknown>; via: string }[] = [];
  const stockage = new Map<string, string>();
  class FauxAudio {
    state = "suspended"; currentTime = 0; destination = {};
    constructor() { if (opts.audioEnPanne) throw new Error("audio indisponible"); }
    resume() { this.state = "running"; return Promise.resolve(); }
    createGain() { const p = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; return { gain: p, connect() {} }; }
    createOscillator() { const o = { type: "", frequency: { value: 0 }, connect() {}, stop() {}, start() { frequences.push(o.frequency.value); } }; return o; }
  }
  class FausseNotification {
    static permission = opts.permission ?? "granted";
    static requestPermission() { FausseNotification.permission = "granted"; return Promise.resolve("granted"); }
    constructor(titre: string, options: Record<string, unknown>) { if (opts.notificationEnPanne) throw new Error("refusée"); notifications.push({ titre, options, via: "constructeur" }); }
  }
  const env = {
    AudioContext: FauxAudio, Notification: FausseNotification,
    document: { hidden: opts.hidden === true },
    localStorage: { getItem: (k: string) => stockage.get(k) ?? null, setItem: (k: string, v: string) => { stockage.set(k, v); } },
    navigator: {
      vibrate: (p: number[]) => { vibrations.push(p); return true; },
      serviceWorker: opts.sansServiceWorker ? undefined : { getRegistration: async () => ({
        showNotification: async (titre: string, options: Record<string, unknown>) => {
          if (opts.notificationEnPanne) throw new Error("refusée");
          notifications.push({ titre, options, via: "service-worker" });
        },
      }) },
    },
  };
  return { env, frequences, vibrations, notifications };
}

test("signal : aucun son avant un geste utilisateur, la vibration reste disponible", () => {
  const { env, frequences, vibrations } = environnement();
  const s = creerSignalStation(env);
  s.jouer("ok");
  assert.deepEqual(frequences, []);
  assert.deepEqual(vibrations, [[80]]);
});

test("signal : après préparation, chaque niveau a sa signature sonore distincte", () => {
  const { env, frequences } = environnement();
  const s = creerSignalStation(env);
  s.preparer();
  s.jouer("scan"); s.jouer("ok"); s.jouer("attention"); s.jouer("ko");
  assert.deepEqual(frequences, [880, 660, 880, 520, 520, 300]);
  s.jouer("inconnu");
  assert.equal(frequences.length, 6, "un niveau inconnu ne produit rien");
});

test("signal : le son désactivé est mémorisé et coupe le son sans couper la vibration", () => {
  const { env, frequences, vibrations } = environnement();
  const s = creerSignalStation(env);
  assert.equal(s.sonActif(), true);
  s.definirSon(false);
  assert.equal(creerSignalStation(env).sonActif(), false, "le choix survit au rechargement de la page");
  s.preparer(); s.jouer("ko");
  assert.deepEqual(frequences, []);
  assert.deepEqual(vibrations, [[300]]);
  s.definirSon(true); s.preparer(); s.jouer("ok");
  assert.deepEqual(frequences, [660, 880]);
});

test("signal : notification système seulement si l'autorisation est accordée", async () => {
  const refus = environnement({ permission: "default" });
  const s1 = creerSignalStation(refus.env);
  assert.equal(await s1.signaler("ok", "Pointage enregistré", "Awa Ndiaye · Arrivée"), false);
  assert.equal(refus.notifications.length, 0);
  assert.equal(s1.permission(), "default");
  assert.equal(await s1.demanderPermission(), "granted");
  assert.equal(await s1.signaler("ok", "Pointage enregistré", "Awa Ndiaye · Arrivée"), true);
  assert.equal(refus.notifications.length, 1);

  const bloque = environnement({ permission: "denied" });
  assert.equal(await creerSignalStation(bloque.env).signaler("ko", "Refusé", "x"), false);
  assert.equal(bloque.notifications.length, 0);
});

test("signal : notification via le service worker, silencieuse au premier plan et sonore en arrière-plan", async () => {
  const avant = environnement({ hidden: false });
  await creerSignalStation(avant.env).signaler("ok", "Pointage enregistré", "Awa Ndiaye · Arrivée · 08:02");
  assert.equal(avant.notifications[0].via, "service-worker");
  assert.equal(avant.notifications[0].titre, "Pointage enregistré");
  assert.equal(avant.notifications[0].options.body, "Awa Ndiaye · Arrivée · 08:02");
  assert.equal(avant.notifications[0].options.tag, "fann-pointage-station");
  assert.equal(avant.notifications[0].options.silent, true);

  const arriere = environnement({ hidden: true });
  await creerSignalStation(arriere.env).signaler("ok", "t", "c");
  assert.equal(arriere.notifications[0].options.silent, false);
});

test("signal : sans service worker, repli sur l'API Notification ; aucune panne ne remonte", async () => {
  const repli = environnement({ sansServiceWorker: true });
  assert.equal(await creerSignalStation(repli.env).signaler("attention", "t", "c"), true);
  assert.equal(repli.notifications[0].via, "constructeur");

  const panne = environnement({ notificationEnPanne: true, audioEnPanne: true });
  const s = creerSignalStation(panne.env);
  s.preparer();
  assert.doesNotThrow(() => s.jouer("ok"));
  assert.equal(await s.signaler("ok", "t", "c"), false);

  const nu = creerSignalStation({});
  assert.equal(nu.permission(), "unsupported");
  assert.equal(await nu.demanderPermission(), "unsupported");
  assert.doesNotThrow(() => { nu.preparer(); nu.jouer("ok"); });
  assert.equal(await nu.signaler("ok", "t", "c"), false);
});

test("interface : le poste partagé branche le signal sur chaque issue, le service worker gère le clic", () => {
  const app = readFileSync(`${web}/app.js`, "utf8");
  assert.match(app, /import \{ creerSignalStation \} from "\/signal-station\.js"/);
  const signaux = app.match(/signal\.signaler\(/g) ?? [];
  assert.equal(signaux.length, 4 + 2, "poste partagé : 4 issues ; pointage agent : résultat + erreur");
  assert.match(app, /signal\.jouer\("scan"\)/, "bip à la lecture caméra");
  assert.match(app, /signal\.jouer\("ko"\)/, "code non reconnu");
  assert.match(app, /signal\.preparer\(\)/, "audio débloqué par un geste");
  const sw = readFileSync(`${web}/sw.js`, "utf8");
  assert.match(sw, /"\/signal-station\.js"/);
  assert.match(sw, /notificationclick/);
  assert.doesNotMatch(readFileSync(`${web}/signal-station.js`, "utf8"), /innerHTML|\beval\(/);
});

test("interface : l'écran de pointage du téléphone de l'agent émet bip, vibration et notification", () => {
  const app = readFileSync(`${web}/app.js`, "utf8");
  const debut = app.indexOf("function vuePointage(");
  const fin = app.indexOf("function lirePosition(");
  assert.ok(debut > 0 && fin > debut);
  const vue = app.slice(debut, fin);
  assert.match(vue, /signal\.jouer\("scan"\)/, "bip + vibration au scan caméra");
  assert.match(vue, /signal\.preparer\(\)/, "audio débloqué par un geste");
  assert.equal((vue.match(/signal\.signaler\(/g) ?? []).length, 2, "résultat du serveur et erreur réseau/refus");
  assert.match(vue, /signal\.jouer\("ko"\)/, "saisie manquante");
  assert.match(vue, /id: "son-pointage"/, "réglage du son");
  assert.match(vue, /signal\.demanderPermission\(\)/, "activation des notifications");
  assert.equal((vue.match(/arrierePlanSeulement: true/g) ?? []).length, 2, "notification seulement en arrière-plan");
});

test("signal : option arrière-plan seulement — pas de notification au premier plan, bip et vibration conservés", async () => {
  const avant = environnement({ hidden: false });
  const s1 = creerSignalStation(avant.env);
  s1.preparer();
  assert.equal(await s1.signaler("ok", "t", "c", { arrierePlanSeulement: true }), false);
  assert.equal(avant.notifications.length, 0);
  assert.deepEqual(avant.frequences, [660, 880]);
  assert.deepEqual(avant.vibrations, [[80]]);

  const arriere = environnement({ hidden: true });
  const s2 = creerSignalStation(arriere.env);
  assert.equal(await s2.signaler("ok", "t", "c", { arrierePlanSeulement: true }), true);
  assert.equal(arriere.notifications.length, 1);

  const station = environnement({ hidden: false });
  assert.equal(await creerSignalStation(station.env).signaler("ok", "t", "c"), true, "le poste partagé garde son comportement");
});
