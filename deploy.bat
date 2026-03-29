@echo off
cd /d "%~dp0"
echo ========================================
echo  GPRTool Deploy
echo ========================================
echo.

REM -----------------------------------------
REM 0. Check deploy.env exists
REM -----------------------------------------
if not exist deploy.env (
    echo ERROR: deploy.env not found.
    echo Create it with VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID.
    pause
    exit /b 1
)

REM Load Vercel credentials
for /f "usebackq tokens=1,* delims==" %%A in ("deploy.env") do (
    if "%%A"=="VERCEL_TOKEN"      set VERCEL_TOKEN=%%B
    if "%%A"=="VERCEL_PROJECT_ID" set VERCEL_PROJECT_ID=%%B
    if "%%A"=="VERCEL_TEAM_ID"    set VERCEL_TEAM_ID=%%B
)

if "%VERCEL_TOKEN%"=="PASTE_YOUR_TOKEN_HERE" (
    echo ERROR: VERCEL_TOKEN not set in deploy.env.
    pause
    exit /b 1
)

REM -----------------------------------------
REM 1. Stage all changes
REM -----------------------------------------
echo Staging all changes...
git add -A

REM Check if there is anything to commit
git diff-index --quiet HEAD
if %errorlevel% equ 0 (
    echo No changes to commit. Deploying current HEAD to Vercel...
    goto :push
)

REM -----------------------------------------
REM 2. Auto-generate commit message via PowerShell
REM    Written to temp file to avoid cmd quoting issues
REM    Format: 2026-03-29 14:32 - 3 files: a.js b.css c.html
REM -----------------------------------------
powershell -NoProfile -Command ^
  "$ts = Get-Date -Format 'yyyy-MM-dd HH:mm';" ^
  "$files = git diff --cached --name-only | ForEach-Object { Split-Path $_ -Leaf };" ^
  "$count = $files.Count;" ^
  "$names = ($files | Select-Object -First 4) -join ' ';" ^
  "$msg = \"$ts - $count file(s): $names\";" ^
  "Set-Content -Path '%TEMP%\gpr_commit_msg.txt' -Value $msg -Encoding UTF8"

set /p commit_msg=<"%TEMP%\gpr_commit_msg.txt"
del "%TEMP%\gpr_commit_msg.txt" 2>nul

echo.
echo Commit message: %commit_msg%
echo.

REM -----------------------------------------
REM 3. Commit
REM -----------------------------------------
echo Committing...
git commit -m "%commit_msg%"
if %errorlevel% neq 0 (
    echo ERROR: git commit failed.
    pause
    exit /b 1
)

REM -----------------------------------------
REM 4. Pull then push
REM -----------------------------------------
:push
echo.
echo Pulling latest from GitHub...
git pull origin main --rebase
if %errorlevel% neq 0 (
    echo ERROR: git pull failed. Resolve conflicts and try again.
    pause
    exit /b 1
)

REM Capture baseline deployment UID BEFORE push
echo.
echo Capturing baseline deployment UID...
for /f "usebackq" %%U in (`powershell -NoProfile -Command "(Invoke-RestMethod 'https://api.vercel.com/v6/deployments?projectId=%VERCEL_PROJECT_ID%&teamId=%VERCEL_TEAM_ID%&limit=1' -Headers @{Authorization='Bearer %VERCEL_TOKEN%'}).deployments[0].uid"`) do set BASELINE_UID=%%U
echo Baseline: %BASELINE_UID%

echo.
echo Pushing to GitHub...
git push origin main
if %errorlevel% neq 0 (
    echo ERROR: git push failed.
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Pushed. Polling Vercel for deployment...
echo ========================================
echo.

powershell -NoProfile -File poll_vercel.ps1 -BaselineUid "%BASELINE_UID%"

if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo  Deployment failed or timed out.
    echo  Check: https://vercel.com/lotr2929-7612s-projects/gpr-tool-demo
    echo ========================================
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Deploy complete!
echo  https://gprtool-demo.vercel.app
echo ========================================
echo.
pause
