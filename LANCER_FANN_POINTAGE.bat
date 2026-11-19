@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
echo ================================================
echo FANN POINTAGE - REGISTRE POSTGRESQL
echo ================================================
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERREUR : Node.js 22.23.4 ou superieur doit etre installe.
  pause
  exit /b 1
)
where docker >nul 2>nul
if errorlevel 1 (
  echo ERREUR : Docker n'est pas installe ou n'est pas dans PATH.
  echo Installez et demarrez Docker Desktop, puis relancez ce fichier.
  pause
  exit /b 1
)
if not exist ".env" (
  echo Creation d'une configuration locale avec des secrets aleatoires...
  node scripts/init-env.mjs
  if errorlevel 1 (
    echo ERREUR : impossible de creer .env. Verifiez les droits du dossier.
    pause
    exit /b 1
  )
)
findstr /B /C:"FANN_MODE=postgres-catalogue" .env >nul
if errorlevel 1 (
  echo ERREUR : le fichier .env n'est pas configure en mode catalogue PostgreSQL.
  echo Ouvrez .env et mettez FANN_MODE=postgres-catalogue.
  start /wait notepad .env
  findstr /B /C:"FANN_MODE=postgres-catalogue" .env >nul
  if errorlevel 1 (
    echo Le mode est toujours incorrect. Aucun conteneur n'a ete lance.
    pause
    exit /b 1
  )
)
findstr /I /C:"replace_me" /C:"REMPLACER_" .env >nul
if not errorlevel 1 (
  echo ERREUR : .env contient encore des valeurs provisoires replace_me / REMPLACER_...
  echo Configurez les secrets avant de continuer.
  pause
  exit /b 1
)
if not exist "node_modules\pg" (
  echo Installation des dependances Node.js necessaires aux migrations...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo ERREUR : npm install a echoue.
    pause
    exit /b 1
  )
)
docker compose config >nul
if errorlevel 1 (
  echo ERREUR : configuration Compose invalide. Verifiez .env sans en partager le contenu.
  pause
  exit /b 1
)
echo Demarrage de PostgreSQL...
docker compose up --build -d db
if errorlevel 1 (
  echo ERREUR : impossible de demarrer PostgreSQL. Consultez : docker compose logs --tail=80 db
  pause
  exit /b 1
)
echo Attente du demarrage de la base...
for /L %%I in (1,1,60) do (
  docker compose exec -T db pg_isready -q >nul 2>&1
  if not errorlevel 1 goto DB_READY
  timeout /t 2 /nobreak >nul
)
echo ERREUR : PostgreSQL ne repond pas encore.
echo Verifiez : docker compose ps et docker compose logs --tail=100 db
pause
exit /b 1
:DB_READY
echo Application de la migration idempotente du registre...
call npm run migrate:catalogue
if errorlevel 1 (
  echo ERREUR : migration echouee. Ne supprimez pas le volume PostgreSQL.
  pause
  exit /b 1
)
echo Verification du compte administrateur admin ^(cree seulement s'il est absent^)...
call npm run admin:postgres -- admin --si-absent
if errorlevel 1 (
  echo ERREUR : creation/verification du compte admin impossible. Verifiez ADMIN_INITIAL_MOT_DE_PASSE ^(9 caracteres minimum, pas une suite comme 123456789^) dans .env.
  pause
  exit /b 1
)
echo Demarrage de FANN POINTAGE...
docker compose up --build -d app
if errorlevel 1 (
  echo ERREUR : le serveur ne demarre pas. Consultez les journaux.
  docker compose logs --tail=80 app
  pause
  exit /b 1
)
echo.
docker compose ps -a
echo.
echo Ouvrez http://127.0.0.1:8787
 echo.
echo Connexion : admin ; mot de passe local : ADMIN_INITIAL_MOT_DE_PASSE dans .env
echo Le compte admin est cree automatiquement s'il est absent ; un compte existant n'est jamais modifie.
echo Les fonctions de pointage/planning sont encore en phase de migration ; ce catalogue n'est pas le pointage complet de production.
echo.
pause
