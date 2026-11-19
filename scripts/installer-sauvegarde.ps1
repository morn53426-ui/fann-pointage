#requires -Version 5.1
<#
Prepare les sauvegardes : cree la phrase secrete de chiffrement (hors du projet) et planifie la sauvegarde a 02:00 et 13:00.
A lancer une fois :  powershell -ExecutionPolicy Bypass -File scripts\installer-sauvegarde.ps1
#>
[CmdletBinding()]
param([string]$Heures = '02:00,13:00')

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$racine = Split-Path -Parent $PSScriptRoot

# 1. Phrase secrete (48 octets aleatoires) hors du dossier du projet, lisible par l'utilisateur courant seulement.
$dossierCle = Join-Path $env:USERPROFILE 'fann-backup'
$cle = Join-Path $dossierCle 'backup.key'
New-Item -ItemType Directory -Force -Path $dossierCle | Out-Null
if (-not (Test-Path $cle)) {
  $octets = New-Object byte[] 48
  $alea = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $alea.GetBytes($octets)
  [Convert]::ToBase64String($octets) | Set-Content -Path $cle -NoNewline -Encoding ASCII
  & icacls.exe $cle /inheritance:r /grant:r ('{0}:(R,W)' -f $env:USERNAME) | Out-Null
  Write-Host ''
  Write-Host 'Phrase secrete creee :' $cle -ForegroundColor Green
  Write-Host 'COPIEZ CE FICHIER SUR UN SUPPORT SEPARE (cle USB gardee en lieu sur, coffre de mots de passe).' -ForegroundColor Yellow
  Write-Host 'Sans lui, TOUTES les sauvegardes sont illisibles. Ne le mettez pas sur le meme serveur que les sauvegardes.' -ForegroundColor Yellow
} else {
  Write-Host 'Phrase secrete deja presente :' $cle
}

# 2. Taches planifiees (session de l'utilisateur ; Docker Desktop doit etre demarre et le PC allume).
$script = Join-Path $racine 'scripts\sauvegarde-serveur.ps1'
$argument = '-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $script
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory $racine
$declencheurs = @()
foreach ($h in ($Heures -split ',')) { $declencheurs += New-ScheduledTaskTrigger -Daily -At $h.Trim() }
$reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'FANN-Sauvegarde' -Action $action -Trigger $declencheurs -Settings $reglages -Description 'Sauvegarde chiffree FANN POINTAGE vers le serveur' -Force | Out-Null
Write-Host ('Tache planifiee FANN-Sauvegarde creee ({0}).' -f $Heures) -ForegroundColor Green
# 3. Supervision toutes les 15 minutes (application, disque, sauvegarde).
$scriptSurveillance = Join-Path $racine 'scripts\surveiller.ps1'
$actionSurv = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $scriptSurveillance) -WorkingDirectory $racine
$declencheurSurv = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Days 3650)
$reglagesSurv = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'FANN-Surveillance' -Action $actionSurv -Trigger $declencheurSurv -Settings $reglagesSurv -Description 'Supervision FANN POINTAGE (application, disque, sauvegardes)' -Force | Out-Null
Write-Host 'Tache planifiee FANN-Surveillance creee (toutes les 15 minutes).' -ForegroundColor Green
Write-Host 'Essai immediat :  powershell -ExecutionPolicy Bypass -File scripts\sauvegarde-serveur.ps1'
