// Répare un .env existant sans jamais afficher de secret :
//  - supprime les clés en double (la DERNIÈRE valeur est celle que Docker utilise, elle est conservée) ;
//  - avec --separer-badge : donne à BADGE_SECRET une valeur indépendante de SESSION_SECRET.
//    Attention : après émission de vrais badges, changer BADGE_SECRET oblige à réémettre tous les badges.
// Une copie « .env.bak-AAAAMMJJ-HHMMSS » est créée avant toute modification.
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/;

export function reparerEnv(contenu, { separerBadge = false, secret = () => randomBytes(48).toString('base64url') } = {}) {
  const lignes = contenu.split(/\r?\n/);
  const derniere = new Map();
  lignes.forEach((l, i) => { const m = CLE.exec(l); if (m) derniere.set(m[1], i); });
  const modifications = [];
  const gardees = [];
  lignes.forEach((l, i) => {
    const m = CLE.exec(l);
    if (m && derniere.get(m[1]) !== i) { modifications.push(`doublon supprimé : ${m[1]} (ligne ${i + 1}) ; la dernière valeur est conservée`); return; }
    gardees.push(l);
  });
  let sortie = gardees.join('\n');
  if (separerBadge) {
    const valeur = (cle) => { const m = new RegExp(`^\\s*${cle}\\s*=\\s*(.*?)\\s*$`, 'm').exec(sortie); return m ? m[1].replace(/^["']|["']$/g, '') : undefined; };
    const session = valeur('SESSION_SECRET');
    const badge = valeur('BADGE_SECRET');
    if (badge === undefined || badge === '' || badge === session || /replace_me/.test(badge)) {
      const nouveau = secret();
      if (badge === undefined) sortie = sortie.replace(/\n*$/, '\n') + `BADGE_SECRET=${nouveau}\n`;
      else sortie = sortie.replace(/^(\s*BADGE_SECRET\s*=).*$/m, () => `BADGE_SECRET=${nouveau}`);
      modifications.push('BADGE_SECRET : nouvelle valeur indépendante générée');
    }
  }
  return { contenu: sortie, modifications };
}

const principal = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (principal) {
  const racine = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const cible = resolve(racine, '.env');
  if (!existsSync(cible)) { console.error('Aucun fichier .env : lancez npm run setup:env.'); process.exit(1); }
  const original = readFileSync(cible, 'utf8');
  const { contenu, modifications } = reparerEnv(original, { separerBadge: process.argv.includes('--separer-badge') });
  if (!modifications.length) { console.log('.env déjà correct : aucun changement.'); process.exit(0); }
  const horodatage = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})(\d{6})$/, '$1-$2');
  copyFileSync(cible, `${cible}.bak-${horodatage}`);
  writeFileSync(cible, contenu, 'utf8');
  for (const m of modifications) console.log(`- ${m}`);
  console.log(`Copie de sécurité : .env.bak-${horodatage} (contient les anciens secrets : supprimez-la une fois le résultat vérifié).`);
  console.log('Relancez ensuite : docker compose up -d app');
}
