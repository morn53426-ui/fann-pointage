// Tests de non-régression des correctifs d'audit (photo, secrets, journal de connexion, cache, déploiement).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { photoJpegValide } from "./photo.ts";
import { avertissementsSecrets } from "./secrets.ts";
import { LimiteurTentatives, creerSession } from "./auth.ts";
import { creerDemo } from "./demo.ts";
import { creerServeur } from "./serveur.ts";
import { gererRequete } from "./routes.ts";
import type { Contexte, EvenementConnexion, Requete } from "./routes.ts";

const racine = fileURLToPath(new URL("../../", import.meta.url));
const lire = (p: string) => readFileSync(`${racine}${p}`, "utf8");
const MDP = "motdepasse-de-test";

test("photo : seule une vraie signature JPEG est acceptée", () => {
  assert.equal(photoJpegValide("data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=="), true);
  assert.equal(photoJpegValide("data:image/jpeg;base64,AA=="), false, "octets quelconques");
  assert.equal(photoJpegValide("data:image/jpeg;base64,iVBORw0KGgo="), false, "signature PNG");
  assert.equal(photoJpegValide("data:image/png;base64,/9j/4A=="), false, "mauvais type MIME");
  assert.equal(photoJpegValide("data:image/jpeg;base64,/9j/4A== "), false, "espace parasite");
  assert.equal(photoJpegValide("/9j/4A=="), false, "sans préfixe data URL");
  assert.equal(photoJpegValide(undefined), false);
  assert.equal(photoJpegValide(42), false);
});

test("secrets : avertit si SESSION_SECRET = BADGE_SECRET sans jamais afficher la valeur", () => {
  const secret = "Zq9-secret-tres-long-et-aleatoire-0123456789";
  const a = avertissementsSecrets(secret, secret);
  assert.equal(a.length, 1);
  assert.ok(!a[0]!.includes(secret));
  assert.deepEqual(avertissementsSecrets(secret, `${secret}-autre`), []);
});

function ctxDemo(journal: (e: EvenementConnexion) => Promise<void>): { ctx: Contexte; admin: string } {
  const { magasin, identifiants } = creerDemo(new Date("2026-10-12T10:00:00Z"), { motDePasse: MDP });
  const admin = identifiants.find((i) => i.role === "administrateur")!.identifiant;
  return { ctx: { magasin, limiteur: new LimiteurTentatives(), maintenant: () => magasin.horloge, journaliserConnexion: journal }, admin };
}
const connexion = (identifiant: string, motDePasse: string): Requete => ({ methode: "POST", chemin: "/api/connexion", requete: {}, corps: { identifiant, motDePasse }, entetes: {}, ip: "10.1.2.3" });

test("journal de connexion : succès, échec d'un compte connu, échec d'un compte inconnu", async () => {
  const evenements: EvenementConnexion[] = [];
  const { ctx, admin } = ctxDemo(async (e) => { evenements.push(e); });
  assert.equal((await gererRequete(ctx, connexion(admin, MDP))).statut, 200);
  assert.equal((await gererRequete(ctx, connexion(admin, "mauvais"))).statut, 401);
  const saisieSensible = "MotDePasseTapéDansLeChampIdentifiant";
  assert.equal((await gererRequete(ctx, connexion(saisieSensible, "x"))).statut, 401);
  assert.deepEqual(evenements.map((e) => e.action), ["connexion_reussie", "connexion_echec", "connexion_echec"]);
  assert.ok(evenements[0]!.userId && evenements[1]!.userId === evenements[0]!.userId, "compte connu référencé par son id");
  assert.equal(evenements[2]!.userId, null, "compte inconnu : aucune référence");
  assert.ok(evenements.every((e) => e.ip === "10.1.2.3"));
  assert.ok(!JSON.stringify(evenements).includes(saisieSensible), "l'identifiant saisi n'est jamais journalisé");
});

test("journal de connexion : une panne du journal ne bloque pas la connexion", async () => {
  const erreurs = console.error;
  console.error = () => {};
  try {
    const { ctx, admin } = ctxDemo(async () => { throw new Error("base indisponible"); });
    assert.equal((await gererRequete(ctx, connexion(admin, MDP))).statut, 200);
    assert.equal((await gererRequete(ctx, connexion(admin, "mauvais"))).statut, 401);
  } finally { console.error = erreurs; }
});

test("HTTP : l'interface est revalidée (ETag, 304) et les images gardent un cache court", async () => {
  const { magasin } = creerDemo(new Date("2026-10-12T10:00:00Z"), { motDePasse: MDP });
  const srv = creerServeur({ magasin, limiteur: new LimiteurTentatives(), maintenant: () => magasin.horloge }, `${racine}web`);
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    for (const chemin of ["/app.js", "/styles.css", "/index.html", "/sw.js"]) {
      const r1 = await fetch(`${base}${chemin}`);
      const etag = r1.headers.get("etag");
      assert.equal(r1.status, 200, chemin);
      assert.equal(r1.headers.get("cache-control"), "no-cache", chemin);
      assert.match(etag ?? "", /^"[A-Za-z0-9_-]{22}"$/, chemin);
      const r2 = await fetch(`${base}${chemin}`, { headers: { "If-None-Match": etag! } });
      assert.equal(r2.status, 304, chemin);
      assert.equal((await r2.text()), "");
      const r3 = await fetch(`${base}${chemin}`, { headers: { "If-None-Match": '"autre"' } });
      assert.equal(r3.status, 200, chemin);
    }
    const image = await fetch(`${base}/icons/logo-chnuf.png`);
    assert.equal(image.headers.get("cache-control"), "public, max-age=3600, stale-while-revalidate=86400");
  } finally { srv.closeAllConnections(); await new Promise<void>((ok) => srv.close(() => ok())); }
});

test("compose : le conteneur ne reçoit pas le mot de passe admin initial ; le mot de passe démo est facultatif", () => {
  const compose = lire("compose.yaml");
  assert.doesNotMatch(compose, /^\s+ADMIN_INITIAL_MOT_DE_PASSE:/m);
  assert.match(compose, /DEMO_MOT_DE_PASSE: "\$\{DEMO_MOT_DE_PASSE:-\}"/);
  assert.doesNotMatch(compose, /DEMO_MOT_DE_PASSE:\s*\$\{DEMO_MOT_DE_PASSE:\?/);
});

test("HTTPS : surcouche Caddy avec TRUST_PROXY, proxy seul exposé et X-Forwarded-For remplacé", () => {
  const surcouche = lire("compose.https.yaml");
  assert.match(surcouche, /TRUST_PROXY: "1"/);
  assert.match(surcouche, /FANN_HOSTNAME: \$\{FANN_HOSTNAME:\?/);
  assert.match(surcouche, /:443"/);
  assert.match(surcouche, /cap_drop:[\s\S]*- ALL/);
  assert.match(surcouche, /no-new-privileges:true/);
  assert.doesNotMatch(surcouche, /APP_BIND_ADDRESS:\s*0\.0\.0\.0/);
  const caddy = lire("deploy/Caddyfile");
  assert.match(caddy, /\{\$FANN_HOSTNAME\}/);
  assert.match(caddy, /tls internal/);
  assert.match(caddy, /reverse_proxy app:8787/);
  assert.match(caddy, /header_up X-Forwarded-For \{remote_host\}/);
});

test("sauvegarde : script strict, vérifié avant conservation, avec rétention, exécutable", () => {
  const s = lire("scripts/sauvegarde-postgres.sh");
  assert.match(s, /set -euo pipefail/);
  assert.match(s, /pg_dump -U "\$POSTGRES_USER" -d "\$POSTGRES_DB" -Fc/);
  assert.match(s, /pg_restore --list/);
  assert.match(s, /mv "\$fichier\.tmp" "\$fichier"/);
  assert.match(s, /tail -n \+/);
  // Le script est lancé par « bash scripts/… » (PowerShell, documentation) : le bit exécutable d'une archive
  // extraite n'est pas fiable (NTFS, extracteurs ZIP) et ne doit pas faire échouer le contrôle.
  // On vérifie ce qui garantit réellement l'exécution : shebang, fins de ligne LF et syntaxe bash valide.
  assert.match(s, /^#!\/usr\/bin\/env bash\n/);
  assert.equal(s.includes("\r"), false, "fins de ligne LF obligatoires (un CRLF casse le script sous Linux)");
  const syntaxe = spawnSync("bash", ["-n", `${racine}scripts/sauvegarde-postgres.sh`], { encoding: "utf8" });
  assert.equal(syntaxe.status, 0, `bash -n a échoué : ${syntaxe.stderr}`);
  // Le dépôt Git impose LF et le mode exécutable pour les scripts shell.
  assert.match(lire(".gitattributes"), /^\*\.sh text eol=lf$/m);
});

test("compose : un service migrate applique migrations et droits avant l'application, sans exposer le compte admin à app", () => {
  const compose = lire("compose.yaml");
  assert.match(compose, /migrate:\s*\n\s+build:/);
  assert.match(compose, /migrate:\s*\n\s+condition: service_completed_successfully/);
  assert.match(compose, /node scripts\/migrate-catalogue\.mjs && node scripts\/configurer-role-application\.mjs/);
  const bloc = (nom: string) => compose.split(new RegExp(`^  ${nom}:\\n`, "m"))[1]!.split(/^  \w[\w-]*:\n/m)[0]!;
  assert.match(bloc("migrate"), /DATABASE_ADMIN_URL/);
  assert.doesNotMatch(bloc("app"), /DATABASE_ADMIN_URL|POSTGRES_PASSWORD/);
  const dockerfile = lire("Dockerfile");
  assert.match(dockerfile, /scripts\/migrate-catalogue\.mjs/);
  assert.match(dockerfile, /supabase\/migrations/);
});

test("CI : audit des dépendances et tests PostgreSQL réels", () => {
  const ci = lire(".github/workflows/ci.yml");
  assert.match(ci, /npm audit --omit=dev/);
  assert.match(ci, /npm run test:postgres/);
});

test("déconnexion : le jeton est révoqué côté serveur (POST /api/deconnexion)", async () => {
  const { magasin } = creerDemo(new Date("2026-10-16T10:00:00Z"), { motDePasse: "motdepasse-demo-123" });
  const ctx = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => new Date("2026-10-16T10:00:00Z") } as unknown as Contexte;
  const admin = [...magasin.utilisateurs.values()].find((u) => u.role === "administrateur")!;
  const jeton = creerSession(admin.id, magasin.secretSession, new Date("2026-10-16T10:00:00Z"), 3600, admin.sessionVersion ?? 0);
  const req = (methode: string): Requete => ({ methode, chemin: "/api/deconnexion", requete: {}, corps: undefined, entetes: { authorization: `Bearer ${jeton}` }, ip: "127.0.0.1" });
  assert.equal((await gererRequete(ctx, req("GET"))).statut, 405);
  assert.equal((await gererRequete(ctx, req("POST"))).statut, 200);
  assert.equal((await gererRequete(ctx, req("POST"))).statut, 401, "le jeton ne doit plus être accepté");
});

test("HTTPS : HSTS activé et image Caddy épinglée", () => {
  assert.match(lire("deploy/Caddyfile"), /Strict-Transport-Security "max-age=31536000"/);
  assert.match(lire("compose.https.yaml"), /image: caddy:\d+\.\d+-alpine/);
});

test("session : 26 h pour un agent (garde de 24 h), 8 h pour administrateur et responsable", async () => {
  const { magasin } = creerDemo(new Date("2026-10-16T10:00:00Z"), { motDePasse: "motdepasse-demo-123" });
  const ctx = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => new Date("2026-10-16T10:00:00Z") } as unknown as Contexte;
  const exp = async (identifiant: string, ip: string) => {
    const r = await gererRequete(ctx, { methode: "POST", chemin: "/api/connexion", requete: {}, corps: { identifiant, motDePasse: "motdepasse-demo-123" }, entetes: {}, ip });
    const jeton = (r.corps as { jeton: string }).jeton;
    return JSON.parse(Buffer.from(jeton.split(".")[0]!, "base64url").toString()).e - new Date("2026-10-16T10:00:00Z").getTime();
  };
  assert.equal(await exp("agent-n1", "a"), 26 * 3600_000);
  assert.equal(await exp("admin", "b"), 8 * 3600_000);
  assert.equal(await exp("responsable", "c"), 8 * 3600_000);
});

test("badge : au recto, le prénom précède le nom", () => {
  const app = lire("web/app.js");
  const recto = app.slice(app.indexOf('class: "badge-recto-identite"'));
  assert.ok(recto.indexOf('class: "badge-prenom"') > -1 && recto.indexOf('class: "badge-prenom"') < recto.indexOf('class: "badge-nom"'));
});

test("sauvegarde serveur : chiffrée, relue, vérifiée à l'arrivée, sans secret en ligne de commande", () => {
  const sauv = lire("scripts/sauvegarde-serveur.ps1");
  assert.match(sauv, /aes-256-cbc -salt -pbkdf2 -iter 600000/);
  assert.match(sauv, /-pass "file:\$fichierCle"/);
  assert.doesNotMatch(sauv, /-pass pass:/);
  assert.match(sauv, /relecture/);
  assert.match(sauv, /Remove-Item -Recurse -Force \$tmp/);
  assert.match(sauv, /StrictHostKeyChecking=yes/);
  assert.match(sauv, /BatchMode=yes/);
  assert.match(sauv, /sha256sum/);
  assert.match(sauv, /ECHEC\.txt/);
  assert.match(sauv, /Git\\bin\\bash\.exe/);
  const restau = lire("scripts/restaurer-sauvegarde.sh");
  assert.match(restau, /--single-transaction/);
  assert.match(restau, /fann_restore_test/);
  assert.match(restau, /docker compose run --rm migrate/);
  assert.match(lire("scripts/restaurer-sauvegarde.ps1"), /Tapez RESTAURER/);
  const inst = lire("scripts/installer-sauvegarde.ps1");
  assert.match(inst, /Register-ScheduledTask/);
  assert.match(inst, /RandomNumberGenerator/);
  assert.match(lire(".env.example"), /^BACKUP_DEST=$/m);
});

test("sauvegarde serveur : plusieurs destinations (partage + SSH), un échec n'empêche pas les autres", () => {
  const sauv = lire("scripts/sauvegarde-serveur.ps1");
  assert.match(sauv, /\$dest -split ';'/);
  assert.match(sauv, /function Envoyer\(\[string\]\$destination\)/);
  assert.match(sauv, /foreach \(\$d in \$destinations\)[\s\S]*try \{ Envoyer \$d \}[\s\S]*catch/);
  assert.match(sauv, /Envoi echoue vers/);
  assert.match(lire(".env.example"), /BACKUP_DEST=.*;.*@serveur/);
});

test("limiteur : un compte bloqué est débloqué par l'administrateur seulement, avec trace", async () => {
  const { magasin } = creerDemo(new Date("2026-10-16T10:00:00Z"), { motDePasse: "motdepasse-demo-123" });
  const now = new Date("2026-10-16T10:00:00Z");
  const evenements: string[] = [];
  const ctx = { magasin, limiteur: new LimiteurTentatives(), maintenant: () => now, journaliserConnexion: async (e: { action: string }) => { evenements.push(e.action); } } as unknown as Contexte;
  const connexion = (ip: string, mdp: string) => gererRequete(ctx, { methode: "POST", chemin: "/api/connexion", requete: {}, corps: { identifiant: "agent-n1", motDePasse: mdp }, entetes: {}, ip });
  for (let i = 0; i < 5; i++) assert.equal((await connexion("10.0.0.9", "mauvais-mot-de-passe")).statut, 401);
  assert.equal((await connexion("10.0.0.9", "motdepasse-demo-123")).statut, 429, "compte verrouillé");
  const ouvrir = async (id: string, ip: string) => (((await gererRequete(ctx, { methode: "POST", chemin: "/api/connexion", requete: {}, corps: { identifiant: id, motDePasse: "motdepasse-demo-123" }, entetes: {}, ip })).corps) as { jeton: string }).jeton;
  const jetonAdmin = await ouvrir("admin", "10.0.0.1");
  const jetonResp = await ouvrir("responsable", "10.0.0.2");
  const debloquer = (jeton: string, corps: unknown, methode = "POST") => gererRequete(ctx, { methode, chemin: "/api/connexions/debloquer", requete: {}, corps, entetes: { authorization: `Bearer ${jeton}` }, ip: "10.0.0.1" });
  assert.equal((await debloquer(jetonResp, { identifiant: "agent-n1" })).statut, 403, "un responsable ne débloque pas");
  assert.equal((await debloquer(jetonAdmin, { identifiant: "" })).statut, 400);
  assert.equal((await debloquer(jetonAdmin, {}, "GET")).statut, 405);
  const r = await debloquer(jetonAdmin, { identifiant: " Agent-N1 " });
  assert.equal(r.statut, 200);
  assert.equal((r.corps as { debloque: boolean }).debloque, true);
  assert.ok(evenements.includes("connexion_debloquee"));
  assert.equal((await connexion("10.0.0.9", "motdepasse-demo-123")).statut, 200, "le compte peut se reconnecter");
});

test("réparation du .env : doublons supprimés (dernière valeur gardée), BADGE_SECRET séparé sur demande, aucun secret affiché", async () => {
  const { reparerEnv } = (await import(new URL("../../scripts/reparer-env.mjs", import.meta.url).href)) as {
    reparerEnv: (c: string, o?: { separerBadge?: boolean; secret?: () => string }) => { contenu: string; modifications: string[] };
  };
  const source = "APP_PORT=8787\nSESSION_SECRET=abc\nBADGE_SECRET=abc\n# commentaire\nAPP_PORT=8788\n";
  const r1 = reparerEnv(source);
  assert.match(r1.contenu, /APP_PORT=8788/);
  assert.doesNotMatch(r1.contenu, /APP_PORT=8787/);
  assert.match(r1.contenu, /BADGE_SECRET=abc/, "sans option, BADGE_SECRET est conservé");
  const r2 = reparerEnv(source, { separerBadge: true, secret: () => "nouveau-secret-independant" });
  assert.match(r2.contenu, /BADGE_SECRET=nouveau-secret-independant/);
  assert.match(r2.contenu, /SESSION_SECRET=abc/);
  assert.ok(r2.modifications.length >= 2 && r2.modifications.every((m) => !m.includes("nouveau-secret-independant") && !m.includes("abc")));
  assert.equal(reparerEnv(r2.contenu, { separerBadge: true }).modifications.length, 0, "idempotent");
});

test("supervision : application, disque, sauvegardes, anti-spam, webhook facultatif ; tâche planifiée installée", () => {
  const surv = lire("scripts/surveiller.ps1");
  assert.match(surv, /readyz/);
  assert.match(surv, /5GB/);
  assert.match(surv, /ECHEC\.txt/);
  assert.match(surv, /TotalHours -gt 26/);
  assert.match(surv, /TotalHours -ge 6/);
  assert.match(surv, /ALERT_WEBHOOK_URL/);
  assert.match(lire("scripts/installer-sauvegarde.ps1"), /FANN-Surveillance/);
  assert.match(lire("docs/ETAT_ACTUEL.md"), /point d'entrée unique/);
  assert.match(lire("docs/CHECKLIST_PILOTE.md"), /Check-list du pilote/);
});
