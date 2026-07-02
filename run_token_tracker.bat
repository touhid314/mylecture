@echo off
setlocal

cd /d "%~dp0"

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 1200; Start-Process 'http://127.0.0.1:4317/'"
call npm run token-tracker %*

if errorlevel 1 pause
