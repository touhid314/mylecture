@echo off
rem Opens MyLecture exactly as a brand-new user sees it right after installing:
rem a separate, empty profile (no settings, projects, voices or videos).
rem Your real MyLecture data is not touched. The profile is reset every time.
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Run MyLecture.bat once first to install dependencies.
  pause
  exit /b 1
)
set "MYLECTURE_PROFILE=%TEMP%\MyLecture-fresh-install"
if exist "%MYLECTURE_PROFILE%" rmdir /s /q "%MYLECTURE_PROFILE%"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
endlocal
