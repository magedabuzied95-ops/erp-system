@echo off
setlocal

for %%I in ("%~dp0..") do set "ROOT=%%~fI"

start "" /min cmd /d /c ""%ROOT%\server\run-backend.cmd""
start "" /min cmd /d /c ""%ROOT%\scripts\run-frontend.cmd""

echo [dev-all] launched backend and frontend
