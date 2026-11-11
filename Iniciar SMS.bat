@echo off
chcp 65001 >nul
title SMS · S.A.G.A. (AIFA)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No se encontró Node.js. Instálalo desde https://nodejs.org y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
if not exist ".env" (
  echo.
  echo   Falta la configuración. Primero abre "Instalar en otra computadora.bat".
  echo.
  pause
  exit /b 1
)

rem Si el SMS ya está en marcha en el puerto 3000, solo se abre la pantalla de acceso
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo.
  echo   El SMS ya está en marcha. Abriendo la pantalla de acceso...
  start "" "http://localhost:3000/login"
  timeout /t 3 >nul
  exit /b 0
)

echo.
echo   Iniciando el SMS en http://localhost:3000
echo   No cierres esta ventana mientras lo uses. Para apagarlo, ciérrala.
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process 'http://localhost:3000/login'"
node app.js
echo.
echo   El SMS se detuvo.
pause
