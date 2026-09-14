@echo off
setlocal enabledelayedexpansion
rem ====================================================================
rem  Demarrage d'AI Studio sous Windows.
rem
rem  Double-cliquez ce fichier. Rien a installer au prealable, rien a
rem  taper. Node.js est recupere dans un sous-dossier du projet s'il
rem  manque : aucun droit administrateur, aucun PATH modifie.
rem
rem  curl et tar sont fournis par Windows 10 (1803) et Windows 11.
rem ====================================================================

cd /d "%~dp0"

rem  Page de codes UTF-8 : sans elle, les accents des messages du serveur
rem  s'affichent en caracteres illisibles dans cette fenetre.
chcp 65001 >nul

set "NODE_VERSION=22.12.0"
set "RUNTIME=%CD%\.runtime"
if "%PORT%"=="" set "PORT=5300"
set "URL=http://127.0.0.1:%PORT%"
set "AI_STUDIO_ROOT=%CD%"

echo.
echo   AI Studio
echo   %CD%
echo.

rem ---- 1 ---- Node.js -------------------------------------------------
if exist "%RUNTIME%\node\node.exe" set "PATH=%RUNTIME%\node;%PATH%"

set "NODE_OK="
for /f "delims=" %%v in ('node -e "process.stdout.write(process.versions.node.split('.')[0])" 2^>nul') do (
  if %%v GEQ 20 set "NODE_OK=1"
)

if defined NODE_OK (
  for /f "delims=" %%v in ('node --version 2^>nul') do echo   Node.js %%v - deja present
) else (
  echo.
  echo   [ Installation de Node.js ]
  echo   Environ 50 Mo, dans .\.runtime - rien en dehors du projet.
  echo.

  set "ARCH=x64"
  if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
  set "NAME=node-v%NODE_VERSION%-win-!ARCH!"

  if not exist "%RUNTIME%" mkdir "%RUNTIME%"
  curl -fL --progress-bar "https://nodejs.org/dist/v%NODE_VERSION%/!NAME!.zip" -o "%RUNTIME%\node.zip"
  if errorlevel 1 goto :echec_reseau

  if exist "%RUNTIME%\node" rmdir /s /q "%RUNTIME%\node"
  tar -xf "%RUNTIME%\node.zip" -C "%RUNTIME%"
  if errorlevel 1 goto :echec_archive
  move "%RUNTIME%\!NAME!" "%RUNTIME%\node" >nul
  del /q "%RUNTIME%\node.zip"

  set "PATH=%RUNTIME%\node;%PATH%"
  node --version >nul 2>&1
  if errorlevel 1 goto :echec_node
  for /f "delims=" %%v in ('node --version') do echo   Node.js %%v installe
)

rem ---- 2 ---- Dependances ---------------------------------------------
if not exist "node_modules" (
  echo.
  echo   [ Installation des dependances ]
  echo   Quelques minutes la premiere fois, puis jamais plus.
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :echec_npm
)

rem ---- 3 ---- Interface ------------------------------------------------
rem  Windows n'a pas d'equivalent simple a `find -newer` : on note le commit
rem  construit dans dist\.build. Sans ca, un `git pull` a la main laissait
rem  l'ancienne interface en place.
set "REBUILD="
set "HEADSHA="
for /f "delims=" %%h in ('git rev-parse HEAD 2^>nul') do set "HEADSHA=%%h"
set "BUILTSHA="
if exist "dist\.build" set /p BUILTSHA=<"dist\.build"
if not exist "dist\index.html" set "REBUILD=1"
if defined HEADSHA if not "%HEADSHA%"=="%BUILTSHA%" set "REBUILD=1"

if defined REBUILD (
  echo.
  echo   [ Construction de l'interface ]
  echo.
  call npm run build
  if errorlevel 1 goto :echec_build
  if defined HEADSHA echo %HEADSHA%> "dist\.build"
)

rem ---- 4 ---- Git -----------------------------------------------------
rem  Git portable recupere par l'application : il prime sur celui du systeme.
if exist "%RUNTIME%\git\cmd\git.exe" set "PATH=%RUNTIME%\git\cmd;%PATH%"

rem  Non bloquant : l'application tourne sans git, mais ne peut plus se
rem  mettre a jour. Windows ne le fournit pas d'origine.
git --version >nul 2>&1
if errorlevel 1 (
  echo.
  echo   git est introuvable - les mises a jour seront indisponibles.
  echo   Installez-le depuis Reglages ^> Mises a jour, en un clic.
)

rem ---- 5 ---- Restes d'une session precedente -------------------------
rem  Un node ou un Ollama oublie verrouille .runtime : le dossier devient
rem  alors impossible a supprimer. On balaie avant de repartir.
call :nettoyer

rem ---- 6 ---- Navigateur ------------------------------------------------
rem  Ouvert des que le port repond, sans bloquer cette fenetre.
start "" /b cmd /c "scripts\ouvrir.bat"

rem ---- 7 ---- Serveur --------------------------------------------------
rem  Au premier plan, dans CETTE fenetre : la fermer arrete le serveur et
rem  Ollama avec lui. Aucun processus ne survit a la croix rouge.
echo.
echo   [ Demarrage du serveur ]
echo.
echo   %URL%
echo.
echo   Fermez cette fenetre pour arreter AI Studio.
echo.
call "scripts\serveur.bat"

call :nettoyer
echo.
echo   AI Studio est arrete.
echo.
pause >nul
exit /b 0

rem ---- Nettoyage -------------------------------------------------------
:nettoyer
rem  Ne vise que les processus lances depuis CE dossier : un Ollama installe
rem  par ailleurs sur la machine n'est pas touche.
powershell -NoProfile -Command "$d=[regex]::Escape($env:AI_STUDIO_ROOT); Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'ollama.exe' -or $_.Name -eq 'node.exe') -and ((($_.ExecutablePath) -and $_.ExecutablePath -match $d) -or (($_.CommandLine) -and $_.CommandLine -match $d)) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
exit /b 0

rem ---- Erreurs ---------------------------------------------------------
:echec_reseau
echo.
echo   ECHEC : telechargement de Node.js impossible.
echo   Verifiez votre connexion, puis relancez ce fichier.
goto :fin_erreur

:echec_archive
echo.
echo   ECHEC : archive Node.js illisible.
echo   Supprimez le dossier .runtime, puis relancez.
goto :fin_erreur

:echec_node
echo.
echo   ECHEC : Node.js installe mais introuvable. Signalez-le.
goto :fin_erreur

:echec_npm
echo.
echo   ECHEC : installation des dependances.
echo   Faites defiler vers le haut pour voir la cause.
goto :fin_erreur

:echec_build
echo.
echo   ECHEC : construction de l'interface.
echo   Faites defiler vers le haut pour voir la cause.
goto :fin_erreur

:fin_erreur
echo.
echo   Fenetre laissee ouverte pour que vous puissiez lire.
pause >nul
exit /b 1
