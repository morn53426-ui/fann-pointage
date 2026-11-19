-- 0010 : alignement du calendrier de service général et index de révocation des badges.
-- Reprise sans perte : la valeur historique exacte Mon-Ven correspond au défaut antérieur.
ALTER TABLE parametres_regime_general
  DROP CONSTRAINT IF EXISTS pas_de_dimanche;
ALTER TABLE parametres_regime_general
  ALTER COLUMN jours_travailles SET DEFAULT '{1,2,3,4,5,6,7}';
UPDATE parametres_regime_general
  SET jours_travailles = ARRAY[1,2,3,4,5,6,7]::smallint[]
  WHERE jours_travailles = ARRAY[1,2,3,4,5]::smallint[];

-- Un identifiant de badge/version distinct de l'agent permet de révoquer une carte perdue sans
-- désactiver son titulaire. Le secret en clair ne doit jamais être conservé dans PostgreSQL.
CREATE TABLE IF NOT EXISTS badges_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agents(id),
  token_hash text NOT NULL UNIQUE,
  version integer NOT NULL CHECK (version > 0),
  actif boolean NOT NULL DEFAULT true,
  emis_par uuid REFERENCES profiles(user_id),
  emis_le timestamptz NOT NULL DEFAULT now(),
  revoque_par uuid REFERENCES profiles(user_id),
  revoque_le timestamptz,
  motif_revocation text,
  CONSTRAINT badge_revocation_complete CHECK (
    (actif AND revoque_le IS NULL AND revoque_par IS NULL)
    OR (NOT actif AND revoque_le IS NOT NULL AND revoque_par IS NOT NULL AND nullif(btrim(motif_revocation), '') IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS badges_agents_un_seul_actif
  ON badges_agents(agent_id) WHERE actif;
ALTER TABLE badges_agents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON badges_agents FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON badges_agents TO service_role;
