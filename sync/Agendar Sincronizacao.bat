@echo off
chcp 65001 >nul
title Agendar sincronizacao a cada 15 minutos
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0agendar.ps1" %*
echo.
pause
