import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(fileURLToPath(new URL('..', import.meta.url)));
const motDePasse = 'E2E-demonstration-sans-donnees-reelles-2026';
const cleArrivee = `e2e-arrivee-${process.pid}-${Date.now()}`;
const cleDepart = `e2e-depart-${process.pid}-${Date.now()}`;
const resultats = [];
const verifier = (nom, condition) => {
  assert.ok(condition, nom);
  resultats.push(nom);
};
const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function portLibre() {
  const serveur = createServer();
  serveur.listen(0, '127.0.0.1');
  await once(serveur, 'listening');
  const adresse = serveur.address();
  assert.ok(adresse && typeof adresse === 'object');
  await new Promise((resolve, reject) => serveur.close((erreur) => erreur ? reject(erreur) : resolve()));
  return adresse.port;
}

async function lancerServeur(port, dataDir) {
  const enfant = spawn(process.execPath, ['--experimental-strip-types', 'src/api/main.ts'], {
    cwd: racine,
    env: {
      ...process.env,
      FANN_MODE: 'demo',
      HOST: '127.0.0.1',
      PORT: String(port),
      DEMO_MOT_DE_PASSE: motDePasse,
      DATA_DIR: dataDir,
      ZONE_LAT: '',
      ZONE_LNG: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  enfant.logs = '';
  enfant.stdout.setEncoding('utf8');
  enfant.stderr.setEncoding('utf8');
  enfant.stdout.on('data', (s) => { enfant.logs += s; });
  enfant.stderr.on('data', (s) => { enfant.logs += s; });
  enfant.on('error', (e) => { enfant.logs += `\nErreur processus: ${e.message}`; });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i += 1) {
    if (enfant.exitCode !== null) throw new Error(`Serveur arrêté au démarrage.\n${enfant.logs}`);
    try {
      const reponse = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(500) });
      if (reponse.status === 200) {
        const json = await reponse.json();
        if (json.status === 'ok' && json.mode === 'demo') return { enfant, base };
      }
    } catch { /* Le processus peut prendre un court instant pour démarrer. */ }
    await attendre(100);
  }
  await arreterServeur(enfant);
  throw new Error(`Le serveur n'est pas devenu sain en 10 secondes.\n${enfant.logs}`);
}

async function arreterServeur(enfant) {
  if (enfant.exitCode !== null || enfant.signalCode !== null) return;
  enfant.kill('SIGTERM');
  await Promise.race([
    once(enfant, 'exit'),
    attendre(4000).then(() => { throw new Error(`Arrêt du serveur trop long.\n${enfant.logs}`); }),
  ]);
}

async function appel(base, chemin, { methode = 'GET', jeton, corps } = {}) {
  const entetes = {};
  if (jeton) entetes.Authorization = `Bearer ${jeton}`;
  if (corps !== undefined) entetes['Content-Type'] = 'application/json';
  const reponse = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: entetes,
    body: corps === undefined ? undefined : JSON.stringify(corps),
    signal: AbortSignal.timeout(3000),
  });
  const texte = await reponse.text();
  let donnees = texte;
  try { donnees = texte ? JSON.parse(texte) : null; } catch { /* Une réponse texte reste vérifiable. */ }
  return { statut: reponse.status, entetes: reponse.headers, donnees };
}

async function connexion(base, identifiant, mdp = motDePasse) {
  const r = await appel(base, '/api/connexion', { methode: 'POST', corps: { identifiant, motDePasse: mdp } });
  assert.equal(r.statut, 200, `Connexion ${identifiant} refusée: ${JSON.stringify(r.donnees)}`);
  assert.equal(typeof r.donnees?.jeton, 'string');
  return r.donnees.jeton;
}

async function main() {
  const dossier = await mkdtemp(join(tmpdir(), 'fann-e2e-process-'));
  const dataDir = join(dossier, 'data');
  const fichierPersistance = join(dataDir, 'pointages-demo.json');
  const port = await portLibre();
  let processus;
  let idPointage;
  let badgeAgent;
  try {
    let instance = await lancerServeur(port, dataDir);
    processus = instance.enfant;
    let base = instance.base;

    const sansSession = await appel(base, '/api/moi');
    verifier('API : une route privée sans session renvoie 401', sansSession.statut === 401);
    const mauvaisMdp = await appel(base, '/api/connexion', { methode: 'POST', corps: { identifiant: 'admin', motDePasse: 'mauvais-mot-de-passe' } });
    verifier('Authentification : mot de passe incorrect refusé en 401', mauvaisMdp.statut === 401);

    const admin = await connexion(base, 'admin');
    const responsable = await connexion(base, 'responsable');
    const agent = await connexion(base, 'agent-n1');
    const profil = await appel(base, '/api/moi', { jeton: admin });
    verifier('Authentification : connexion admin réelle et profil retourné', profil.statut === 200 && profil.donnees?.role === 'administrateur');

    const agentsAdmin = await appel(base, '/api/agents', { jeton: admin });
    const agentsAgent = await appel(base, '/api/agents', { jeton: agent });
    const dashboardAgent = await appel(base, '/api/tableau-de-bord', { jeton: agent });
    const stationAgent = await appel(base, '/api/pointage-station', { methode: 'POST', jeton: agent, corps: { badgeCode: 'FANN-BADGE:u1', type: 'arrivee', idempotencyKey: `forbidden-${Date.now()}`, horsLigne: false } });
    // Poste de pointage de l'hôpital : le badge physique d'un agent d'un autre service est accepté (cas tracé) ; le matricule seul ne l'est pas.
    const horsServiceBadge = await appel(base, '/api/pointage-station', { methode: 'POST', jeton: responsable, corps: { badgeCode: 'FANN-BADGE:g1', type: 'arrivee', idempotencyKey: `autre-service-badge-${Date.now()}`, horsLigne: false } });
    const horsServiceMatricule = await appel(base, '/api/pointage-station', { methode: 'POST', jeton: responsable, corps: { matricule: 'DEMO-g1', type: 'arrivee', idempotencyKey: `autre-service-matricule-${Date.now()}`, horsLigne: false } });
    verifier('Permissions : admin autorisé à lire les agents', agentsAdmin.statut === 200);
    verifier('Permissions : brancardier bloqué sur la liste des agents et le tableau de bord', agentsAgent.statut === 403 && dashboardAgent.statut === 403);
    verifier('Permissions : brancardier interdit au poste partagé', stationAgent.statut === 403);
    verifier('Permissions : responsable, agent d\'un autre service : badge physique accepté (tracé), matricule seul refusé', horsServiceBadge.statut === 201 && horsServiceMatricule.statut === 403);

    // Les données de démonstration placent u1 en service de jour (08–20), u2 en nuit à partir de 20 h et u3 en nuit jusqu'à 08 h.
    // Dakar est en UTC+0 : cette sélection vise un poste planifié actif quelle que soit l'heure du test.
    const heure = new Date().getUTCHours();
    badgeAgent = heure >= 8 && heure < 20 ? 'FANN-BADGE:u1' : heure >= 20 ? 'FANN-BADGE:u2' : 'FANN-BADGE:u3';
    const arrivee = await appel(base, '/api/pointage-station', { methode: 'POST', jeton: responsable, corps: { badgeCode: badgeAgent, type: 'arrivee', idempotencyKey: cleArrivee, horsLigne: false } });
    assert.equal(arrivee.statut, 201, `Pointage d'arrivée échoué: ${JSON.stringify(arrivee.donnees)}\n${processus.logs}`);
    assert.equal(arrivee.donnees?.validation, 'accepte', `Le pointage ne s'est pas rattaché à un poste actif: ${JSON.stringify(arrivee.donnees)}`);
    idPointage = arrivee.donnees.pointageId;
    verifier('Pointage réel HTTP : arrivée rattachée à un poste actif et acceptée', typeof idPointage === 'string' && arrivee.donnees.validation === 'accepte');

    const rejeuArrivee = await appel(base, '/api/pointage-station', { methode: 'POST', jeton: responsable, corps: { badgeCode: badgeAgent, type: 'arrivee', idempotencyKey: cleArrivee, horsLigne: false } });
    verifier('Pointage : renvoi de la même clé retourne le même événement', rejeuArrivee.statut === 200 && rejeuArrivee.donnees?.rejoue === true && rejeuArrivee.donnees?.pointageId === idPointage);

    const deuxiemeArrivee = await appel(base, '/api/pointage-station', { methode: 'POST', jeton: responsable, corps: { badgeCode: badgeAgent, type: 'arrivee', idempotencyKey: `autre-arrivee-${Date.now()}`, horsLigne: false } });
    verifier('Pointage : une seconde arrivée avec une nouvelle clé est refusée', deuxiemeArrivee.statut === 409);

    const depart = await appel(base, '/api/pointage-station', { methode: 'POST', jeton: responsable, corps: { badgeCode: badgeAgent, type: 'depart', idempotencyKey: cleDepart, horsLigne: false } });
    assert.equal(depart.statut, 201, `Pointage de départ échoué: ${JSON.stringify(depart.donnees)}\n${processus.logs}`);
    assert.equal(depart.donnees?.validation, 'accepte');
    verifier('Pointage réel HTTP : départ accepté après arrivée', depart.statut === 201 && depart.donnees.validation === 'accepte');

    // L'arrêt intervient après confirmation HTTP : les écritures locales doivent déjà être atomiques.
    await arreterServeur(processus);
    processus = undefined;
    verifier('Reprise : le premier processus a été arrêté', true);

    instance = await lancerServeur(port, dataDir);
    processus = instance.enfant;
    base = instance.base;
    const ancienJeton = await appel(base, '/api/moi', { jeton: admin });
    verifier('Authentification après redémarrage : ancien jeton rejeté (nouvelle clé de session)', ancienJeton.statut === 401);

    const responsableApresReboot = await connexion(base, 'responsable');
    const rejeuApresReboot = await appel(base, '/api/pointage-station', { methode: 'POST', jeton: responsableApresReboot, corps: { badgeCode: badgeAgent, type: 'arrivee', idempotencyKey: cleArrivee, horsLigne: false } });
    verifier('Reprise après panne : le pointage restauré est reconnu comme déjà reçu', rejeuApresReboot.statut === 200 && rejeuApresReboot.donnees?.rejoue === true && rejeuApresReboot.donnees?.pointageId === idPointage);

    const rejeuDepartApresReboot = await appel(base, '/api/pointage-station', { methode: 'POST', jeton: responsableApresReboot, corps: { badgeCode: badgeAgent, type: 'depart', idempotencyKey: cleDepart, horsLigne: false } });
    verifier('Reprise après panne : le départ est aussi conservé sans créer de doublon', rejeuDepartApresReboot.statut === 200 && rejeuDepartApresReboot.donnees?.rejoue === true && rejeuDepartApresReboot.donnees?.pointageId === depart.donnees.pointageId);

    const sauvegarde = JSON.parse(await readFile(fichierPersistance, 'utf8'));
    const arriveesPersistes = sauvegarde.pointages.filter((p) => p.idempotencyKey === cleArrivee);
    const departsPersistes = sauvegarde.pointages.filter((p) => p.idempotencyKey === cleDepart);
    verifier('Intégrité de sauvegarde : un seul enregistrement arrivee et un seul départ dans le fichier', arriveesPersistes.length === 1 && departsPersistes.length === 1);
    verifier('Intégrité de sauvegarde : fichier JSON versionné et données test retrouvées', sauvegarde.version === 4 && arriveesPersistes[0]?.id === idPointage);

    console.log('\nRÉSULTAT : TOUS LES CONTRÔLES HTTP DE DÉMONSTRATION SONT PASSÉS');
    for (const nom of resultats) console.log(`PASS — ${nom}`);
    console.log(`\n${resultats.length} contrôles validés. Données temporaires fictives ; rien n'a été envoyé à un système hospitalier réel.`);
    console.log('Limite : le test utilise le stockage JSON de démonstration, pas PostgreSQL.');
  } finally {
    if (processus && processus.exitCode === null && processus.signalCode === null) await arreterServeur(processus).catch(() => {});
    await rm(dossier, { recursive: true, force: true });
  }
}

main().then(() => {
  // Node fetch peut conserver son pool keep-alive après la fin des assertions.
  // Tous les serveurs temporaires sont arrêtés dans finally ; quitter évite que le script de CI reste suspendu.
  process.exit(0);
}).catch((erreur) => {
  console.error('ÉCHEC DU TEST HTTP DE BOUT EN BOUT');
  console.error(erreur?.stack ?? erreur);
  process.exit(1);
});
