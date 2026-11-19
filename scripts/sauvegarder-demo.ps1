param(
  [string]$DossierSauvegarde = "backups"
)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker est introuvable. Installez et démarrez Docker Desktop."
}
& docker compose ps app *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose n'est pas disponible depuis le dossier du projet." }
& docker compose exec -T app sh -lc 'test -s /data/pointages-demo.json' *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Aucun fichier de données local n'est encore présent. Créez ou modifiez une fiche/absence/planning puis réessayez."
}

$rep = Join-Path (Get-Location) $DossierSauvegarde
New-Item -ItemType Directory -Force -Path $rep | Out-Null
$horodatage = Get-Date -Format "yyyyMMdd-HHmmss"
$destination = Join-Path $rep "fann-pointage-demo-$horodatage.json"
& docker compose cp "app:/data/pointages-demo.json" $destination
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $destination)) {
  throw "La copie de sauvegarde a échoué. Vérifiez les journaux Docker et l'espace disque."
}
try {
  $donnees = Get-Content -LiteralPath $destination -Raw | ConvertFrom-Json
  if ($donnees.version -notin @(1, 2, 3, 4) -or $donnees.pointages -isnot [array] -or $donnees.journal -isnot [array]) {
    throw "Le fichier copié ne ressemble pas à une sauvegarde FANN POINTAGE valide."
  }
} catch {
  Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
  throw "La sauvegarde a été copiée mais n'a pas pu être validée : $($_.Exception.Message)"
}
$hash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
Set-Content -LiteralPath "$destination.sha256" -Value "$hash  $(Split-Path $destination -Leaf)" -Encoding ascii
Write-Host "Sauvegarde de démonstration vérifiée : $destination" -ForegroundColor Green
Write-Host "SHA-256 : $hash"
Write-Warning "Cette sauvegarde couvre le fichier JSON local de démonstration uniquement. Ce n'est ni une sauvegarde PostgreSQL, ni un mécanisme automatique ou chiffré. Protégez ce fichier comme des données personnelles."
