@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-hidden.ps1"
if errorlevel 1 pause
