-- 0013 : catalogue des 20 services (liste papier) et colonnes de rattachement ; ne contient aucune donnée nominative.
-- Idempotent : prévu pour une base existante et pour l'initialisation Docker d'une base neuve.
BEGIN;

CREATE TABLE IF NOT EXISTS app_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS source_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS agents_source_ref_uq ON agents(source_ref) WHERE source_ref IS NOT NULL;

-- Canonicalise les anciens libellés vers les noms de services visibles sur la liste papier.
-- Les agents « SG » restent dans leur service principal; leur régime est porté par l'affectation individuelle.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('Neurologie - hospitalisation', 'Neurologie/Hospitalisation'),
    ('Neurologie - consultation externe', 'Neurologie/Consultation externe'),
    ('Réanimation polyvalente', 'Réa polyvalente'),
    ('Service général - CTCV', 'CTCV'),
    ('CDIM', 'CDIM/SG'),
    ('Unité mobile', 'Mobile')
  ) AS aliases(ancien, nouveau)
  LOOP
    IF EXISTS (SELECT 1 FROM services WHERE nom = r.ancien)
       AND NOT EXISTS (SELECT 1 FROM services WHERE nom = r.nouveau) THEN
      UPDATE services SET nom = r.nouveau WHERE nom = r.ancien;
    ELSIF EXISTS (SELECT 1 FROM services WHERE nom = r.ancien)
       AND EXISTS (SELECT 1 FROM services WHERE nom = r.nouveau) THEN
      UPDATE services ancien SET actif = false
      WHERE ancien.nom = r.ancien
        AND NOT EXISTS (
          SELECT 1 FROM agent_affectations aa JOIN agents a ON a.id = aa.agent_id
          WHERE aa.service_id = ancien.id AND a.actif AND aa.date_fin IS NULL
        );
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS services_nom_ci_uq ON services (lower(btrim(nom)));

-- Les 20 noms de services sont repris des en-têtes de la liste papier.
-- Le registre nominatif est conservé hors dépôt et importé uniquement par une procédure explicite (docs/IMPORT_REGISTRE.md).
INSERT INTO services (nom, regime_defaut, actif) VALUES
  ('Accueil urgences', 'urgences', true),
  ('Pneumologie', 'garde', true),
  ('Neurologie/Hospitalisation', 'garde', true),
  ('Neurologie/Consultation externe', 'garde', true),
  ('Neurochirurgie', 'garde', true),
  ('ORL', 'garde', true),
  ('Maladies infectieuses', 'garde', true),
  ('Gériatrie', 'garde', true),
  ('Kinésie', 'garde', true),
  ('Réa polyvalente', 'garde', true),
  ('CTCV', 'garde', true),
  ('Cardiologie médicale', 'garde', true),
  ('CDIM/SG', 'general', true),
  ('Chirurgie plastique', 'general', true),
  ('Psychiatrie', 'general', true),
  ('Imagerie', 'general', true),
  ('Morgue', 'garde', true),
  ('Mobile', 'garde', true),
  ('SSI', 'garde', true),
  ('Superviseur', 'general', true)
ON CONFLICT (nom) DO NOTHING;

-- Aucune donnée nominative d’agent n’est intégrée à cette migration.
INSERT INTO app_schema_migrations(version) VALUES ('0013_catalogue_reel_agents_services')
ON CONFLICT (version) DO NOTHING;
COMMIT;
