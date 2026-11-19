#requires -Version 5.1
<#
Supervision FANN POINTAGE (toutes les 15 min via la tache planifiee FANN-Surveillance) :
  - l'application repond-elle (/readyz) ?  - disque presque plein ?  - derniere sauvegarde recente (< 26 h) et sans ECHEC.txt ?
Alertes : journal sauvegardes\surveillance.log, fenetre Windows (msg.exe, si disponible) et webhook facultatif (ALERT_WEBHOOK_URL dans .env,
compatible Slack/Teams/Mattermost/Google Chat : JSON {"text": "..."}). Pas de spam : meme probleme = rappel toutes les 6 h au plus.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$racine = Split-Path -Parent $PSScriptRoot
$dossier = Join-Path $racine 'sauvegardes'
New-Item -ItemType Directory -Force -Path $dossier | Out-Null
$journal = Join-Path $dossier 'surveillance.log'
$fichierEtat = Join-Path $dossier 'surveillance.etat.json'

function Journal([string]$message) {
  Add-Content -Path $journal -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $message) -Encoding UTF8
}

$cfg = @{}
$fichierEnv = Join-Path $racine '.env'
if (Test-Path $fichierEnv) {
  foreach ($ligne in Get-Content $fichierEnv -Encoding UTF8) {
    if ($ligne -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') { $cfg[$Matches[1]] = $Matches[2].Trim('"').Trim("'") }
  }
}
$port = '8787'
if ($cfg.ContainsKey('APP_PORT') -and $cfg['APP_PORT'] -ne '') { $port = $cfg['APP_PORT'] }
$webhook = ''
if ($cfg.ContainsKey('ALERT_WEBHOOK_URL')) { $webhook = $cfg['ALERT_WEBHOOK_URL'] }

function Alerter([string]$texte) {
  Journal $texte
  try { & (Join-Path $env:SystemRoot 'System32\msg.exe') '*' '/TIME:900' $texte 2>$null } catch { }
  if ($webhook -ne '') {
    try {
      $corps = (@{ text = $texte } | ConvertTo-Json -Compress)
      Invoke-RestMethod -Uri $webhook -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($corps)) -TimeoutSec 15 | Out-Null
    } catch { Journal ('Webhook injoignable : ' + $_.Exception.Message) }
  }
}

$problemes = New-Object System.Collections.ArrayList

# 1. Application
try {
  $reponse = Invoke-WebRequest -Uri ('http://127.0.0.1:{0}/readyz' -f $port) -UseBasicParsing -TimeoutSec 10
  if ($reponse.StatusCode -ne 200 -or $reponse.Content -notmatch 'ready') { [void]$problemes.Add('L''application repond mais n''est pas prete (/readyz).') }
} catch {
  [void]$problemes.Add('Application injoignable : verifiez Docker Desktop (docker compose ps).')
}

# 2. Disque
try {
  $lecteur = Get-PSDrive -Name ((Get-Item $racine).PSDrive.Name)
  $libre = [double]$lecteur.Free
  $total = [double]($lecteur.Used + $lecteur.Free)
  if ($libre -lt 5GB -or ($total -gt 0 -and ($libre / $total) -lt 0.10)) {
    [void]$problemes.Add(('Disque presque plein : {0:N1} Go libres.' -f ($libre / 1GB)))
  }
} catch { }

# 3. Sauvegardes
if (Test-Path (Join-Path $dossier 'ECHEC.txt')) { [void]$problemes.Add('La derniere sauvegarde a echoue (voir sauvegardes\ECHEC.txt).') }
$derniere = Get-ChildItem -Path $dossier -Filter 'fann-pointage-*.dump.enc' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $derniere) { [void]$problemes.Add('Aucune sauvegarde chiffree trouvee.') }
elseif (((Get-Date) - $derniere.LastWriteTime).TotalHours -gt 26) { [void]$problemes.Add(('Derniere sauvegarde trop ancienne ({0:N0} h).' -f ((Get-Date) - $derniere.LastWriteTime).TotalHours)) }

# Etat precedent : evite de renvoyer la meme alerte a chaque passage.
$etat = @{ signature = ''; dernier = '' }
if (Test-Path $fichierEtat) { try { $lu = Get-Content $fichierEtat -Raw -Encoding UTF8 | ConvertFrom-Json; $etat.signature = [string]$lu.signature; $etat.dernier = [string]$lu.dernier } catch { } }
$signature = ($problemes -join ' | ')

if ($problemes.Count -eq 0) {
  if ($etat.signature -ne '') { Alerter 'FANN POINTAGE : retour a la normale.' }
  @{ signature = ''; dernier = '' } | ConvertTo-Json | Set-Content -Path $fichierEtat -Encoding UTF8
  exit 0
}

$rappel = $true
if ($etat.signature -eq $signature -and $etat.dernier -ne '') {
  $rappel = (((Get-Date) - [datetime]::Parse($etat.dernier, [Globalization.CultureInfo]::InvariantCulture)).TotalHours -ge 6)
}
if ($rappel) {
  Alerter ('FANN POINTAGE - ALERTE : ' + $signature)
  @{ signature = $signature; dernier = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Path $fichierEtat -Encoding UTF8
}
exit 1
