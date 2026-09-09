@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-startup.ps1"
if errorlevel 1 pause
pause
