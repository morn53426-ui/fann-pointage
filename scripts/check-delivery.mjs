import { readdir, readFile, lstat } from 'node:fs/promises';
import { resolve, relative, extname, basename, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2);
const archiveArg = args.indexOf('--archive');
const archive = archiveArg >= 0 ? resolve(args[archiveArg + 1] ?? '') : null;
const problems = [];
const textExts = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.sql', '.sh', '.ps1', '.yml', '.yaml', '.toml', '.txt', '.html', '.css', '.env']);
const bannedPath = (name) => {
  const n = name.replaceAll('\\', '/').replace(/^\.\//, '');
  return /(^|\/)registre-prive(?:\/|$)/i.test(n)
    || /(^|\/)docs\/REGISTRE_REEL_[^/]*$/i.test(n)
    || /(^|\/)\.env(?:\.[^/]*)?$/i.test(n) && !/(^|\/)\.env\.example$/i.test(n)
    || /(^|\/)(?:backups?|sauvegardes|dumps?)(?:\/|$)/i.test(n)
    || /\.(?:dump|backup|bak|sqlite3?|sql\.gz|pem|p12|pfx|key)$/i.test(n)
    || /(^|\/)(?:id_rsa|id_ed25519|credentials\.json|service-account\.json)$/i.test(n);
};
const secretPatterns = [
  new RegExp(['-----BEGIN ', '(?:RSA|OPENSSH|EC|DSA)?', ' PRIVATE KEY-----'].join(''), 'i'),
  new RegExp(['sk', '-', 'proj', '-', '[A-Za-z0-9_-]{20,}'].join(''), 'i'),
  new RegExp(['ghp', '_', '[A-Za-z0-9]{30,}'].join(''), 'i'),
  new RegExp(['github', '_pat_', '[A-Za-z0-9_]{20,}'].join(''), 'i'),
  new RegExp(['AKIA', '[0-9A-Z]{16}'].join(''), 'i'),
];
const envAssignment = /^\s*(?:export\s+)?(?:SESSION_SECRET|BADGE_SECRET|POSTGRES_PASSWORD|POSTGRES_APP_PASSWORD|ADMIN_INITIAL_MOT_DE_PASSE)\s*=\s*([^\s#;'"]+)/gim;
const databasePassword = /postgres(?:ql)?:\/\/[^:\s/]+:([^@\s/]+)@/gi;
function scanText(text, label) {
  const filename = label.toLowerCase();
  const inspectAssignments = /(^|\/)(?:[^/]+\.md|\.env(?:\.example)?|[^/]+\.ya?ml)$/.test(filename);
  for (const pattern of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) { problems.push(`${label}: motif de secret potentiel détecté`); return; }
  }
  if (!inspectAssignments) return; // Le code et les tests fabriquent aussi des exemples de configuration.
  for (const pattern of [envAssignment, databasePassword]) {
    pattern.lastIndex = 0;
    let hit;
    while ((hit = pattern.exec(text)) !== null) {
      const value = hit[1] ?? '';
      if (/^(?:|replace[_-]?me(?:[_-].*)?|change[_-]?me(?:[_-].*)?|remplacer_par_.*|your[_-].*|\$\{[^}]+\}|<[^>]+>|[A-Z][A-Z0-9_]{2,})$/i.test(value)) continue;
      problems.push(`${label}: configuration contenant une valeur secrète potentielle`);
      return;
    }
  }
}
function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${command} n'a pas pu inspecter l'archive.`);
  return result.stdout;
}

if (archive) {
  const names = run('unzip', ['-Z1', archive]).split(/\r?\n/).filter(Boolean);
  for (const name of names) if (bannedPath(name)) problems.push(`Chemin privé interdit dans l’archive : ${name}`);
  for (const name of names) {
    if (bannedPath(name) || !textExts.has(extname(name).toLowerCase())) continue;
    const text = run('unzip', ['-p', archive, name]);
    scanText(text, `Archive/${name}`);
  }
  // Avertissement (non bloquant) : un ZIP recréé sous Windows perd le bit exécutable des scripts shell.
  // Les scripts sont lancés par « bash scripts/… », donc ce n'est pas une erreur, mais le mode Unix est préférable.
  const modes = run('unzip', ['-Z', archive]).split(/\r?\n/).filter((ligne) => /\.sh\s*$/.test(ligne));
  const sansExec = modes.filter((ligne) => !/^-[r-][w-]x/.test(ligne)).map((ligne) => ligne.trim().split(/\s+/).pop());
  if (sansExec.length) console.warn(`Avertissement : bit exécutable absent dans l'archive pour ${sansExec.join(', ')} (lancer avec « bash scripts/... » ; voir .gitattributes).`);
  const dockerignorePath = names.find((name) => name === '.dockerignore' || name.endsWith('/.dockerignore'));
  const gitignorePath = names.find((name) => name === '.gitignore' || name.endsWith('/.gitignore'));
  const dockerignore = dockerignorePath ? run('unzip', ['-p', archive, dockerignorePath]) : '';
  const gitignore = gitignorePath ? run('unzip', ['-p', archive, gitignorePath]) : '';
  if (!dockerignore.includes('registre-prive/')) problems.push('.dockerignore ne protège pas registre-prive/.');
  if (!gitignore.includes('registre-prive/')) problems.push('.gitignore ne protège pas registre-prive/.');
} else {
  const avecEnvLocal = process.argv.includes('--local');
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      const name = relative(root, full).split(sep).join('/');
      if (['node_modules', '.git', 'coverage', 'playwright-report', 'test-results'].includes(entry.name)) continue;
      // --local : dossier de travail. Le .env de la racine (secrets locaux, ignoré par git et par Docker) n'est alors pas signalé.
      // Sans cette option (CI, dossier à zipper), tout .env reste interdit : ne jamais livrer un .env.
      if (avecEnvLocal && name === '.env') continue;
      if (bannedPath(name)) { problems.push(`Chemin privé interdit dans le dépôt de livraison : ${name}`); continue; }
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile() && textExts.has(extname(entry.name).toLowerCase())) scanText(await readFile(full, 'utf8'), name);
      else if (entry.isFile() && ['.env', '.pem', '.key', '.p12', '.pfx'].includes(extname(entry.name).toLowerCase())) problems.push(`Type de fichier sensible interdit : ${name}`);
    }
  }
  await walk(root);
  const dockerignore = await readFile(resolve(root, '.dockerignore'), 'utf8');
  const gitignore = await readFile(resolve(root, '.gitignore'), 'utf8');
  if (!dockerignore.includes('registre-prive/')) problems.push('.dockerignore ne protège pas registre-prive/.');
  if (!gitignore.includes('registre-prive/')) problems.push('.gitignore ne protège pas registre-prive/.');
}

if (problems.length) {
  console.error('Contrôle de livraison échoué :');
  for (const problem of [...new Set(problems)]) console.error(`- ${problem}`);
  if (problems.some((p) => /dépôt de livraison : \.env$/.test(p))) console.error('Note : un .env dans un dossier de travail est normal. Pour le contrôler sans lui : npm run check:delivery:local. Avant de zipper pour livrer, retirez-le (ou contrôlez l\'archive : node scripts/check-delivery.mjs --archive archive.zip).');
  process.exitCode = 1;
} else {
  console.log(`Contrôle de livraison réussi${archive ? ` pour ${basename(archive)}` : ''} : aucun chemin privé interdit ni motif de secret détecté.`);
}
