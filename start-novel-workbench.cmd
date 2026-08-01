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

echo Novel Workbench on this computer: http://localhost:3000
echo Read-only mobile library on home Wi-Fi: http://192.168.1.4:3000/read
echo If the Wi-Fi address changes, run ipconfig and use the current WLAN IPv4 address with port 3000.
echo Keep this window open. Press Ctrl+C to stop.
node "node_modules\next\dist\bin\next" dev -H 0.0.0.0
pause
