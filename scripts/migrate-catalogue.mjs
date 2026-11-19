import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const url = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL?.trim() || '';
if (!url) throw new Error('DATABASE_ADMIN_URL (recommandé) ou DATABASE_URL est obligatoire. Vérifiez le fichier .env.');
const sslMode = process.env.PGSSL?.trim().toLowerCase();
if (sslMode && sslMode !== 'require') throw new Error("PGSSL accepte uniquement 'require' ou une valeur vide.");
const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 8000,
  ...(sslMode === 'require' ? { ssl: { rejectUnauthorized: true } } : {}),
  application_name: 'fann-pointage-migration-catalogue' });
const migrations = [
  '0013_catalogue_reel_agents_services',
  '0014_runtime_operations_and_agent_photo',
  '0015_absences_rapports_postgres',
  '0016_badge_profession_contact',
];
const servicesReferences = [
  'Accueil urgences', 'Pneumologie', 'Neurologie/Hospitalisation', 'Neurologie/Consultation externe',
  'Neurochirurgie', 'ORL', 'Maladies infectieuses', 'Gériatrie', 'Kinésie', 'Réa polyvalente',
  'CTCV', 'Cardiologie médicale', 'CDIM/SG', 'Chirurgie plastique', 'Psychiatrie', 'Imagerie',
  'Morgue', 'Mobile', 'SSI', 'Superviseur',
];
try {
  // La base peut être « healthy » une seconde avant d'accepter les connexions réseau (fin d'initialisation) : on réessaie.
  for (let essai = 1; ; essai++) {
    try { await pool.query('SELECT 1'); break; }
    catch (e) { if (essai >= 20) throw e; await new Promise((r) => setTimeout(r, 1500)); }
  }
  const migrationsTable = await pool.query("SELECT to_regclass('public.app_schema_migrations') AS table_name");
  if (!migrationsTable.rows[0]?.table_name) {
    const path0013 = fileURLToPath(new URL('../supabase/migrations/0013_catalogue_reel_agents_services.sql', import.meta.url));
    await pool.query(await readFile(path0013, 'utf8'));
  }
  for (const version of migrations) {
    const present = await pool.query('SELECT 1 FROM app_schema_migrations WHERE version = $1', [version]);
    if (present.rowCount) {
      console.log(`Migration ${version} déjà appliquée.`);
      continue;
    }
    const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${version}.sql`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
    console.log(`Migration ${version} appliquée.`);
  }

  // L'ENUM doit être étendu après 0013–0016, hors transaction, et avant la contrainte 0018.
  // IF NOT EXISTS rend cette étape sûre au démarrage comme lors d'une mise à niveau.
  const migrationMobilEnum = fileURLToPath(new URL('../supabase/migrations/0017_regime_mobil_enum.sql', import.meta.url));
  await pool.query(await readFile(migrationMobilEnum, 'utf8'));
  console.log('Migration 0017_regime_mobil_enum vérifiée/appliquée.');

  const mobilRules = '0018_planning_mobil_rules';
  const mobilRulesPresent = await pool.query('SELECT 1 FROM app_schema_migrations WHERE version = $1', [mobilRules]);
  if (mobilRulesPresent.rowCount) {
    console.log(`Migration ${mobilRules} déjà appliquée.`);
  } else {
    const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${mobilRules}.sql`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
    console.log(`Migration ${mobilRules} appliquée.`);
  }

  // 0019 : durée du service général de 2 h à 8 h (service qui termine avant 16 h). Après 0018, qui redéfinit la même contrainte.
  const heureFin = '0019_general_heure_fin';
  const heureFinPresente = await pool.query('SELECT 1 FROM app_schema_migrations WHERE version = $1', [heureFin]);
  if (heureFinPresente.rowCount) {
    console.log(`Migration ${heureFin} déjà appliquée.`);
  } else {
    const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${heureFin}.sql`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
    console.log(`Migration ${heureFin} appliquée.`);
  }

  // 0020 : calendrier ouvré et régimes par défaut des services ; aucun planning historique n'est réécrit.
  const reglesCalendrier = '0020_regles_calendrier_services';
  const calendrierPresent = await pool.query('SELECT 1 FROM app_schema_migrations WHERE version = $1', [reglesCalendrier]);
  if (calendrierPresent.rowCount) {
    console.log(`Migration ${reglesCalendrier} déjà appliquée.`);
  } else {
    const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${reglesCalendrier}.sql`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
    console.log(`Migration ${reglesCalendrier} appliquée.`);
  }

  // 0021 : messagerie persistante et suivi de lecture. Ne touche pas aux données de pointage.
  const messagerie = '0021_messagerie_diffusion';
  const messageriePresente = await pool.query('SELECT 1 FROM app_schema_migrations WHERE version = $1', [messagerie]);
  if (messageriePresente.rowCount) {
    console.log(`Migration ${messagerie} déjà appliquée.`);
  } else {
    const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${messagerie}.sql`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
    console.log(`Migration ${messagerie} appliquée.`);
  }

  // 0022 : messages individuels ou ciblés par service, sans modifier les diffusions existantes.
  const destinatairesMessages = '0022_messagerie_destinataires';
  const destinatairesMessagesPresents = await pool.query('SELECT 1 FROM app_schema_migrations WHERE version = $1', [destinatairesMessages]);
  if (destinatairesMessagesPresents.rowCount) {
    console.log(`Migration ${destinatairesMessages} déjà appliquée.`);
  } else {
    const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${destinatairesMessages}.sql`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
    console.log(`Migration ${destinatairesMessages} appliquée.`);
  }

  // 0023 : comptes agents automatiques et changement de mot de passe obligatoire (colonne additive, comptes existants inchangés).
  const comptesAgents = '0023_comptes_agents_mot_de_passe';
  const comptesAgentsPresents = await pool.query('SELECT 1 FROM app_schema_migrations WHERE version = $1', [comptesAgents]);
  if (comptesAgentsPresents.rowCount) {
    console.log(`Migration ${comptesAgents} déjà appliquée.`);
  } else {
    const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${comptesAgents}.sql`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
    console.log(`Migration ${comptesAgents} appliquée.`);
  }

  // 0024 : expiration du mot de passe provisoire (colonne + déclencheur ; les comptes déjà provisoires démarrent leur délai maintenant).
  const expirationProvisoire = '0024_mot_de_passe_provisoire_expiration';
  const expirationPresente = await pool.query('SELECT 1 FROM app_schema_migrations WHERE version = $1', [expirationProvisoire]);
  if (expirationPresente.rowCount) {
    console.log(`Migration ${expirationProvisoire} déjà appliquée.`);
  } else {
    const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${expirationProvisoire}.sql`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
    console.log(`Migration ${expirationProvisoire} appliquée.`);
  }

  // 0025 : suivi du traitement des anomalies (consultée / traitée), table additive.
  const suiviAnomalies = '0025_anomalies_suivi';
  const suiviPresent = await pool.query('SELECT 1 FROM app_schema_migrations WHERE version = $1', [suiviAnomalies]);
  if (suiviPresent.rowCount) {
    console.log(`Migration ${suiviAnomalies} déjà appliquée.`);
  } else {
    const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${suiviAnomalies}.sql`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
    console.log(`Migration ${suiviAnomalies} appliquée.`);
  }

  // 0026 : garde Mobil de 24 h (08 h–08 h) les week-ends et jours fériés.
  const gardesMobil24h = '0026_mobil_gardes_24h_weekends_feries';
  const gardesMobil24hPresentes = await pool.query('SELECT 1 FROM app_schema_migrations WHERE version = $1', [gardesMobil24h]);
  if (gardesMobil24hPresentes.rowCount) {
    console.log(`Migration ${gardesMobil24h} déjà appliquée.`);
  } else {
    const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${gardesMobil24h}.sql`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
    console.log(`Migration ${gardesMobil24h} appliquée.`);
  }

  // 0027 : index complémentaires pour les lectures historiques et les vues par service.
  const indexPerformance = '0027_indexes_performance_operational';
  const indexPerformancePresent = await pool.query('SELECT 1 FROM app_schema_migrations WHERE version = $1', [indexPerformance]);
  if (indexPerformancePresent.rowCount) {
    console.log(`Migration ${indexPerformance} déjà appliquée.`);
  } else {
    const migrationPath = fileURLToPath(new URL(`../supabase/migrations/${indexPerformance}.sql`, import.meta.url));
    await pool.query(await readFile(migrationPath, 'utf8'));
    console.log(`Migration ${indexPerformance} appliquée.`);
  }

  // L’import nominatif est explicitement séparé des migrations de schéma.
  // Par défaut, une migration ne lit ni ne modifie aucun fichier privé.
  const options = new Set(process.argv.slice(2));
  const previewRegistre = options.has('--preview-registre');
  const applyRegistre = options.has('--apply-registre');
  if (previewRegistre && applyRegistre) throw new Error('Choisissez --preview-registre OU --apply-registre, jamais les deux.');
  if (previewRegistre || applyRegistre) {
    const cheminRegistre = process.env.REGISTRE_INITIAL_SQL?.trim();
    if (!cheminRegistre) throw new Error('Définissez REGISTRE_INITIAL_SQL vers un fichier SQL conservé hors du dépôt.');
    const sqlInitialBrut = await readFile(cheminRegistre, 'utf8');
    // L’import initial est un import, pas un mécanisme de mise à jour du registre courant.
    // Les upserts qui remplaçaient nom/prénom sont convertis en DO NOTHING; les corrections
    // ultérieures passent par l’administration et non par le ré-import d’un fichier d’origine.
    const sqlInitial = sqlInitialBrut
      .replace(/^\s*BEGIN\s*;\s*$/gim, '')
      .replace(/^\s*COMMIT\s*;\s*$/gim, '')
      .replace(/ON\s+CONFLICT\s*\(\s*source_ref\s*\)(?:\s+WHERE\s+source_ref\s+IS\s+NOT\s+NULL)?\s+DO\s+UPDATE\s+SET[\s\S]*?;/ig, 'ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING;');
    if (/\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE)\b/i.test(sqlInitial)) {
      throw new Error('Import refusé : le SQL contient une opération destructive non autorisée.');
    }
    if (!/INSERT\s+INTO\s+agents\b/i.test(sqlInitial)) throw new Error('Import refusé : fichier de registre initial inattendu.');
    const totalAvantR = await pool.query("SELECT count(*)::int AS total FROM agents WHERE source_ref LIKE 'FANN-PHOTO-%'");
    const dejaImportees = Number(totalAvantR.rows[0]?.total ?? 0);
    if (dejaImportees === 54) {
      console.log('Registre initial déjà présent (54 fiches) : aucun ré-import et aucune correction métier écrasée.');
    } else if (dejaImportees !== 0) {
      throw new Error(`Import refusé : registre partiel (${dejaImportees} fiches). Faites vérifier les écarts avant toute intervention.`);
    } else {
      const client = await pool.connect();
      let transaction = false;
      try {
        await client.query('BEGIN'); transaction = true;
        await client.query(sqlInitial);
        const resultat = await client.query("SELECT count(*)::int AS total FROM agents WHERE source_ref LIKE 'FANN-PHOTO-%'");
        const totalImport = Number(resultat.rows[0]?.total ?? 0);
        if (totalImport !== 54) throw new Error(`Import initial incomplet : 54 fiches attendues, ${totalImport} trouvées. Transaction annulée.`);
        if (previewRegistre) {
          await client.query('ROLLBACK'); transaction = false;
          console.log('Aperçu validé : 54 fiches seraient importées. Aucune donnée n’a été conservée. Relancez avec --apply-registre pour appliquer.');
        } else {
          await client.query('COMMIT'); transaction = false;
          console.log('Import initial appliqué : 54 fiches importées dans une transaction.');
        }
      } catch (e) {
        if (transaction) await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    }
  }

  // Valide le résultat même si le marqueur existait déjà : une migration partielle ne doit pas être présentée comme réussie.
  await pool.query('SELECT photo_data_url, profession, adresse, telephone FROM agents LIMIT 0');
  const fiches = await pool.query("SELECT count(*)::int AS total FROM agents WHERE source_ref LIKE 'FANN-PHOTO-%'");
  const totalAgents = Number(fiches.rows[0]?.total ?? 0);
  // 0 = installation sans registre nominatif (autorisé) ; 54 = registre complet ; toute autre valeur = import partiel.
  if (totalAgents !== 0 && totalAgents !== 54) throw new Error(`Registre incomplet : 0 ou 54 fiches photo attendues, ${totalAgents} trouvées. Aucune donnée existante n'a été supprimée.`);
  const listeServices = await pool.query('SELECT count(*)::int AS total FROM services WHERE actif AND nom = ANY($1::text[])', [servicesReferences]);
  const totalServices = Number(listeServices.rows[0]?.total ?? 0);
  if (totalServices !== servicesReferences.length) throw new Error(`Catalogue incomplet : ${servicesReferences.length} services de référence attendus, ${totalServices} trouvés. Vérifiez les migrations et les anciens libellés.`);
  await pool.query('SELECT note_admin, valide_le, motif_validation, cree_par, service_id FROM absences_anomalies LIMIT 0');
  await pool.query('SELECT doit_changer_mot_de_passe FROM identifiants_application LIMIT 0');
  console.log(`Schéma opérationnel vérifié : ${totalAgents} fiche(s) du registre initial, ${totalServices}/20 services, migrations 0013 à 0016, 0018 à 0027 appliquées (ENUM Mobil 0017 vérifié séparément).`);
} finally {
  await pool.end();
}
