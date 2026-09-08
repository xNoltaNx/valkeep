@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
echo Starting Valkeep...
start "" http://localhost:8080
node src/server.js
pause
