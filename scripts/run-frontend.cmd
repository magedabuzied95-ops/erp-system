@echo off
cd /d "%~dp0\.."
if not exist "runtime-logs" mkdir "runtime-logs"
npm.cmd run dev >> "runtime-logs\frontend-launch.log" 2>&1
