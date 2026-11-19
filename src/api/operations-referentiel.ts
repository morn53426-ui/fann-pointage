// Référentiel opérationnel PostgreSQL : jours fériés, badges des agents (émission, révocation, renouvellement) et zones de pointage / QR.
// Extrait d'operations-postgres.ts ; même logique, mêmes requêtes SQL, mêmes droits et même journal d'audit.
import { ErreurRegime } from "../shared/types.ts";
import { emettreQr, emettreQrPermanent, hashToken } from "../pointage/qr.ts";
import type { Utilisateur } from "./magasin.ts";
import type { Requete } from "./routes.ts";
import { exigeRole, exigeUuid, mapSqlErreur, num, obj, pgCode, txt, valideDate } from "./operations-communs.ts";
import type { ContexteOps } from "./operations-communs.ts";

export async function listerFeries(ops: ContexteOps, user: Utilisateur) { exigeRole(user,"administrateur","responsable"); const r=await ops.pool.query(`SELECT date_ferie::text AS date,libelle AS nom,NULL::text AS note FROM jours_feries WHERE actif ORDER BY date_ferie`); return {joursFeries:r.rows}; }
export async function creerFerie(ops: ContexteOps, req: Requete,user: Utilisateur) {
  exigeRole(user,"administrateur"); const c=obj(req.corps); const date=valideDate(c.date,"Date du jour férié"); const nom=typeof c.nom==="string"?c.nom.replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,120):"";
  if(!nom) throw new ErreurRegime("requete_invalide","Le nom du jour férié est obligatoire.");
  const cl=await ops.pool.connect(); let tx=false;
  try { await cl.query("BEGIN");tx=true;
    await cl.query(`INSERT INTO jours_feries(date_ferie,libelle,actif) VALUES($1::date,$2,true)`,[date,nom]);
    // Les postes sans pointage sont annulés. Les postes déjà pointés restent en place et sont audités pour revue humaine.
    const annules=await cl.query(`UPDATE plannings p SET statut='annule',motif=$2,modifie_par=$3::uuid WHERE p.regime='general' AND p.starts_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Dakar') AND p.starts_at < (($1::date+1)::timestamp AT TIME ZONE 'Africa/Dakar') AND p.statut='prevu' AND NOT EXISTS(SELECT 1 FROM pointages x WHERE x.planning_id=p.id) RETURNING p.id`,[date,`Jour férié enregistré : ${nom}`,user.id]);
    const preserves=await cl.query(`SELECT p.id::text AS id FROM plannings p WHERE p.regime='general' AND p.starts_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Dakar') AND p.starts_at < (($1::date+1)::timestamp AT TIME ZONE 'Africa/Dakar') AND EXISTS(SELECT 1 FROM pointages x WHERE x.planning_id=p.id)`,[date]);
    await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,nouvelle_valeur,motif,ip) VALUES($1,'jour_ferie_cree','jours_feries',$2,$3::jsonb,$4,$5)`,[user.id,date,JSON.stringify({date,nom,postesAnnules:annules.rowCount??annules.rows.length,postesAvecPointageAExaminer:preserves.rows.map(x=>x.id)}),"Enregistrement d’un jour férié",req.ip]);
    await cl.query("COMMIT");tx=false;
    return {succes:true,jourFerie:{date,nom,note:typeof c.note==="string"?c.note.trim().slice(0,300):null},impactPlanning:{retires:annules.rowCount??annules.rows.length,aExaminer:preserves.rows.map(x=>txt(x.id))},message:"Jour férié enregistré dans PostgreSQL. Les postes déjà pointés sont conservés pour examen."};
  } catch(e){if(tx) await cl.query("ROLLBACK").catch(()=>{});if(pgCode(e)) mapSqlErreur(e);throw e;} finally{cl.release();}
}
export async function supprimerFerie(ops: ContexteOps, dateBrut:string,user:Utilisateur) {
  exigeRole(user,"administrateur"); const date=valideDate(dateBrut,"Date");
  const r=await ops.pool.query(`UPDATE jours_feries SET actif=false WHERE date_ferie=$1::date AND actif RETURNING date_ferie`,[date]);
  if(!r.rowCount) throw new ErreurRegime("introuvable","Jour férié introuvable.");
  await ops.audit(user.id,"jour_ferie_desactive","jours_feries",date,{date,actif:false},"Désactivation du jour férié"); return {succes:true};
}

export async function listerBadges(ops: ContexteOps, user: Utilisateur) {
  exigeRole(user, "administrateur");
  // GET est sans effet de bord : l'émission/révocation/renouvellement est explicite et auditée.
  const r=await ops.pool.query(`SELECT a.id::text AS "agentId",a.prenom,a.nom,a.matricule,a.photo_data_url AS "photoDataUrl",a.profession,a.adresse,a.telephone,
      af.service_id::text AS "serviceId",s.nom AS service,af.regime::text AS regime,b.version,b.actif AS "badgeActif"
    FROM agents a JOIN LATERAL(SELECT service_id,regime FROM agent_affectations WHERE agent_id=a.id
      AND date_debut <= (now() AT TIME ZONE 'Africa/Dakar')::date
      AND(date_fin IS NULL OR date_fin>(now() AT TIME ZONE 'Africa/Dakar')::date)
      ORDER BY date_debut DESC LIMIT 1) af ON true
    JOIN services s ON s.id=af.service_id JOIN badges_agents b ON b.agent_id=a.id AND b.actif
    WHERE a.actif ORDER BY s.nom,a.nom,a.prenom`);
  return {badges:r.rows.map((x)=>({...x,badgeCode:`FANN-BADGE:${txt(x.agentId)}:${ops.tokenBadge(txt(x.agentId),num(x.version))}`})),source:"postgresql",fictif:false,
    note:"Seuls les badges actifs sont affichés. L'émission, la révocation et le renouvellement sont explicites et inscrits au journal d'audit."};
}

export async function emettreBadge(ops: ContexteOps, agentId:string,user:Utilisateur,ip:string) {
  exigeRole(user,"administrateur"); exigeUuid(agentId,"Agent");
  const cl=await ops.pool.connect();let tx=false;
  try {
    await cl.query("BEGIN");tx=true;
    const a=await cl.query(`SELECT id::text AS id FROM agents WHERE id=$1::uuid AND actif FOR UPDATE`,[agentId]);
    if(!a.rows[0]) throw new ErreurRegime("introuvable","Agent actif introuvable.");
    const actif=await cl.query(`SELECT id FROM badges_agents WHERE agent_id=$1::uuid AND actif FOR UPDATE`,[agentId]);
    if(actif.rows[0]) throw new ErreurRegime("conflit","Un badge actif existe déjà. Utilisez le renouvellement si le badge doit être remplacé.");
    const version=num((await cl.query(`SELECT COALESCE(max(version),0)+1 AS version FROM badges_agents WHERE agent_id=$1::uuid`,[agentId])).rows[0]?.version);
    const token=ops.tokenBadge(agentId,version);
    const ins=await cl.query(`INSERT INTO badges_agents(agent_id,token_hash,version,actif,emis_par) VALUES($1::uuid,$2,$3,true,$4::uuid) RETURNING id::text AS id`,[agentId,hashToken(token),version,user.id]);
    await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,nouvelle_valeur,motif,ip) VALUES($1,'badge_emis','badges_agents',$2,$3::jsonb,$4,$5)`,[user.id,agentId,JSON.stringify({badgeId:ins.rows[0]?.id,version}),"Émission d’un badge actif",ip]);
    await cl.query("COMMIT");tx=false;
    return {succes:true,badgeCode:`FANN-BADGE:${agentId}:${token}`,message:"Badge émis et enregistré dans PostgreSQL. Imprimez-le et remettez-le à son titulaire."};
  } catch(e) {
    if(tx) await cl.query("ROLLBACK").catch(()=>{});
    if(e instanceof ErreurRegime) throw e;
    if(pgCode(e)) mapSqlErreur(e);
    throw e;
  } finally {cl.release();}
}

export async function revoquerBadge(ops: ContexteOps, agentId:string,user:Utilisateur,ip:string,now:Date) {
  exigeRole(user,"administrateur"); exigeUuid(agentId,"Agent");
  const cl=await ops.pool.connect();let tx=false;
  try {
    await cl.query("BEGIN");tx=true;
    const b=await cl.query(`SELECT id::text AS id,version FROM badges_agents WHERE agent_id=$1::uuid AND actif FOR UPDATE`,[agentId]);
    const badge=b.rows[0];
    if(!badge) throw new ErreurRegime("introuvable","Aucun badge actif à révoquer pour cet agent.");
    await cl.query(`UPDATE badges_agents SET actif=false,revoque_par=$2::uuid,revoque_le=$3,motif_revocation='Révocation demandée par l’administration' WHERE id=$1::uuid`,[badge.id,user.id,now]);
    await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,ancienne_valeur,nouvelle_valeur,motif,ip) VALUES($1,'badge_revoque','badges_agents',$2,$3::jsonb,$4::jsonb,$5,$6)`,[user.id,agentId,JSON.stringify({badgeId:badge.id,version:num(badge.version),actif:true}),JSON.stringify({badgeId:badge.id,actif:false}),"Révocation du badge sans désactivation de l’agent",ip]);
    await cl.query("COMMIT");tx=false;
    return {succes:true,message:"Badge révoqué. L’agent reste actif et ses historiques sont conservés ; un nouvel identifiant peut être émis séparément."};
  } catch(e) {
    if(tx) await cl.query("ROLLBACK").catch(()=>{});
    if(e instanceof ErreurRegime) throw e;
    if(pgCode(e)) mapSqlErreur(e);
    throw e;
  } finally {cl.release();}
}

export async function renouvelerBadge(ops: ContexteOps, agentId:string,user:Utilisateur,ip:string,now:Date) {
  exigeRole(user,"administrateur"); exigeUuid(agentId,"Agent");
  const cl=await ops.pool.connect(); let tx=false;
  try { await cl.query("BEGIN");tx=true;
    const a=await cl.query(`SELECT id::text AS id FROM agents WHERE id=$1::uuid AND actif FOR UPDATE`,[agentId]);if(!a.rows[0]) throw new ErreurRegime("introuvable","Agent actif introuvable.");
    const ancien=await cl.query(`SELECT id::text AS id,version FROM badges_agents WHERE agent_id=$1::uuid AND actif FOR UPDATE`,[agentId]);
    const version=num((await cl.query(`SELECT COALESCE(max(version),0)+1 AS version FROM badges_agents WHERE agent_id=$1::uuid`,[agentId])).rows[0]?.version);
    if(ancien.rows[0]) await cl.query(`UPDATE badges_agents SET actif=false,revoque_par=$2::uuid,revoque_le=$3,motif_revocation='Renouvellement demandé par l’administration' WHERE id=$1::uuid`,[ancien.rows[0].id,user.id,now]);
    const token=ops.tokenBadge(agentId,version); const ins=await cl.query(`INSERT INTO badges_agents(agent_id,token_hash,version,actif,emis_par) VALUES($1::uuid,$2,$3,true,$4::uuid) RETURNING id::text AS id`,[agentId,hashToken(token),version,user.id]);
    await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,ancienne_valeur,nouvelle_valeur,motif,ip) VALUES($1,'badge_renouvele','badges_agents',$2,$3::jsonb,$4::jsonb,$5,$6)`,[user.id,agentId,JSON.stringify({badge:ancien.rows[0]?.id??null}),JSON.stringify({badge:ins.rows[0]?.id,version}),"Révocation de l’ancien badge et émission d’un nouveau",ip]);
    await cl.query("COMMIT");tx=false; return {succes:true,badgeCode:`FANN-BADGE:${agentId}:${token}`,message:"Ancien badge révoqué. Le nouveau badge est actif ; réimprimez-le."};
  } catch(e){if(tx) await cl.query("ROLLBACK").catch(()=>{});if(e instanceof ErreurRegime) throw e;if(pgCode(e)) mapSqlErreur(e);throw e;} finally{cl.release();}
}

export async function listerZones(ops: ContexteOps, req: Requete, user:Utilisateur) {
  exigeRole(user,"administrateur","responsable");
  // L'administrateur peut afficher aussi les zones désactivées (pour les réactiver) : ?inclureInactives=1.
  const inclureInactives=user.role==="administrateur"&&req.requete.inclureInactives==="1";
  const sql=user.role==="administrateur"
    ? `SELECT z.id::text AS id,z.nom,z.service_id::text AS "serviceId",s.nom AS service,z.actif FROM zones_pointage z JOIN services s ON s.id=z.service_id ${inclureInactives?"":"WHERE z.actif "}ORDER BY s.nom,z.nom`
    : `SELECT z.id::text AS id,z.nom,z.service_id::text AS "serviceId",s.nom AS service,z.actif FROM zones_pointage z JOIN services s ON s.id=z.service_id WHERE z.actif AND z.service_id=ANY($1::uuid[]) ORDER BY s.nom,z.nom`;
  const r=await ops.pool.query(sql,user.role==="administrateur"?[]:[user.servicesGeres]); return {zones:r.rows,source:"postgresql"};
}
export async function creerZone(ops: ContexteOps, req:Requete,user:Utilisateur) {
  exigeRole(user,"administrateur"); const c=obj(req.corps);const nom=typeof c.nom==="string"?c.nom.trim().replace(/\s+/g," ").slice(0,100):"";const serviceId=exigeUuid(c.serviceId,"Service");const lat=Number(c.latitude),lng=Number(c.longitude),rayon=Number(c.rayonM??150),precision=Number(c.precisionMaxM??50);
  if(!nom||!Number.isFinite(lat)||lat < -90||lat>90||!Number.isFinite(lng)||lng < -180||lng>180||!Number.isInteger(rayon)||rayon<20||rayon>5000||!Number.isInteger(precision)||precision<10||precision>1000) throw new ErreurRegime("requete_invalide","Nom, coordonnées et rayons de zone invalides.");
  // Audit v31 F-06 : l'insertion et son journal d'audit sont atomiques (BEGIN … COMMIT / ROLLBACK), comme les badges.
  const cl=await ops.pool.connect();let tx=false;
  try {
    await cl.query("BEGIN");tx=true;
    const r=await cl.query(`INSERT INTO zones_pointage(nom,service_id,latitude,longitude,rayon_m,precision_max_m,cree_par) SELECT $1,$2::uuid,$3,$4,$5,$6,$7::uuid WHERE EXISTS(SELECT 1 FROM services WHERE id=$2::uuid AND actif) RETURNING id::text AS id,nom,service_id::text AS "serviceId",actif`,[nom,serviceId,lat,lng,rayon,precision,user.id]);
    if(!r.rows[0]) throw new ErreurRegime("introuvable","Service actif introuvable.");
    await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,nouvelle_valeur,motif,ip) VALUES($1::uuid,'zone_pointage_creee','zones_pointage',$2,$3::jsonb,$4,$5)`,[user.id,txt(r.rows[0].id),JSON.stringify({nom,serviceId,rayonM:rayon,precisionMaxM:precision}),"Création d’une zone de pointage",req.ip]);
    await cl.query("COMMIT");tx=false;
    return {zone:r.rows[0],message:"Zone de pointage enregistrée."};
  } catch(e){
    if(tx) await cl.query("ROLLBACK").catch(()=>{});
    if(e instanceof ErreurRegime) throw e;
    if(pgCode(e)) mapSqlErreur(e);
    throw e;
  } finally {cl.release();}
}

/**
 * Audit v31 F-05 : désactivation / réactivation d'une zone (révocation d'une affiche QR perdue ou volée).
 * Administrateur seul, motif obligatoire, transaction + audit. Une zone désactivée refuse tout pointage (zone_inactive)
 * et n'émet plus de QR ; toutes les affiches de cette zone cessent donc de fonctionner.
 */
export async function modifierEtatZone(ops: ContexteOps, zoneIdBrut:string, req:Requete, user:Utilisateur) {
  exigeRole(user,"administrateur");const zoneId=exigeUuid(zoneIdBrut,"Zone");const c=obj(req.corps);
  if(typeof c.actif!=="boolean") throw new ErreurRegime("requete_invalide","Indiquez « actif » : true (réactiver) ou false (désactiver).");
  const motif=typeof c.motif==="string"?c.motif.replace(/[\u0000-\u001f\u007f]/g," ").trim().replace(/\s+/g," ").slice(0,300):"";
  if(motif.length<3) throw new ErreurRegime("requete_invalide","Un motif d’au moins 3 caractères est obligatoire.");
  const cl=await ops.pool.connect();let tx=false;
  try {
    await cl.query("BEGIN");tx=true;
    const r=await cl.query(`SELECT id::text AS id,nom,actif FROM zones_pointage WHERE id=$1::uuid FOR UPDATE`,[zoneId]);
    const z=r.rows[0];
    if(!z) throw new ErreurRegime("introuvable","Zone introuvable.");
    if(z.actif===c.actif){await cl.query("ROLLBACK");tx=false;return {zone:{id:txt(z.id),nom:txt(z.nom),actif:c.actif},message:c.actif?"La zone est déjà active.":"La zone est déjà désactivée."};}
    await cl.query(`UPDATE zones_pointage SET actif=$2 WHERE id=$1::uuid`,[zoneId,c.actif]);
    await cl.query(`INSERT INTO journal_audit(user_id,action,objet_table,objet_id,ancienne_valeur,nouvelle_valeur,motif,ip) VALUES($1::uuid,$2,'zones_pointage',$3,$4::jsonb,$5::jsonb,$6,$7)`,[user.id,c.actif?"zone_pointage_reactivee":"zone_pointage_desactivee",zoneId,JSON.stringify({actif:z.actif===true}),JSON.stringify({actif:c.actif,zone:txt(z.nom)}),motif,req.ip]);
    await cl.query("COMMIT");tx=false;
    return {zone:{id:zoneId,nom:txt(z.nom),actif:c.actif},message:c.actif?"Zone réactivée : ses affiches QR fonctionnent de nouveau.":"Zone désactivée : ses affiches QR sont révoquées (plus aucun pointage possible par ce QR)."};
  } catch(e){
    if(tx) await cl.query("ROLLBACK").catch(()=>{});
    if(e instanceof ErreurRegime) throw e;
    if(pgCode(e)) mapSqlErreur(e);
    throw e;
  } finally {cl.release();}
}
export async function genererQr(ops: ContexteOps, req:Requete,user:Utilisateur,now:Date) {
  exigeRole(user,"administrateur","responsable");const zoneId=exigeUuid(req.requete.zoneId,"Zone");
  const r=await ops.pool.query(`SELECT id::text AS id,nom,service_id::text AS "serviceId" FROM zones_pointage WHERE id=$1::uuid AND actif`,[zoneId]);const z=r.rows[0];if(!z) throw new ErreurRegime("introuvable","Zone active introuvable.");if(user.role==="responsable"&&!user.servicesGeres.includes(txt(z.serviceId))) throw new ErreurRegime("non_autorise","Cette zone est hors de votre périmètre.");
  if(req.requete.permanent==="1"){const p=emettreQrPermanent({zoneId,secret:ops.secretQr});await ops.audit(user.id,"qr_permanent_emis","zones_pointage",zoneId,{zone:txt(z.nom)},"Émission du QR permanent d’une zone",req.ip);return {token:p.token,permanent:true,expireLe:null,zone:txt(z.nom),serviceId:txt(z.serviceId)};}
  const qr=emettreQr({zoneId,secret:ops.secretQr,maintenant:now,dureeS:60});await ops.pool.query(`INSERT INTO qr_tokens(zone_id,token_hash,issued_at,expires_at) VALUES($1::uuid,$2,$3,$4)`,[zoneId,qr.tokenHash,qr.issuedAt,qr.expiresAt]);return {token:qr.token,expireLe:qr.expiresAt.toISOString(),zone:txt(z.nom)};
}
