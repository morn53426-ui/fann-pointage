-- 0011 : rapprochement du schéma SQL et du modèle de pointage de l'application.
-- Cette migration prépare le dépôt PostgreSQL ; elle ne raccorde pas à elle seule l'API.

ALTER TABLE pointages
  ADD COLUMN IF NOT EXISTS poste_code text,
  ADD COLUMN IF NOT EXISTS captured_ts timestamptz,
  ADD COLUMN IF NOT EXISTS qr_token_id uuid REFERENCES qr_tokens(id);

COMMENT ON COLUMN pointages.poste_code IS
  'Identifiant métier du poste du moteur de régime (texte, non confondu avec plannings.id).';
COMMENT ON COLUMN pointages.captured_ts IS
  'Heure capturée sur un appareil hors ligne ; non fiable tant que le pointage n''est pas validé manuellement.';
COMMENT ON COLUMN pointages.qr_token_id IS
  'Référence au QR dynamique utilisé. Le secret brut du QR ne doit jamais être stocké.';

CREATE INDEX IF NOT EXISTS pointages_agent_poste_code_ts
  ON pointages (agent_id, poste_code, server_ts);
CREATE INDEX IF NOT EXISTS pointages_qr_token_id
  ON pointages (qr_token_id) WHERE qr_token_id IS NOT NULL;

-- Le pointage et la consommation du QR sont dans la même transaction PostgreSQL.
-- La clé primaire (token_id, agent_id) de qr_token_uses arbitre aussi les scans concurrents.
CREATE OR REPLACE FUNCTION consommer_qr_au_pointage() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_zone_id uuid;
  v_issued_at timestamptz;
  v_expires_at timestamptz;
BEGIN
  IF NEW.qr_token_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT zone_id, issued_at, expires_at
    INTO v_zone_id, v_issued_at, v_expires_at
    FROM qr_tokens
    WHERE id = NEW.qr_token_id
    FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR inconnu' USING ERRCODE = '23503';
  END IF;
  IF NEW.zone_id IS DISTINCT FROM v_zone_id THEN
    RAISE EXCEPTION 'Le QR ne correspond pas à la zone du pointage' USING ERRCODE = '23514';
  END IF;
  IF NEW.server_ts < v_issued_at OR NEW.server_ts >= v_expires_at THEN
    RAISE EXCEPTION 'QR expiré ou pas encore actif à l''heure du pointage' USING ERRCODE = '23514';
  END IF;

  INSERT INTO qr_token_uses (token_id, agent_id, used_at)
    VALUES (NEW.qr_token_id, NEW.agent_id, NEW.server_ts);
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'QR déjà utilisé par cet agent' USING ERRCODE = '23505', CONSTRAINT = 'qr_token_uses_pkey';
END
$$;

DROP TRIGGER IF EXISTS pointages_consomment_qr ON pointages;
CREATE TRIGGER pointages_consomment_qr
  AFTER INSERT ON pointages
  FOR EACH ROW EXECUTE FUNCTION consommer_qr_au_pointage();
