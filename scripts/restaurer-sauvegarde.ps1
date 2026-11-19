#requires -Version 5.1
<#
Dechiffre une sauvegarde .dump.enc, verifie son empreinte puis la restaure.
  .\scripts\restaurer-sauvegarde.ps1                       -> test sur une base jetable (derniere sauvegarde locale)
  .\scripts\restaurer-sauvegarde.ps1 -Fichier X.dump.enc   -> test d'un fichier precis (ex. copie recuperee du serveur)
  .\scripts\restaurer-sauvegarde.ps1 -Production           -> REMPLACE la base reelle (confirmation demandee)
#>
[CmdletBinding()]
param([string]$Fichier = '', [switch]$Production)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$racine = Split-Path -Parent $PSScriptRoot
Set-Location $racine
$dossier = Join-Path $racine 'sauvegardes'

$cfg = @{}
$fichierEnv = Join-Path $racine '.env'
if (Test-Path $fichierEnv) {
  foreach ($ligne in Get-Content $fichierEnv -Encoding UTF8) {
    if ($ligne -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') { $cfg[$Matches[1]] = $Matches[2].Trim('"').Trim("'") }
  }
}
$fichierCle = Join-Path $env:USERPROFILE 'fann-backup\backup.key'
if ($cfg.ContainsKey('BACKUP_PASSPHRASE_FILE') -and $cfg['BACKUP_PASSPHRASE_FILE'] -ne '') { $fichierCle = $cfg['BACKUP_PASSPHRASE_FILE'] }

$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
$openssl = Join-Path $env:ProgramFiles 'Git\usr\bin\openssl.exe'
foreach ($outil in @($bash, $openssl)) { if (-not (Test-Path $outil)) { throw "Outil introuvable : $outil" } }
if (-not (Test-Path $fichierCle)) { throw "Phrase secrete introuvable : $fichierCle" }

if ($Fichier -eq '') {
  $dernier = Get-ChildItem -Path $dossier -Filter 'fann-pointage-*.dump.enc' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($null -eq $dernier) { throw 'Aucune sauvegarde chiffree dans sauvegardes\.' }
  $Fichier = $dernier.FullName
}
if (-not (Test-Path $Fichier)) { throw "Fichier introuvable : $Fichier" }
$Fichier = (Resolve-Path $Fichier).Path

# Empreinte (si le fichier .sha256 est a cote).
$fichierSha = "$Fichier.sha256"
if (Test-Path $fichierSha) {
  $attendu = ((Get-Content $fichierSha -Encoding ASCII | Select-Object -First 1) -split '\s+')[0].ToLowerInvariant()
  $reel = (Get-FileHash -Path $Fichier -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($attendu -ne $reel) { throw 'Empreinte differente : la sauvegarde est corrompue.' }
  Write-Host 'Empreinte SHA-256 conforme.'
} else {
  Write-Host 'Pas de fichier .sha256 : controle d''empreinte ignore.'
}

if ($Production) {
  Write-Host ''
  Write-Host 'ATTENTION : la base REELLE va etre remplacee par cette sauvegarde. Les pointages faits depuis seront perdus.' -ForegroundColor Yellow
  $reponse = Read-Host 'Tapez RESTAURER pour confirmer'
  if ($reponse -cne 'RESTAURER') { Write-Host 'Annule.'; exit 0 }
}

$tmp = Join-Path $dossier 'tmp-restauration'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  $dump = Join-Path $tmp 'restauration.dump'
  & $openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -in $Fichier -out $dump -pass "file:$fichierCle"
  if ($LASTEXITCODE -ne 0) { throw 'Dechiffrement impossible (mauvaise phrase secrete ou fichier corrompu).' }
  $mode = 'test'
  if ($Production) { $mode = 'production' }
  & $bash 'scripts/restaurer-sauvegarde.sh' 'sauvegardes/tmp-restauration/restauration.dump' $mode
  if ($LASTEXITCODE -ne 0) { throw "La restauration a echoue (code $LASTEXITCODE)." }
}
finally {
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
}
