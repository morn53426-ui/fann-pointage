param(
  [Parameter(Mandatory=$true)]
  [string]$Fichier,
  [switch]$ConfirmerRemplacement
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not $ConfirmerRemplacement) {
  throw 'Restauration destructive refusée. Relancez avec -ConfirmerRemplacement après avoir sauvegardé les données actuelles.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker est introuvable. Installez et démarrez Docker Desktop.'
}
$source = (Resolve-Path -LiteralPath $Fichier).Path
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Fichier de sauvegarde introuvable.' }
try {
  $data = Get-Content -LiteralPath $source -Raw | ConvertFrom-Json
  if ($data.version -notin @(1,2,3,4) -or $data.pointages -isnot [array] -or $data.journal -isnot [array]) {
    throw 'Schéma de sauvegarde non reconnu.'
  }
} catch { throw "Sauvegarde invalide : $($_.Exception.Message)" }
$checksum = "$source.sha256"
if (Test-Path -LiteralPath $checksum) {
  $ligne = (Get-Content -LiteralPath $checksum -Raw).Trim()
  $attendu = ($ligne -split '\s+')[0].ToUpperInvariant()
  $observe = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($attendu -ne $observe) { throw 'Le SHA-256 ne correspond pas. Restauration annulée.' }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$avant = Join-Path (Get-Location) "backups/avant-restauration-$stamp.json"
New-Item -ItemType Directory -Force -Path (Split-Path $avant) | Out-Null
& docker compose cp 'app:/data/pointages-demo.json' $avant 2>$null
if ($LASTEXITCODE -ne 0) { Write-Warning 'Impossible de créer une copie de sécurité depuis le conteneur. Vérifiez manuellement avant de poursuivre.' }
& docker compose stop app
if ($LASTEXITCODE -ne 0) { throw 'Arrêt du service app impossible.' }
try {
  & docker compose cp $source 'app:/data/pointages-demo.json'
  if ($LASTEXITCODE -ne 0) { throw 'Copie de la sauvegarde dans le conteneur impossible.' }
  & docker compose start app
  if ($LASTEXITCODE -ne 0) { throw 'Redémarrage de l’application impossible.' }
  Write-Host 'Restauration copiée. Vérifiez /healthz, les fiches, les pointages et les journaux avant toute utilisation.' -ForegroundColor Green
} catch {
  Write-Error $_
  throw 'Restauration interrompue. Ne supprimez aucune sauvegarde ; restaurez la copie de sécurité si nécessaire.'
}
