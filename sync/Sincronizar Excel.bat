@echo off
chcp 65001 >nul
title Sincronizar planilha com o site
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-excel.ps1" %*
echo.
pause
