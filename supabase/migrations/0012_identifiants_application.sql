-- 0012 : identifiants natifs pour le serveur Node (transition depuis les comptes en mémoire).
-- Aucun mot de passe en clair. Les sessions sont signées par l'API et liées à session_version.
-- Cette table n'est pas exposée aux rôles clients `anon` / `authenticated`.

CREATE TABLE identifiants_application (
  user_id uuid PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  identifiant text NOT NULL,
  mot_de_passe_hash text NOT NULL,
  session_version integer NOT NULL DEFAULT 0 CHECK (session_version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identifiant_application_format CHECK (
    identifiant = btrim(identifiant)
    AND char_length(identifiant) BETWEEN 3 AND 80
    AND identifiant !~ '[[:cntrl:]]'
  ),
  CONSTRAINT identifiant_application_hash_scrypt CHECK (
    mot_de_passe_hash ~ '^scrypt\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$'
  )
);

CREATE UNIQUE INDEX identifiants_application_identifiant_normalise_uq
  ON identifiants_application (lower(identifiant));

ALTER TABLE identifiants_application ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON identifiants_application FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON identifiants_application TO service_role;

COMMENT ON TABLE identifiants_application IS
  'Identifiants réservés au serveur de l’application. Le hash est scrypt; session_version révoque les sessions signées. Ne jamais exposer cette table à un client.';
COMMENT ON COLUMN identifiants_application.session_version IS
  'Incrémentée lors d’un changement de mot de passe, d’une révocation ou d’une désactivation pour invalider les jetons en cours.';
