import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const adminUrl = process.env.DATABASE_ADMIN_URL?.trim() ?? '';
const password = process.env.POSTGRES_APP_PASSWORD ?? '';
const user = process.env.POSTGRES_APP_USER?.trim() || 'fann_app';
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL est obligatoire pour configurer le rôle runtime sur une base déjà initialisée.');
if (user !== 'fann_app') throw new Error('POSTGRES_APP_USER doit être fann_app.');
if (!/^[A-Za-z0-9_-]{32,}$/.test(password)) throw new Error('POSTGRES_APP_PASSWORD doit être un secret URL-safe (base64url) d’au moins 32 caractères.');
const sslMode = process.env.PGSSL?.trim().toLowerCase();
if (sslMode && sslMode !== 'require') throw new Error("PGSSL accepte uniquement 'require' ou une valeur vide.");
const pool = new Pool({ connectionString: adminUrl, max: 1, connectionTimeoutMillis: 8000,
  ...(sslMode === 'require' ? { ssl: { rejectUnauthorized: true } } : {}),
  application_name: 'fann-pointage-configurer-role-runtime' });
const literal = (v) => `'${v.replace(/'/g, "''")}'`;
try {
  const present = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = 'fann_app'");
  const definition = `WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT PASSWORD ${literal(password)}`;
  if (present.rowCount) await pool.query(`ALTER ROLE fann_app ${definition}`);
  else await pool.query(`CREATE ROLE fann_app ${definition}`);
  const grants = await readFile(fileURLToPath(new URL('./grant-runtime-role.sql', import.meta.url)), 'utf8');
  await pool.query(grants);
  const verify = await pool.query(`SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname='fann_app'`);
  const r = verify.rows[0];
  if (!r || r.rolsuper || r.rolcreatedb || r.rolcreaterole || r.rolbypassrls) throw new Error('La vérification des privilèges du rôle fann_app a échoué. Le compte ne doit pas être superutilisateur ni contourner la RLS.');
  await pool.query('SELECT 1 FROM identifiants_application LIMIT 0');
  await pool.query('SELECT 1 FROM profiles LIMIT 0');
  await pool.query('SELECT 1 FROM agents LIMIT 0');
  await pool.query('SELECT 1 FROM services LIMIT 0');
  console.log('Rôle runtime fann_app configuré et vérifié : NOSUPERUSER, NOCREATEDB, NOCREATEROLE ; droits de table limités.');
} finally { await pool.end(); }
