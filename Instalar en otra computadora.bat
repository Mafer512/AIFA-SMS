@echo off
chcp 65001 >nul
title Instalar el SMS · S.A.G.A. (AIFA)
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No se encontró Node.js. Instálalo desde https://nodejs.org y vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

node instalacion\instalar.js
echo.
pause
