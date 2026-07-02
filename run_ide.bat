@echo off
setlocal

cd /d "%~dp0"

call npm run ide -- --open %*
call npm run ide -- --open %*

if errorlevel 1 pause
