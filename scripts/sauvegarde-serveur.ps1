#requires -Version 5.1
<#
Sauvegarde FANN POINTAGE : pg_dump verifie -> chiffrement AES-256 -> controle de relecture -> copie sur le serveur -> controle d'integrite -> retention.
Destinations (BACKUP_DEST dans .env), une ou plusieurs separees par des points-virgules ; la sauvegarde est envoyee a CHACUNE :
  - partage Windows/NAS : \\SERVEUR\partage\fann
  - serveur Linux (SSH)  : utilisateur@serveur:/chemin/fann
  - exemple des deux    : BACKUP_DEST=\\NAS\partage\fann;sauvegarde@serveur:/srv/fann
Aucune sauvegarde en clair n'est conservee. Code de sortie 0 = succes ; sinon un fichier sauvegardes\ECHEC.txt est cree.
#>
[CmdletBinding()]
param([switch]$SansEnvoi)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$racine = Split-Path -Parent $PSScriptRoot
Set-Location $racine
$dossier = Join-Path $racine 'sauvegardes'
New-Item -ItemType Directory -Force -Path $dossier | Out-Null
$journal = Join-Path $dossier 'sauvegarde.log'
$marqueEchec = Join-Path $dossier 'ECHEC.txt'

function Journal([string]$message) {
  $ligne = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $message
  Add-Content -Path $journal -Value $ligne -Encoding UTF8
  Write-Host $ligne
}

function Lire-Env {
  $valeurs = @{}
  $fichier = Join-Path $racine '.env'
  if (Test-Path $fichier) {
    foreach ($ligne in Get-Content $fichier -Encoding UTF8) {
      if ($ligne -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
        $valeurs[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
      }
    }
  }
  return $valeurs
}

function Valeur($config, [string]$nom, [string]$defaut) {
  if ($config.ContainsKey($nom) -and $config[$nom] -ne '') { return $config[$nom] }
  return $defaut
}

function Sha256([string]$chemin) { return (Get-FileHash -Path $chemin -Algorithm SHA256).Hash.ToLowerInvariant() }

# Envoie la sauvegarde chiffree vers UNE destination, controle l'empreinte a l'arrivee puis applique la retention distante.
function Envoyer([string]$destination) {
  if ($destination -match '^\\\\') {
    if (-not (Test-Path $destination)) { throw "Partage inaccessible : $destination" }
    Copy-Item -Force $enc, "$enc.sha256" -Destination $destination
    $copie = Join-Path $destination $nom
    if ((Sha256 $copie) -ne $empreinte) { throw 'Copie sur le partage corrompue (empreintes differentes).' }
    Get-ChildItem -Path $destination -Filter 'fann-pointage-*.dump.enc' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $garderServeur | ForEach-Object {
      Remove-Item -Force $_.FullName
      Remove-Item -Force "$($_.FullName).sha256" -ErrorAction SilentlyContinue
    }
    Journal "Copie verifiee sur le partage $destination"
  }
  elseif ($destination -match '^[^@\s]+@[^:\s]+:.+$') {
    $i = $destination.IndexOf(':')
    $cible = $destination.Substring(0, $i)
    $chemin = $destination.Substring($i + 1)
    if (-not (Test-Path $cleSsh)) { throw "Cle SSH introuvable : $cleSsh" }
    $optSsh = @('-i', $cleSsh, '-p', $portSsh, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
    $optScp = @('-i', $cleSsh, '-P', $portSsh, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
    & ssh.exe @optSsh $cible ("mkdir -p '{0}'" -f $chemin)
    if ($LASTEXITCODE -ne 0) { throw 'Connexion SSH impossible (cle, empreinte du serveur connue, droits ?).' }
    & scp.exe @optScp $enc "$enc.sha256" ("{0}:{1}/" -f $cible, $chemin)
    if ($LASTEXITCODE -ne 0) { throw 'Copie scp echouee.' }
    $retour = & ssh.exe @optSsh $cible ("sha256sum '{0}/{1}'" -f $chemin, $nom)
    if ($LASTEXITCODE -ne 0) { throw 'Controle distant impossible.' }
    $distant = (([string]$retour).Trim() -split '\s+')[0].ToLowerInvariant()
    if ($distant -ne $empreinte) { throw 'Copie sur le serveur corrompue (empreintes differentes).' }
    $commande = 'cd ''{0}'' && ls -1t fann-pointage-*.dump.enc | tail -n +{1} | while read f; do rm -f -- $f $f.sha256; done' -f $chemin, ($garderServeur + 1)
    & ssh.exe @optSsh $cible $commande
    if ($LASTEXITCODE -ne 0) { Journal 'Avertissement : nettoyage distant non effectue.' }
    Journal "Copie verifiee sur le serveur $cible"
  }
  else {
    throw "Destination non reconnue : $destination (attendu \\\\SERVEUR\partage ou utilisateur@serveur:/chemin)."
  }
}

try {
  $cfg = Lire-Env
  $dest = Valeur $cfg 'BACKUP_DEST' ''
  $destinations = @($dest -split ';' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
  $fichierCle = Valeur $cfg 'BACKUP_PASSPHRASE_FILE' (Join-Path $env:USERPROFILE 'fann-backup\backup.key')
  $cleSsh = Valeur $cfg 'BACKUP_SSH_KEY' (Join-Path $env:USERPROFILE '.ssh\fann_backup')
  $portSsh = Valeur $cfg 'BACKUP_SSH_PORT' '22'
  $garderLocal = [int](Valeur $cfg 'BACKUP_KEEP_LOCAL' '14')
  $garderServeur = [int](Valeur $cfg 'BACKUP_KEEP_REMOTE' '60')
  if ($garderLocal -lt 1 -or $garderServeur -lt 1) { throw 'BACKUP_KEEP_LOCAL et BACKUP_KEEP_REMOTE doivent etre >= 1.' }
  if (-not $SansEnvoi -and $dest -eq '') { throw 'BACKUP_DEST est vide dans .env (ex. \\SERVEUR\partage\fann et/ou sauvegarde@serveur:/srv/fann, separes par ;). Utilisez -SansEnvoi pour un essai local.' }

  # Git pour Windows fournit bash et openssl (et evite le bash de WSL).
  $bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
  $openssl = Join-Path $env:ProgramFiles 'Git\usr\bin\openssl.exe'
  foreach ($outil in @($bash, $openssl)) { if (-not (Test-Path $outil)) { throw "Outil introuvable : $outil (installez Git pour Windows)." } }
  if (-not (Test-Path $fichierCle)) { throw "Phrase secrete introuvable : $fichierCle (lancez scripts\installer-sauvegarde.ps1)." }

  Journal 'Debut de la sauvegarde.'
  $tmp = Join-Path $dossier 'tmp'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null

  # 1. Dump verifie (pg_restore --list) dans un dossier temporaire.
  & $bash 'scripts/sauvegarde-postgres.sh' 'sauvegardes/tmp' '1'
  if ($LASTEXITCODE -ne 0) { throw "pg_dump a echoue (code $LASTEXITCODE). Docker et le conteneur db sont-ils demarres ?" }
  $dump = Get-ChildItem -Path $tmp -Filter 'fann-pointage-*.dump' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($null -eq $dump -or $dump.Length -le 0) { throw 'Aucun dump produit.' }

  # 2. Chiffrement AES-256 (phrase secrete lue dans un fichier, jamais en ligne de commande).
  $nom = $dump.BaseName + '.dump.enc'
  $enc = Join-Path $dossier $nom
  & $openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 -md sha256 -in $dump.FullName -out "$enc.tmp" -pass "file:$fichierCle"
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$enc.tmp")) { throw 'Chiffrement echoue.' }

  # 3. Controle de relecture : on dechiffre et on compare l'empreinte avec le dump d'origine.
  $relu = Join-Path $tmp 'relecture.dump'
  & $openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in "$enc.tmp" -out $relu -pass "file:$fichierCle"
  if ($LASTEXITCODE -ne 0) { throw 'Dechiffrement de controle echoue.' }
  if ((Sha256 $relu) -ne (Sha256 $dump.FullName)) { throw 'Le controle de relecture differe : sauvegarde rejetee.' }
  Move-Item -Force "$enc.tmp" $enc
  $empreinte = Sha256 $enc
  Set-Content -Path "$enc.sha256" -Value "$empreinte  $nom" -Encoding ASCII
  Remove-Item -Recurse -Force $tmp   # supprime les copies en clair
  Journal ("Sauvegarde chiffree : {0} ({1} octets)" -f $nom, (Get-Item $enc).Length)

  # 4. Retention locale.
  Get-ChildItem -Path $dossier -Filter 'fann-pointage-*.dump.enc' | Sort-Object LastWriteTime -Descending | Select-Object -Skip $garderLocal | ForEach-Object {
    Remove-Item -Force $_.FullName
    Remove-Item -Force "$($_.FullName).sha256" -ErrorAction SilentlyContinue
  }
  $enClair = Get-ChildItem -Path $dossier -Filter 'fann-pointage-*.dump' -ErrorAction SilentlyContinue
  if ($enClair) { Journal 'ATTENTION : des sauvegardes anciennes NON chiffrees existent dans sauvegardes\ ; chiffrez-les ou supprimez-les.' }

  # 5. Envoi vers chaque destination : un echec n'empeche pas l'envoi vers les autres, mais fait echouer la tache.
  if ($SansEnvoi) {
    Journal 'Envoi ignore (-SansEnvoi).'
  }
  else {
    $erreurs = @()
    foreach ($d in $destinations) {
      try { Envoyer $d }
      catch {
        $erreurs += ('{0} : {1}' -f $d, $_.Exception.Message)
        Journal ('ECHEC envoi vers {0} : {1}' -f $d, $_.Exception.Message)
      }
    }
    if ($erreurs.Count -gt 0) { throw ('Envoi echoue vers : ' + ($erreurs -join ' | ')) }
  }

  if (Test-Path $marqueEchec) { Remove-Item -Force $marqueEchec }
  Journal 'Sauvegarde terminee avec succes.'
  exit 0
}
catch {
  $msg = $_.Exception.Message
  Journal "ECHEC : $msg"
  Set-Content -Path $marqueEchec -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $msg) -Encoding UTF8
  exit 1
}
