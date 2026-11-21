@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0..\.."

echo(
echo   SGS Capture Server - local receiver for userscript
echo   Project root: %CD%
echo(

if not exist "%~dp0server.js" (
  echo   [x] server.js not found next to this bat file.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo   [x] node not found in PATH. Install Node.js first.
  pause
  exit /b 1
)

echo   Starting... keep this window open. Press Ctrl+C to stop.
echo(
node "%~dp0server.js"

echo(
echo   Server stopped.
pause
