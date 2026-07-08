@echo off
setlocal
cd /d "%~dp0"

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 7777 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
  start "Manifestador" /min cmd /k "cd /d ""%~dp0"" && node server.js"
  timeout /t 2 /nobreak >nul
)

start "" "http://localhost:7777"
endlocal
