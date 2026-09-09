@echo off
setlocal
chcp 65001 >nul
title Floccus Local
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\menu.ps1"
if errorlevel 1 pause
