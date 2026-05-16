@echo off
cd /d "%~dp0"
node server.js >> "%~dp0..\runtime-logs\backend-launch.log" 2>&1
