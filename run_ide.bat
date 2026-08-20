@echo off
setlocal
cd /d "%~dp0\.."
if exist "Start MyLecture IDE.bat" (
  call "Start MyLecture IDE.bat"
) else (
  cd /d "%~dp0"
  call npm run ide -- --open %*
  if errorlevel 1 pause
)
