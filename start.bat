@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting the Valheim control panel...
start "" http://localhost:8080
node src/server.js
pause
