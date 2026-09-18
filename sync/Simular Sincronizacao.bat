@echo off
chcp 65001 >nul
title Simular sincronizacao (nao grava nada)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sync-excel.ps1" -Simular
echo.
pause
