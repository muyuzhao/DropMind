@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  pause
  exit /b 1
)

if not exist "node_modules\next\dist\bin\next" (
  echo First run: installing local dependencies...
  call npm.cmd install
  if errorlevel 1 pause & exit /b 1
)

echo Novel Workbench: http://127.0.0.1:3000
echo Keep this window open. Press Ctrl+C to stop.
node "node_modules\next\dist\bin\next" dev -H 127.0.0.1
pause
