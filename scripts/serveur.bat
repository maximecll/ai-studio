@echo off
rem Boucle de supervision du serveur AI Studio.
rem
rem Le serveur sort avec le code 75 quand il vient d'appliquer une mise a
rem jour : on le relance aussitot. Tout autre code arrete la boucle.

cd /d "%~dp0.."
chcp 65001 >nul
if exist ".runtime\node\node.exe" set "PATH=%CD%\.runtime\node;%PATH%"
if exist ".runtime\git\cmd\git.exe" set "PATH=%CD%\.runtime\git\cmd;%PATH%"
set "AI_STUDIO_SUPERVISED=1"

:boucle
node server.mjs
rem `if errorlevel N` signifie "au moins N" : deux tests pour isoler 75.
if errorlevel 75 if not errorlevel 76 goto boucle
exit /b 0
