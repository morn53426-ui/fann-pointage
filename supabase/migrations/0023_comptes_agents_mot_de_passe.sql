-- 0023 : comptes agents créés automatiquement (matricule + téléphone) et changement de mot de passe obligatoire.
-- Migration additive et idempotente : les comptes existants ne sont pas modifiés (colonne à faux par défaut).
BEGIN;

ALTER TABLE identifiants_application
  ADD COLUMN IF NOT EXISTS doit_changer_mot_de_passe boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN identifiants_application.doit_changer_mot_de_passe IS
  'Vrai tant que l’utilisateur n’a pas remplacé son mot de passe provisoire (compte agent créé avec le téléphone, ou mot de passe réinitialisé par l’administrateur). L’API refuse alors toute route sauf /api/moi, le changement de mot de passe et la déconnexion.';

INSERT INTO app_schema_migrations(version) VALUES ('0023_comptes_agents_mot_de_passe')
ON CONFLICT (version) DO NOTHING;
COMMIT;
