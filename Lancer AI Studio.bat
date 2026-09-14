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

set "NODE_VERSION=22.12.0"
set "RUNTIME=%CD%\.runtime"
if "%PORT%"=="" set "PORT=5300"
set "URL=http://127.0.0.1:%PORT%"

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
rem  On reconstruit si le build manque. Windows n'a pas d'equivalent simple
rem  a `find -newer` : on se contente de l'absence, et `npm run build` reste
rem  disponible a la main si besoin.
if not exist "dist\index.html" (
  echo.
  echo   [ Construction de l'interface ]
  echo.
  call npm run build
  if errorlevel 1 goto :echec_build
)

rem ---- 4 ---- Serveur --------------------------------------------------
rem  On retient le PID : a la fermeture, on n'arrete que ce serveur-la et
rem  non tous les node.exe de la machine.
echo.
echo   [ Demarrage du serveur ]
set "SRVPID="
for /f "delims=" %%p in ('powershell -NoProfile -Command "(Start-Process node -ArgumentList 'server.mjs' -PassThru -WindowStyle Hidden).Id" 2^>nul') do set "SRVPID=%%p"
if not defined SRVPID start "" /b node server.mjs

rem  Attendre que le port reponde avant d'ouvrir le navigateur.
set "PRET="
for /l %%i in (1,1,60) do (
  if not defined PRET (
    curl -fsS --max-time 2 "%URL%" >nul 2>&1
    if not errorlevel 1 set "PRET=1"
    if not defined PRET ping -n 2 127.0.0.1 >nul
  )
)
if not defined PRET goto :echec_serveur

rem ---- 5 ---- Navigateur -----------------------------------------------
echo   Ouverture de %URL%
start "" "%URL%"

echo.
echo   AI Studio est ouvert dans votre navigateur.
echo.
echo   Fermez cette fenetre pour arreter AI Studio.
echo.
pause >nul
if defined SRVPID (
  taskkill /f /t /pid %SRVPID% >nul 2>&1
) else (
  taskkill /f /im node.exe >nul 2>&1
)
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

:echec_serveur
echo.
echo   ECHEC : le serveur n'a pas demarre.
goto :fin_erreur

:fin_erreur
echo.
echo   Fenetre laissee ouverte pour que vous puissiez lire.
pause >nul
exit /b 1
