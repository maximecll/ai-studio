@echo off
rem Attend que le serveur reponde, puis ouvre le navigateur.
rem
rem Lance en tache de fond par le lanceur : celui-ci garde le serveur au
rem premier plan, pour que fermer sa fenetre arrete bien tout.

if "%PORT%"=="" set "PORT=5300"
set "URL=http://127.0.0.1:%PORT%"

for /l %%i in (1,1,120) do (
  curl -fsS --max-time 2 "%URL%" >nul 2>&1
  if not errorlevel 1 (
    start "" "%URL%"
    exit /b 0
  )
  ping -n 2 127.0.0.1 >nul
)
exit /b 1
