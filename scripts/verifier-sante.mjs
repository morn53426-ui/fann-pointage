// Vérifie /healthz et /readyz sur le port RÉELLEMENT publié (APP_PORT du .env), pas sur 8787 en dur.
// Usage : npm run health   (ou : node scripts/verifier-sante.mjs [http://127.0.0.1:8788])
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(fileURLToPath(new URL('../', import.meta.url)));
function lireEnv() {
  const fichier = resolve(racine, '.env');
  const valeurs = {};
  if (!existsSync(fichier)) return valeurs;
  for (const ligne of readFileSync(fichier, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(ligne);
    if (m && !ligne.trimStart().startsWith('#')) valeurs[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return valeurs;
}
const env = lireEnv();
const port = process.env.APP_PORT || env.APP_PORT || '8787';
const hote = (process.env.APP_BIND_ADDRESS || env.APP_BIND_ADDRESS || '127.0.0.1');
const base = (process.argv[2] || `http://${hote === '0.0.0.0' ? '127.0.0.1' : hote}:${port}`).replace(/\/$/, '');

let echec = false;
for (const chemin of ['/healthz', '/readyz']) {
  try {
    const r = await fetch(base + chemin, { signal: AbortSignal.timeout(5000) });
    const corps = (await r.text()).slice(0, 200);
    console.log(`${r.ok ? 'OK  ' : 'ECHEC'} ${r.status} ${base}${chemin} ${corps}`);
    if (!r.ok) echec = true;
  } catch (e) {
    echec = true;
    console.log(`ECHEC ${base}${chemin} : ${e.cause?.code ?? e.message}`);
  }
}
if (echec) {
  console.log(`\nAstuce : le port publié par Docker se lit avec « docker compose ps » (colonne PORTS) ; il vient de APP_PORT dans .env (actuellement ${port}).`);
  process.exit(1);
}
