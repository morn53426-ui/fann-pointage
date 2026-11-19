-- 0008 : protections du classement mensuel et écritures réservées au serveur
-- Une photographie publiée est un historique immuable : les corrections se font par une nouvelle période/version de traitement hors de cette table.
create trigger classement_mensuel_immuable before update or delete on classements_mensuels
  for each row execute function forbid_change();

-- Les clients authentifiés peuvent lire selon leur rôle, mais ne calculent ni ne modifient les scores et classements.
revoke insert, update, delete, truncate on parametres_scores, scores_mensuels, classements_mensuels from authenticated;
revoke insert, update, delete, truncate on parametres_scores, scores_mensuels, classements_mensuels from anon;
grant select, insert, update, delete on parametres_scores, scores_mensuels, classements_mensuels to service_role;
