@echo off
setlocal
set "SERVER_ROOT=%~dp0.."
"%SERVER_ROOT%\node.exe" "%SERVER_ROOT%\src\server.js" status
if errorlevel 1 pause
pause
