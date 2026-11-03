@echo off
rem Opens MyLecture exactly as a brand-new user sees it right after installing:
rem a separate, empty profile (no settings, projects, voices or videos), and
rem GPT and Claude with no saved sign-in, so "Connect" goes through the real
rem website sign-in. Your normal MyLecture data and sign-ins are not touched.
rem Everything is reset each time this runs.
rem (Gemini keeps its sign-in in Windows Credential Manager, so it still
rem recognizes this computer's Google sign-in.)
setlocal
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Run MyLecture.bat once first to install dependencies.
  pause
  exit /b 1
)
set "MYLECTURE_PROFILE=%TEMP%\MyLecture-fresh-install"
if exist "%MYLECTURE_PROFILE%" rmdir /s /q "%MYLECTURE_PROFILE%"
mkdir "%MYLECTURE_PROFILE%\codex" "%MYLECTURE_PROFILE%\claude"
set "CODEX_HOME=%MYLECTURE_PROFILE%\codex"
set "CLAUDE_CONFIG_DIR=%MYLECTURE_PROFILE%\claude"
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
endlocal
