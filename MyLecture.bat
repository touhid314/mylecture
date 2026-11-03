@echo off
rem One-click launcher for MyLecture (development copy).
rem Installs dependencies on first run, then opens the app without a console window.
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo Node.js is required. Install it from https://nodejs.org and run this again.
    pause
    exit /b 1
  )
  echo Installing MyLecture dependencies, this happens only once...
  call npm install
  if errorlevel 1 (
    echo Installing dependencies failed.
    pause
    exit /b 1
  )
)

start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
endlocal
