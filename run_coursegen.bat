@echo off
setlocal

cd /d "%~dp0"

if not defined COURSEGEN_UI_PORT set "COURSEGEN_UI_PORT=3940"

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 1200; Start-Process 'http://127.0.0.1:%COURSEGEN_UI_PORT%/'"
call npm run coursegen:ui %*

if errorlevel 1 pause
