@echo off
setlocal

cd /d "%~dp0"

call npm run view -- --open %*
call npm run view -- --open %*

if errorlevel 1 pause
