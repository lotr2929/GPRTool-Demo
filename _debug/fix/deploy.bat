# deploy.bat: Automates the deployment process for GPRTool using Vercel credentials.
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
REM 2. Auto-generate commit message
REM    Format: 31Mar26 14:32 - [3] north-point-2d.js, styles.css, index.html
REM -----------------------------------------
powershell -NoProfile -Command "$ts=(Get-Date -Format 'ddMMMyy HH:mm'); $all=@(git diff --cached --name-only); $count=$all.Count; $names=($all | ForEach-Object { Split-Path $_ -Leaf } | Select-Object -First 4) -join ', '; $suffix = if ($count -gt 4) { '...' } else { '' }; Set-Content '%TEMP%\gpr_msg.txt' ($ts + ' - [' + $count + '] ' + $names + $suffix)"

set /p commit_msg=<"%TEMP%\gpr_msg.txt"
del "%TEMP%\gpr_msg.txt" 2>nul

if "%commit_msg%"=="" set commit_msg=update

echo.
powershell -NoProfile -Command "Write-Host 'Commit: %commit_msg%' -ForegroundColor Cyan"
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
    echo  Check: https://vercel.com/lotr2929-7612s-projects/gprtool
    echo ========================================
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Deploy complete!
echo  https://gprtool.vercel.app
echo ========================================
echo.
pause
