-- 0024 : expiration du mot de passe provisoire (compte agent créé avec le téléphone, ou mot de passe réinitialisé par l'administrateur).
-- Migration additive et idempotente. La date est posée/effacée par un déclencheur : aucune requête applicative à modifier.
BEGIN;

ALTER TABLE identifiants_application
  ADD COLUMN IF NOT EXISTS provisoire_depuis timestamptz;

COMMENT ON COLUMN identifiants_application.provisoire_depuis IS
  'Date à laquelle le mot de passe provisoire a été posé ; NULL si le mot de passe est définitif. L’API refuse la connexion et le changement au-delà de 7 jours : l’administrateur doit réinitialiser le mot de passe.';

CREATE OR REPLACE FUNCTION fann_provisoire_depuis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.doit_changer_mot_de_passe IS NOT TRUE THEN
    NEW.provisoire_depuis := NULL;
  ELSIF TG_OP = 'INSERT'
     OR OLD.doit_changer_mot_de_passe IS DISTINCT FROM TRUE
     OR NEW.mot_de_passe_hash IS DISTINCT FROM OLD.mot_de_passe_hash
     OR NEW.provisoire_depuis IS NULL THEN
    NEW.provisoire_depuis := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fann_provisoire_depuis ON identifiants_application;
CREATE TRIGGER trg_fann_provisoire_depuis
  BEFORE INSERT OR UPDATE ON identifiants_application
  FOR EACH ROW EXECUTE FUNCTION fann_provisoire_depuis();

-- Comptes déjà provisoires : le délai de 7 jours démarre à l'application de cette migration.
UPDATE identifiants_application SET provisoire_depuis = now()
WHERE doit_changer_mot_de_passe AND provisoire_depuis IS NULL;

INSERT INTO app_schema_migrations(version) VALUES ('0024_mot_de_passe_provisoire_expiration')
ON CONFLICT (version) DO NOTHING;
COMMIT;
