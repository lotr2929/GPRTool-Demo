@echo off
REM GPRTool — start.bat
REM Starts the local dev server and opens the browser.

echo Starting GPRTool...

start "GPRTool" cmd /k "cd /d %~dp0app && python -m http.server 8000"

timeout /t 2 /nobreak >nul

start "" http://localhost:8000

echo GPRTool running at http://localhost:8000
echo Close the terminal window to stop the server.
