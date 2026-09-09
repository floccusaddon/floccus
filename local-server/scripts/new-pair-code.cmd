@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0new-pair-code.ps1"
if errorlevel 1 pause
pause
