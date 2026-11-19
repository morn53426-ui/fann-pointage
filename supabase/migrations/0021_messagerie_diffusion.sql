-- 0021 : messagerie persistante (diffusion générale) et suivi de lecture.
-- Migration additive : aucune donnée métier existante n'est supprimée ou modifiée.
BEGIN;

CREATE TABLE IF NOT EXISTS messages_diffusion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 3 AND 120),
  contenu text NOT NULL CHECK (length(btrim(contenu)) BETWEEN 1 AND 4000),
  auteur_user_id uuid NOT NULL REFERENCES profiles(user_id),
  cree_le timestamptz NOT NULL DEFAULT now(),
  archive_le timestamptz,
  CONSTRAINT messages_diffusion_archive_apres_creation CHECK (archive_le IS NULL OR archive_le >= cree_le)
);
CREATE INDEX IF NOT EXISTS messages_diffusion_recent_idx ON messages_diffusion (cree_le DESC) WHERE archive_le IS NULL;

CREATE TABLE IF NOT EXISTS messages_lectures (
  message_id uuid NOT NULL REFERENCES messages_diffusion(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  lu_le timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS messages_lectures_user_idx ON messages_lectures (user_id, lu_le DESC);

ALTER TABLE messages_diffusion ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages_lectures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON messages_diffusion, messages_lectures FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON messages_diffusion TO service_role;
GRANT SELECT, INSERT ON messages_lectures TO service_role;

-- Les politiques du rôle runtime sont appliquées par scripts/grant-runtime-role.sql après les migrations.
-- La migration peut ainsi être exécutée avant la création du rôle fann_app.

INSERT INTO app_schema_migrations(version) VALUES ('0021_messagerie_diffusion')
ON CONFLICT (version) DO NOTHING;
COMMIT;
